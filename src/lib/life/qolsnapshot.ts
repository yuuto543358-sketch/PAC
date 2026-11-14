import "server-only";
import type { Db } from "@/lib/db";
import { checkinStats, listCheckins, type CheckinStats } from "./checkins";
import { listEvents, upcomingSummary } from "./events";
import { listGoals } from "./goals";
import { habitProgressList } from "./habits";
import { addDays } from "./planner";
import type { LifeCategory } from "./repo";

// QOLの記録（チェック・習慣・目標・これから起きること）のまとめ。分析とふりかえりの両方で使う。数字はプログラムが計算する。

export type QolSnapshot = {
  qol: CheckinStats | null;
  habits: { title: string; categoryId: string | null; frequency: string; target: number; doneInPeriod: number; rate4w: number | null; streak: number }[];
  goals: { title: string; categoryId: string | null; pct: number | null; timePct: number | null; behind: boolean; unit: string; latest: number | null; target: number | null; due: string | null }[];
  upcoming: { title: string; categoryId: string | null; date: string; daysLeft: number; amount: number | null }[];
  upcomingAmount90: number;
};

export async function qolSnapshot(db: Db, today: string, periodDays: number): Promise<QolSnapshot> {
  const since = addDays(today, -(periodDays - 1));
  const [checkins, habits, goals, events] = await Promise.all([
    listCheckins(db, since),
    habitProgressList(db, today),
    listGoals(db, today),
    listEvents(db, today),
  ]);
  const logs = habits.length
    ? await db<{ habit_id: string; n: number }[]>`
        select habit_id, count(*)::int as n from life_habit_logs
        where habit_id = any(${habits.map((h) => h.id)}::uuid[]) and log_date between ${since}::date and ${today}::date
        group by habit_id`
    : [];
  const up = upcomingSummary(events, 90);
  return {
    qol: checkinStats(checkins),
    habits: habits.map((h) => ({
      title: h.title,
      categoryId: h.category_id,
      frequency: h.frequency,
      target: h.target_per_week,
      doneInPeriod: logs.find((l) => l.habit_id === h.id)?.n ?? 0,
      rate4w: h.rate4w,
      streak: h.streak,
    })),
    goals: goals.map((g) => ({
      title: g.title,
      categoryId: g.category_id,
      pct: g.pct,
      timePct: g.timePct,
      behind: g.behind,
      unit: g.unit,
      latest: g.latest_value,
      target: g.target_value,
      due: g.due_date,
    })),
    upcoming: up.events.map((e) => ({ title: e.title, categoryId: e.category_id, date: e.nextDate!, daysLeft: e.daysLeft!, amount: e.amount_jpy })),
    upcomingAmount90: up.amount,
  };
}

/** AIに渡す前に、「AIに渡さない」カテゴリの情報を外す（QOLチェックは「健康・運動」あつかい） */
export function qolForAi(s: QolSnapshot, categories: LifeCategory[]): QolSnapshot {
  const ok = new Set(categories.filter((c) => c.ai_allowed && c.is_active).map((c) => c.id));
  const allow = (id: string | null) => id == null || ok.has(id);
  const up = s.upcoming.filter((e) => allow(e.categoryId));
  return {
    qol: ok.has("health") ? s.qol : null,
    habits: s.habits.filter((h) => allow(h.categoryId)),
    goals: s.goals.filter((g) => allow(g.categoryId)),
    upcoming: up,
    upcomingAmount90: up.reduce((a, e) => a + (e.amount ?? 0), 0),
  };
}

export function isEmptySnapshot(s: QolSnapshot) {
  return !s.qol && s.habits.length === 0 && s.goals.length === 0 && s.upcoming.length === 0;
}
