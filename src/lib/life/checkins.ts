import "server-only";
import type { Db, Sql } from "@/lib/db";
import { addDays } from "./planner";

// 毎日のQOLチェック（気分・体調・睡眠・ストレスを1〜5で）。AIは使わない。

export type Checkin = {
  id: string;
  check_date: string;
  mood: number;
  energy: number;
  sleep: number;
  stress: number;
  note: string;
};

export const CHECKIN_METRICS = [
  { key: "mood", label: "気分", low: "しんどい", high: "とても良い" },
  { key: "energy", label: "体調", low: "だるい", high: "元気" },
  { key: "sleep", label: "睡眠", low: "眠れなかった", high: "ぐっすり" },
  { key: "stress", label: "ストレス", low: "少ない", high: "多い" },
] as const;
export type MetricKey = (typeof CHECKIN_METRICS)[number]["key"];

/** QOLスコア（1〜5。ストレスは少ないほど良いので逆にして平均） */
export function qolScore(c: Pick<Checkin, "mood" | "energy" | "sleep" | "stress">): number {
  return Math.round(((c.mood + c.energy + c.sleep + (6 - c.stress)) / 4) * 10) / 10;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveCheckin(
  sql: Sql,
  date: string,
  today: string,
  v: { mood: number; energy: number; sleep: number; stress: number; note: string },
) {
  if (!DATE_RE.test(date) || date > today || date < addDays(today, -7)) throw new Error("記録できるのは、今日から7日前までです");
  for (const k of ["mood", "energy", "sleep", "stress"] as const) {
    if (!Number.isInteger(v[k]) || v[k] < 1 || v[k] > 5) throw new Error("それぞれ1〜5で選んでください");
  }
  await sql`
    insert into life_checkins (check_date, mood, energy, sleep, stress, note)
    values (${date}::date, ${v.mood}, ${v.energy}, ${v.sleep}, ${v.stress}, ${v.note.trim().slice(0, 500)})
    on conflict (check_date) do update set mood = excluded.mood, energy = excluded.energy, sleep = excluded.sleep,
      stress = excluded.stress, note = excluded.note, updated_at = now()`;
}

export async function getCheckin(db: Db, date: string): Promise<Checkin | null> {
  const [c] = await db<Checkin[]>`
    select id, to_char(check_date, 'YYYY-MM-DD') as check_date, mood, energy, sleep, stress, note
    from life_checkins where check_date = ${date}::date`;
  return c ?? null;
}

export async function listCheckins(db: Db, sinceDate: string): Promise<Checkin[]> {
  return db<Checkin[]>`
    select id, to_char(check_date, 'YYYY-MM-DD') as check_date, mood, energy, sleep, stress, note
    from life_checkins where check_date >= ${sinceDate}::date order by check_date`;
}

export async function deleteCheckin(sql: Sql, date: string) {
  await sql`delete from life_checkins where check_date = ${date}::date`;
}

export type CheckinStats = {
  days: number;
  avg: Record<MetricKey, number> & { score: number };
  /** 前半と後半のスコアの差（＋なら良くなっている） */
  trend: number | null;
  /** よく眠れた日（睡眠4以上）と眠れなかった日（2以下）の、気分の平均。どちらも3日以上あるときだけ */
  sleepMood: { goodSleep: number; badSleep: number } | null;
  lowDays: number;
};

export function checkinStats(list: Checkin[]): CheckinStats | null {
  if (list.length === 0) return null;
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  const scores = list.map(qolScore);
  const half = Math.floor(list.length / 2);
  const good = list.filter((c) => c.sleep >= 4).map((c) => c.mood);
  const bad = list.filter((c) => c.sleep <= 2).map((c) => c.mood);
  return {
    days: list.length,
    avg: {
      mood: avg(list.map((c) => c.mood)),
      energy: avg(list.map((c) => c.energy)),
      sleep: avg(list.map((c) => c.sleep)),
      stress: avg(list.map((c) => c.stress)),
      score: avg(scores),
    },
    trend: list.length >= 6 ? Math.round((avg(scores.slice(half)) - avg(scores.slice(0, half))) * 10) / 10 : null,
    sleepMood: good.length >= 3 && bad.length >= 3 ? { goodSleep: avg(good), badSleep: avg(bad) } : null,
    lowDays: scores.filter((s) => s <= 2.5).length,
  };
}
