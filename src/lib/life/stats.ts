// 生活情報の集計（プログラムが計算する「事実」。AIは使わない）。
// 直近1・3・6・12か月の期間で、固定費の合計・月ごとの推移・変化・運動の頻度・足りない情報などを出す。

import { addDays, planQuestions } from "./planner";
import type { LifeCategory, LifeField, LifeRecord } from "./repo";

export type SeriesPoint = { month: string; value: number };

export type LifeStats = {
  periodMonths: number;
  periodStart: string;
  periodEnd: string;
  recordCount: number;
  fixedCosts: { items: { fieldId: string; label: string; categoryId: string; value: number }[]; total: number; missing: string[] };
  monthly: {
    fieldId: string;
    label: string;
    unit: string;
    categoryId: string;
    series: SeriesPoint[];
    avg: number | null;
    first: number | null;
    last: number | null;
    changePct: number | null;
  }[];
  stateChanges: { fieldId: string; label: string; categoryId: string; from: string; to: string; changedOn: string }[];
  exercise: { weeks: number; counts: Record<string, number>; lowShare: number | null } | null;
  texts: { fieldId: string; label: string; categoryId: string; items: { date: string; text: string }[] }[];
  gaps: string[];
};

/** 固定費として合計する項目（車・ペットは持っている人だけ） */
const FIXED_COST_FIELDS = ["rent", "phone_bill", "internet_bill", "car_cost_monthly", "pet_cost_monthly"];

export function monthsAgo(today: string, months: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function effectiveDate(r: LifeRecord) {
  return r.period_end ?? new Date(new Date(r.confirmed_at).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

function fmt(field: LifeField, r: LifeRecord) {
  if (field.value_type === "number" && r.value_num != null) return `${Number(r.value_num).toLocaleString("ja-JP")}${field.unit}`;
  return r.value_text;
}

export function computeStats(input: {
  fields: LifeField[];
  categories: LifeCategory[];
  records: LifeRecord[];
  latest: Map<string, LifeRecord>;
  months: number;
  today: string;
  now: Date;
}): LifeStats {
  const { fields, records, latest, months, today } = input;
  const start = monthsAgo(today, months);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const inPeriod = records.filter((r) => effectiveDate(r) >= start && effectiveDate(r) <= today);
  const has = (id: string, value: string) => latest.get(id)?.value_text === value;

  // 固定費（いまの値）
  const fixedItems: LifeStats["fixedCosts"]["items"] = [];
  const fixedMissing: string[] = [];
  for (const id of FIXED_COST_FIELDS) {
    const f = byId.get(id);
    if (!f || !f.is_active) continue;
    if (id === "car_cost_monthly" && !has("car_owned", "はい")) continue;
    if (id === "pet_cost_monthly" && !has("pet_owned", "いる")) continue;
    const r = latest.get(id);
    if (r?.value_num != null) fixedItems.push({ fieldId: id, label: f.label, categoryId: f.category_id, value: Number(r.value_num) });
    else fixedMissing.push(f.label);
  }

  // 月ごとの記録（数字）
  const monthly: LifeStats["monthly"] = [];
  for (const f of fields) {
    if (f.kind !== "periodic" || f.period !== "month" || f.value_type !== "number") continue;
    const rs = inPeriod.filter((r) => r.field_id === f.id && r.value_num != null);
    if (rs.length === 0) continue;
    const byMonth = new Map<string, number>();
    for (const r of rs) byMonth.set(effectiveDate(r).slice(0, 7), Number(r.value_num));
    const series = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value }));
    const vals = series.map((s) => s.value);
    const first = vals[0];
    const last = vals[vals.length - 1];
    monthly.push({
      fieldId: f.id,
      label: f.label,
      unit: f.unit,
      categoryId: f.category_id,
      series,
      avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      first,
      last,
      changePct: series.length >= 2 && first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : null,
    });
  }

  // いまの状態の変化（例：携帯料金 3,000円 → 4,000円）
  const stateChanges: LifeStats["stateChanges"] = [];
  for (const f of fields) {
    if (f.kind !== "state") continue;
    const rs = records.filter((r) => r.field_id === f.id).sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)));
    for (let i = 1; i < rs.length; i++) {
      const prev = fmt(f, rs[i - 1]);
      const cur = fmt(f, rs[i]);
      if (prev !== cur && effectiveDate(rs[i]) >= start) {
        stateChanges.push({ fieldId: f.id, label: f.label, categoryId: f.category_id, from: prev, to: cur, changedOn: effectiveDate(rs[i]) });
      }
    }
  }

  // 運動（週ごとの回答）
  const ex = inPeriod.filter((r) => r.field_id === "exercise_week");
  const counts: Record<string, number> = {};
  for (const r of ex) counts[r.value_text] = (counts[r.value_text] ?? 0) + 1;
  const exercise = ex.length
    ? { weeks: ex.length, counts, lowShare: Math.round(((counts["ほぼしていない"] ?? 0) / ex.length) * 100) }
    : null;

  // 文章の回答（困りごと・気になる支出など。AIがくり返す問題を見つけるのに使う）
  const texts: LifeStats["texts"] = [];
  for (const f of fields) {
    if (f.value_type !== "text") continue;
    const rs = inPeriod.filter((r) => r.field_id === f.id && r.value_text.trim());
    if (rs.length === 0) continue;
    texts.push({
      fieldId: f.id,
      label: f.label,
      categoryId: f.category_id,
      items: rs.slice(-8).map((r) => ({ date: effectiveDate(r), text: r.value_text.slice(0, 300) })),
    });
  }

  // 足りない情報（大事なのに分からない・古い）
  const gaps = planQuestions({
    fields,
    categories: input.categories,
    latest,
    lastQuestions: new Map(),
    today,
    now: input.now,
    limit: 999,
  })
    .filter((c) => c.why !== "period" && c.field.importance >= 3)
    .map((c) => `${c.field.label}${c.why === "stale" ? "（古い）" : ""}`);

  return {
    periodMonths: months,
    periodStart: start,
    periodEnd: today,
    recordCount: inPeriod.length,
    fixedCosts: { items: fixedItems, total: fixedItems.reduce((a, b) => a + b.value, 0), missing: fixedMissing },
    monthly,
    stateChanges,
    exercise,
    texts,
    gaps,
  };
}

/** AIに渡す内容（「AIに渡さない」カテゴリの情報は外す） */
export function statsForAi(stats: LifeStats, categories: LifeCategory[]) {
  const ok = new Set(categories.filter((c) => c.ai_allowed && c.is_active).map((c) => c.id));
  return {
    ...stats,
    fixedCosts: {
      items: stats.fixedCosts.items.filter((i) => ok.has(i.categoryId)),
      total: stats.fixedCosts.items.filter((i) => ok.has(i.categoryId)).reduce((a, b) => a + b.value, 0),
      missing: stats.fixedCosts.missing,
    },
    monthly: stats.monthly.filter((m) => ok.has(m.categoryId)),
    stateChanges: stats.stateChanges.filter((s) => ok.has(s.categoryId)),
    exercise: ok.has("health") ? stats.exercise : null,
    texts: stats.texts.filter((t) => ok.has(t.categoryId)),
    excludedCategories: categories.filter((c) => !c.ai_allowed).map((c) => c.name),
  };
}

export { addDays };
