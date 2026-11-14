import "server-only";
import type { Db, Sql } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { addDays } from "./planner";

// 小さな習慣（毎日 or 週に何回）。チェックをつけて続ける。AIは使わない。

export type Habit = {
  id: string;
  title: string;
  why: string;
  frequency: "daily" | "weekly";
  target_per_week: number;
  category_id: string | null;
  status: "proposed" | "active" | "paused" | "done" | "archived";
  source: string;
  suggestion_id: string | null;
  start_date: string;
  created_at: Date;
};

export type HabitProgress = Habit & {
  doneToday: boolean;
  /** 毎日の習慣：続いている日数（今日まだなら昨日まで） */
  streak: number;
  /** 今週（月曜から）の回数 */
  thisWeek: number;
  /** この4週間の達成率（%）。始めてからの日数で計算 */
  rate4w: number | null;
  recent: string[];
};

const HABIT_COLS = `id, title, why, frequency, target_per_week, category_id, status, source, suggestion_id,
  to_char(start_date, 'YYYY-MM-DD') as start_date, created_at`;

export async function createHabit(
  sql: Sql,
  h: { title: string; why?: string; frequency: string; targetPerWeek?: number; categoryId?: string | null; status?: string; source?: string; suggestionId?: string | null },
): Promise<string> {
  const title = h.title.trim().slice(0, 80);
  if (!title) throw new Error("習慣の名前を入力してください");
  const frequency = h.frequency === "weekly" ? "weekly" : "daily";
  const target = frequency === "daily" ? 7 : Math.min(7, Math.max(1, Math.round(h.targetPerWeek ?? 3)));
  const status = h.status === "proposed" ? "proposed" : "active";
  const [row] = await sql<{ id: string }[]>`
    insert into life_habits (title, why, frequency, target_per_week, category_id, status, source, suggestion_id)
    values (${title}, ${(h.why ?? "").slice(0, 300)}, ${frequency}, ${target}, ${h.categoryId ?? null}, ${status},
      ${h.source ?? "owner"}, ${h.suggestionId ?? null})
    returning id`;
  await audit(sql, h.source === "ai" ? "employee:life" : "owner", "life_habit_created", "life_habit", row.id, { status });
  return row.id;
}

export async function listHabits(db: Db, statuses: string[] = ["active"]): Promise<Habit[]> {
  return db.unsafe<Habit[]>(
    `select ${HABIT_COLS} from life_habits where status = any($1::text[]) order by sort_order, created_at`,
    [statuses],
  );
}

export async function setHabitStatus(sql: Sql, id: string, status: string) {
  if (!["active", "paused", "done", "archived"].includes(status)) throw new Error("状態が正しくありません");
  const rows = await sql`
    update life_habits set status = ${status}, updated_at = now(),
      start_date = case when status = 'proposed' and ${status} = 'active' then (now() at time zone 'Asia/Tokyo')::date else start_date end
    where id = ${id} returning id`;
  if (rows.length === 0) throw new Error("習慣が見つかりません");
}

export async function setHabitLog(sql: Sql, habitId: string, date: string, today: string, done: boolean) {
  if (date > today || date < addDays(today, -7)) throw new Error("チェックできるのは、今日から7日前までです");
  const [h] = await sql<{ status: string }[]>`select status from life_habits where id = ${habitId}`;
  if (!h) throw new Error("習慣が見つかりません");
  if (h.status !== "active") throw new Error("この習慣は、いまは休んでいます");
  if (done) {
    await sql`insert into life_habit_logs (habit_id, log_date) values (${habitId}, ${date}::date) on conflict do nothing`;
  } else {
    await sql`delete from life_habit_logs where habit_id = ${habitId} and log_date = ${date}::date`;
  }
}

/** 月曜はじまりの週の最初の日 */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7; // 月=0
  return addDays(date, -wd);
}

export function computeProgress(h: Habit, logs: string[], today: string): HabitProgress {
  const set = new Set(logs);
  const doneToday = set.has(today);
  let streak = 0;
  let cur = doneToday ? today : addDays(today, -1);
  while (set.has(cur)) {
    streak++;
    cur = addDays(cur, -1);
  }
  const ws = weekStart(today);
  const thisWeek = logs.filter((d) => d >= ws && d <= today).length;
  const from = [addDays(today, -27), h.start_date].sort().pop()!;
  const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000) + 1);
  const expected = h.frequency === "daily" ? days : (days / 7) * h.target_per_week;
  const done = logs.filter((d) => d >= from && d <= today).length;
  return {
    ...h,
    doneToday,
    streak,
    thisWeek,
    rate4w: days >= 3 ? Math.min(100, Math.round((done / expected) * 100)) : null,
    recent: logs.filter((d) => d >= addDays(today, -6)),
  };
}

export async function habitProgressList(db: Db, today: string, statuses: string[] = ["active"]): Promise<HabitProgress[]> {
  const habits = await listHabits(db, statuses);
  if (habits.length === 0) return [];
  const logs = await db<{ habit_id: string; d: string }[]>`
    select habit_id, to_char(log_date, 'YYYY-MM-DD') as d from life_habit_logs
    where habit_id = any(${habits.map((h) => h.id)}::uuid[]) and log_date >= ${addDays(today, -60)}::date`;
  return habits.map((h) => computeProgress(h, logs.filter((l) => l.habit_id === h.id).map((l) => l.d), today));
}
