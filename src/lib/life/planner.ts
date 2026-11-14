// 次に何を質問するかを決める（AIは使わない＝費用0円）。
// ルール：情報がない・古くなった・今期の記録がない項目から、大事な順に少しずつ聞く。
// すでに十分な情報がある項目や、最近スキップされた項目は聞かない。

import type { LifeCategory, LifeField, LifeRecord } from "./repo";

export type LastQuestion = { status: string; asked_at: Date; remind_after: Date | null; period_end: string | null };

export type Candidate = {
  field: LifeField;
  why: "missing" | "stale" | "period";
  score: number;
  text: string;
  reason: string;
  periodStart: string | null;
  periodEnd: string | null;
};

const DAY = 86_400_000;

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
/** 'YYYY-MM-DD' の日付に日数を足す */
export function addDays(date: string, days: number) {
  return ymd(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY));
}

/** 期間ごとの項目が「どの期間」について聞くか（月：先月／週：きのうまでの7日間） */
export function targetPeriod(field: Pick<LifeField, "period">, today: string): { start: string; end: string; label: string } | null {
  if (field.period === "month") {
    const [y, m] = today.split("-").map(Number);
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const start = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
    const end = addDays(`${y}-${String(m).padStart(2, "0")}-01`, -1);
    return { start, end, label: `先月（${prevM}月）` };
  }
  if (field.period === "week") {
    return { start: addDays(today, -7), end: addDays(today, -1), label: "この1週間" };
  }
  return null;
}

function dependencyMet(field: LifeField, latest: Map<string, LifeRecord>) {
  if (!field.depends_on) return true;
  const [depId, want] = field.depends_on.split("=");
  const r = latest.get(depId);
  return Boolean(r && r.value_text === want);
}

export function planQuestions(input: {
  fields: LifeField[];
  categories: LifeCategory[];
  latest: Map<string, LifeRecord>;
  lastQuestions: Map<string, LastQuestion>;
  today: string;
  now: Date;
  limit: number;
}): Candidate[] {
  const activeCats = new Set(input.categories.filter((c) => c.is_active).map((c) => c.id));
  const out: Candidate[] = [];
  for (const f of input.fields) {
    if (!f.is_active || !activeCats.has(f.category_id) || !dependencyMet(f, input.latest)) continue;
    const last = input.lastQuestions.get(f.id);
    const period = f.kind === "periodic" ? targetPeriod(f, input.today) : null;
    if (last) {
      const ageDays = (input.now.getTime() - new Date(last.asked_at).getTime()) / DAY;
      if (last.status === "pending") continue;
      if (last.status === "later" && (!last.remind_after || new Date(last.remind_after) > input.now)) continue;
      if (last.status === "later") continue; // 「後で」の質問は、新しく作らずに元の質問を出し直す
      if (last.status === "skipped" || last.status === "unknown") {
        if (period && last.period_end === period.end) continue;
        if (!period && ageDays < Math.max(14, Math.round(f.refresh_days / 2))) continue;
      }
      if (last.status === "expired" && ageDays < 7) continue;
    }
    const rec = input.latest.get(f.id);
    let why: Candidate["why"] | null = null;
    let score = 0;
    if (period) {
      if (!rec || !rec.period_end || rec.period_end < period.end) {
        // 週の記録：この7日間の記録がなければ聞く
        if (!(f.period === "week" && rec?.period_end && rec.period_end >= period.start)) {
          why = "period";
          score = f.importance * 10 + 2;
        }
      }
    } else if (!rec) {
      why = "missing";
      score = f.importance * 10 + 5;
    } else if ((input.now.getTime() - new Date(rec.confirmed_at).getTime()) / DAY > f.refresh_days) {
      why = "stale";
      score = f.importance * 10;
    }
    if (!why) continue;
    const text = f.question.replaceAll("{period}", period?.label ?? "最近");
    const reason =
      why === "stale"
        ? `前に教えてもらってから時間がたったので、変わっていないか確認させてください（${f.reason}）`
        : f.reason;
    out.push({ field: f, why, score, text, reason, periodStart: period?.start ?? null, periodEnd: period?.end ?? null });
  }
  return out.sort((a, b) => b.score - a.score || a.field.sort_order - b.field.sort_order).slice(0, Math.max(0, input.limit));
}

/** 今日、質問を作る日か（頻度の設定と、使い始めの時期） */
export function isQuestionDay(freq: string, weekday: number, onboarding: boolean): boolean {
  if (freq === "off") return false;
  if (onboarding || freq === "high") return true;
  if (freq === "low") return weekday === 1;
  return weekday === 1 || weekday === 4;
}

/** 次に質問を作る日（表示用） */
export function nextQuestionDay(freq: string, today: string, weekdayToday: number, onboarding: boolean): string | null {
  if (freq === "off") return null;
  for (let i = 1; i <= 7; i++) {
    if (isQuestionDay(freq, (weekdayToday + i) % 7, onboarding)) return addDays(today, i);
  }
  return null;
}
