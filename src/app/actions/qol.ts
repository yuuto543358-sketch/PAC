"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { jstDateParts } from "@/lib/format";
import { saveCheckin } from "@/lib/life/checkins";
import { createHabit, setHabitLog, setHabitStatus } from "@/lib/life/habits";
import { archiveEvent, createEvent, markEventDone } from "@/lib/life/events";
import { addGoalProgress, createGoal, setGoalStatus } from "@/lib/life/goals";
import { runWeeklyReview } from "@/lib/life/review";
import { dismissNudge } from "@/lib/life/nudges";
import { runSelfResearch } from "@/lib/life/research";
import { kickNotifications } from "@/lib/notify/trigger";
import type { ActionState } from "@/components/forms";

const ok = (message: string): ActionState => ({ ok: true, message, ts: Date.now() });
const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });
const today = () => jstDateParts(new Date()).date;
const numOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").normalize("NFKC").replace(/[,，円\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("数字が正しくありません");
  return n;
};

export async function saveCheckinAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const t = today();
    const sql = await getDb();
    await saveCheckin(sql, String(fd.get("date") || t), t, {
      mood: Number(fd.get("mood")),
      energy: Number(fd.get("energy")),
      sleep: Number(fd.get("sleep")),
      stress: Number(fd.get("stress")),
      note: String(fd.get("note") ?? ""),
    });
    refresh();
    return ok("今日のチェックを記録しました");
  } catch (e) {
    return fail(e);
  }
}

export async function toggleHabitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const t = today();
    const sql = await getDb();
    const done = fd.get("done") === "1";
    await setHabitLog(sql, String(fd.get("id") ?? ""), String(fd.get("date") || t), t, done);
    refresh();
    return ok(done ? "できた！" : "チェックを外しました");
  } catch (e) {
    return fail(e);
  }
}

export async function createHabitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const suggestionId = String(fd.get("suggestionId") ?? "");
    await createHabit(sql, {
      title: String(fd.get("title") ?? ""),
      why: String(fd.get("why") ?? ""),
      frequency: String(fd.get("frequency") ?? "daily"),
      targetPerWeek: Number(fd.get("target") ?? 3),
      source: suggestionId ? "suggestion" : "owner",
      suggestionId: /^[0-9a-f-]{36}$/i.test(suggestionId) ? suggestionId : null,
    });
    refresh();
    return ok("習慣を始めました");
  } catch (e) {
    return fail(e);
  }
}

export async function setHabitStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const status = String(fd.get("status") ?? "");
    await setHabitStatus(sql, String(fd.get("id") ?? ""), status);
    refresh();
    return ok(status === "active" ? "習慣を始めました" : status === "paused" ? "お休みにしました" : status === "done" ? "身につきました、おめでとうございます" : "片づけました");
  } catch (e) {
    return fail(e);
  }
}

export async function createEventAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await createEvent(sql, {
      title: String(fd.get("title") ?? ""),
      date: String(fd.get("date") ?? ""),
      repeat: String(fd.get("repeat") ?? "none"),
      amountJpy: numOrNull(fd.get("amount")),
      remindDays: Number(fd.get("remindDays") ?? 7),
      note: String(fd.get("note") ?? ""),
      prep: fd.get("prep") === "on",
    });
    refresh();
    return ok("予定を登録しました");
  } catch (e) {
    return fail(e);
  }
}

export async function eventAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const id = String(fd.get("id") ?? "");
    if (fd.get("act") === "archive") {
      await archiveEvent(sql, id);
      refresh();
      return ok("予定を消しました");
    }
    await markEventDone(sql, id);
    refresh();
    return ok("済んだ、にしました");
  } catch (e) {
    return fail(e);
  }
}

export async function createGoalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await createGoal(sql, {
      title: String(fd.get("title") ?? ""),
      why: String(fd.get("why") ?? ""),
      unit: String(fd.get("unit") ?? ""),
      startValue: numOrNull(fd.get("start")),
      targetValue: numOrNull(fd.get("target")),
      dueDate: String(fd.get("due") ?? "") || null,
    });
    refresh();
    return ok("目標を登録しました");
  } catch (e) {
    return fail(e);
  }
}

export async function addGoalProgressAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const r = await addGoalProgress(sql, String(fd.get("id") ?? ""), numOrNull(fd.get("value")), String(fd.get("note") ?? ""));
    refresh();
    return ok(r.achieved ? "目標を達成しました！おめでとうございます" : "進み具合を記録しました");
  } catch (e) {
    return fail(e);
  }
}

export async function setGoalStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await setGoalStatus(sql, String(fd.get("id") ?? ""), String(fd.get("status") ?? ""));
    refresh();
    return ok("目標の状態を変更しました");
  } catch (e) {
    return fail(e);
  }
}

export async function runReviewAction(): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const r = await runWeeklyReview(sql, "manual");
    refresh();
    return ok(r.message);
  } catch (e) {
    return fail(e);
  }
}

export async function dismissNudgeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await dismissNudge(sql, String(fd.get("id") ?? ""));
    refresh();
    return ok("わかりました");
  } catch (e) {
    return fail(e);
  }
}

export async function runResearchNowAction(): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const r = await runSelfResearch(sql, today(), "manual");
    kickNotifications();
    refresh();
    return r.reportId ? ok(r.message) : { ok: false, error: r.message, ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}
