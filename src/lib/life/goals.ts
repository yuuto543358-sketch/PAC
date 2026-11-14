import "server-only";
import type { Db, Sql } from "@/lib/db";
import { audit } from "@/lib/repo/audit";

// 目標（「貯金30万円」「体重−3kg」など）と、その進み具合。AIは使わない（ふりかえりで森野がコメントする）。

export type Goal = {
  id: string;
  title: string;
  why: string;
  category_id: string | null;
  unit: string;
  start_value: number | null;
  target_value: number | null;
  due_date: string | null;
  status: "active" | "achieved" | "paused" | "dropped";
  created_on: string;
  latest_value: number | null;
  latest_at: Date | null;
};

export type GoalView = Goal & { pct: number | null; timePct: number | null; behind: boolean };

const SELECT = `
  select g.id, g.title, g.why, g.category_id, g.unit, g.start_value, g.target_value,
    to_char(g.due_date, 'YYYY-MM-DD') as due_date, g.status,
    to_char((g.created_at at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD') as created_on,
    (select p.value from life_goal_progress p where p.goal_id = g.id and p.value is not null order by p.recorded_at desc limit 1) as latest_value,
    (select p.recorded_at from life_goal_progress p where p.goal_id = g.id order by p.recorded_at desc limit 1) as latest_at
  from life_goals g`;

function num(v: unknown) {
  return v == null ? null : Number(v);
}

/** 進み具合（%）と、期限までの時間の経過（%）。進みが時間より15%以上おくれていたら「遅れ気味」 */
export function goalView(g: Goal, today: string): GoalView {
  const s = num(g.start_value);
  const t = num(g.target_value);
  const l = num(g.latest_value);
  const pct = s != null && t != null && l != null && t !== s ? Math.max(0, Math.min(100, Math.round(((l - s) / (t - s)) * 100))) : null;
  let timePct: number | null = null;
  if (g.due_date) {
    const total = Date.parse(g.due_date) - Date.parse(g.created_on);
    timePct = total > 0 ? Math.max(0, Math.min(100, Math.round(((Date.parse(today) - Date.parse(g.created_on)) / total) * 100))) : 100;
  }
  return {
    ...g,
    start_value: s,
    target_value: t,
    latest_value: l,
    pct,
    timePct,
    behind: g.status === "active" && pct != null && timePct != null && pct + 15 < timePct,
  };
}

export async function createGoal(
  sql: Sql,
  v: { title: string; why?: string; categoryId?: string | null; unit?: string; startValue: number | null; targetValue: number | null; dueDate: string | null },
): Promise<string> {
  const title = v.title.trim().slice(0, 80);
  if (!title) throw new Error("目標の名前を入力してください");
  const due = v.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(v.dueDate) ? v.dueDate : null;
  for (const x of [v.startValue, v.targetValue]) {
    if (x != null && !Number.isFinite(x)) throw new Error("数字が正しくありません");
  }
  const [row] = await sql<{ id: string }[]>`
    insert into life_goals (title, why, category_id, unit, start_value, target_value, due_date)
    values (${title}, ${(v.why ?? "").slice(0, 300)}, ${v.categoryId ?? null}, ${(v.unit ?? "").slice(0, 20)},
      ${v.startValue}, ${v.targetValue}, ${due})
    returning id`;
  if (v.startValue != null) {
    await sql`insert into life_goal_progress (goal_id, value, note) values (${row.id}, ${v.startValue}, 'スタート')`;
  }
  await audit(sql, "owner", "life_goal_created", "life_goal", row.id);
  return row.id;
}

export async function listGoals(db: Db, today: string, statuses = ["active"]): Promise<GoalView[]> {
  const rows = await db.unsafe<Goal[]>(`${SELECT} where g.status = any($1::text[]) order by g.created_at`, [statuses]);
  return rows.map((g) => goalView(g, today));
}

export async function getGoal(db: Db, id: string, today: string): Promise<GoalView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.unsafe<Goal[]>(`${SELECT} where g.id = $1`, [id]);
  return rows[0] ? goalView(rows[0], today) : null;
}

export async function goalProgressList(db: Db, goalId: string) {
  return db<{ id: number; value: number | null; note: string; recorded_at: Date }[]>`
    select id, value, note, recorded_at from life_goal_progress where goal_id = ${goalId} order by recorded_at desc limit 100`;
}

export async function addGoalProgress(sql: Sql, goalId: string, value: number | null, note: string) {
  if (value == null && !note.trim()) throw new Error("数字かメモを入力してください");
  if (value != null && !Number.isFinite(value)) throw new Error("数字が正しくありません");
  const [g] = await sql<{ target_value: number | null; start_value: number | null; status: string }[]>`
    select target_value, start_value, status from life_goals where id = ${goalId}`;
  if (!g) throw new Error("目標が見つかりません");
  await sql`insert into life_goal_progress (goal_id, value, note) values (${goalId}, ${value}, ${note.trim().slice(0, 500)})`;
  // 目標の数字に届いたら「達成」にする
  if (value != null && g.target_value != null && g.status === "active") {
    const t = Number(g.target_value);
    const s = g.start_value == null ? null : Number(g.start_value);
    const reached = s != null && t < s ? value <= t : value >= t;
    if (reached) {
      await sql`update life_goals set status = 'achieved', updated_at = now() where id = ${goalId}`;
      return { achieved: true };
    }
  }
  return { achieved: false };
}

export async function setGoalStatus(sql: Sql, id: string, status: string) {
  if (!["active", "achieved", "paused", "dropped"].includes(status)) throw new Error("状態が正しくありません");
  const rows = await sql`update life_goals set status = ${status}, updated_at = now() where id = ${id} returning id`;
  if (rows.length === 0) throw new Error("目標が見つかりません");
}
