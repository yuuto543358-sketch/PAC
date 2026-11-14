"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { addRecord, confirmRecord, deleteRecord, setCategoryFlags, updateRecord } from "@/lib/life/repo";
import { answerQuestion, createQuestionBatch, updateLifeSettings, type AnswerAction } from "@/lib/life/questions";
import { audit } from "@/lib/repo/audit";
import { runLifeAnalysis } from "@/lib/life/analysis";
import { setSuggestionStatus } from "@/lib/life/suggestions";
import { kickNotifications } from "@/lib/notify/trigger";
import { autoTasksFromSuggestions, suggestionToTeam } from "@/lib/life/team";
import { scheduleTeamRun } from "@/lib/workflow/trigger";
import type { ActionState } from "@/components/forms";

const ok = (message: string): ActionState => ({ ok: true, message, ts: Date.now() });
const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });

export async function answerQuestionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const id = String(fd.get("id") ?? "");
    const act = String(fd.get("act") ?? "answer") as AnswerAction;
    if (!["answer", "skip", "later", "unknown"].includes(act)) throw new Error("操作が正しくありません");
    const sql = await getDb();
    await answerQuestion(sql, id, act, String(fd.get("value") ?? ""));
    refresh();
    return ok(act === "answer" ? "ありがとうございます。記録しました" : act === "later" ? "また後で聞きますね" : act === "skip" ? "スキップしました" : "分からない、で記録しました");
  } catch (e) {
    return fail(e);
  }
}

export async function askNowAction(): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const r = await createQuestionBatch(sql, "manual");
    refresh();
    return ok(r.message);
  } catch (e) {
    return fail(e);
  }
}

export async function addLifeRecordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const fieldId = String(fd.get("fieldId") ?? "");
    const period = String(fd.get("period") ?? "");
    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    if (/^\d{4}-\d{2}$/.test(period)) {
      const [y, m] = period.split("-").map(Number);
      periodStart = `${period}-01`;
      periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
      periodEnd = period;
    }
    await addRecord(sql, { fieldId, raw: String(fd.get("value") ?? ""), source: "owner", periodStart, periodEnd });
    await audit(sql, "owner", "life_record_added", "life_field", fieldId);
    refresh();
    return ok("記録しました");
  } catch (e) {
    return fail(e);
  }
}

export async function updateLifeRecordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await updateRecord(sql, String(fd.get("id") ?? ""), String(fd.get("value") ?? ""), String(fd.get("reason") ?? ""));
    refresh();
    return ok("記録を直しました（直す前の値は履歴に残っています）");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteLifeRecordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await deleteRecord(sql, String(fd.get("id") ?? ""));
    refresh();
    return ok("記録を削除しました");
  } catch (e) {
    return fail(e);
  }
}

export async function confirmLifeRecordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await confirmRecord(sql, String(fd.get("id") ?? ""));
    refresh();
    return ok("「いまも同じ」で確認しました");
  } catch (e) {
    return fail(e);
  }
}

export async function updateLifeSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await updateLifeSettings(sql, {
      frequency: String(fd.get("frequency") ?? "normal"),
      perBatch: Math.round(Number(fd.get("perBatch"))),
      autoTask: fd.get("autoTask") === "on",
      review: fd.get("review") === "on",
      prep: fd.get("prep") === "on",
      nudge: fd.get("nudge") === "on",
      research: fd.get("research") === "on",
    });
    const cats = fd.getAll("category").map(String);
    for (const id of cats) {
      await setCategoryFlags(sql, id, { is_active: fd.get(`active_${id}`) === "on", ai_allowed: fd.get(`ai_${id}`) === "on" });
    }
    refresh();
    return ok("ライフの設定を保存しました");
  } catch (e) {
    return fail(e);
  }
}

export async function runLifeAnalysisAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const m = Number(fd.get("months"));
    const months = ([1, 3, 6, 12] as const).find((x) => x === m) ?? 1;
    const sql = await getDb();
    const r = await runLifeAnalysis(sql, months, "manual");
    const taskIds = await autoTasksFromSuggestions(sql, r.suggestionIds);
    if (taskIds.length) scheduleTeamRun(taskIds);
    kickNotifications();
    refresh();
    return ok(r.message);
  } catch (e) {
    return fail(e);
  }
}

export async function setLifeSuggestionStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await setSuggestionStatus(sql, String(fd.get("id") ?? ""), String(fd.get("status") ?? ""), String(fd.get("note") ?? ""));
    refresh();
    return ok("提案の状態を変更しました");
  } catch (e) {
    return fail(e);
  }
}

export async function suggestionToTeamAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const r = await suggestionToTeam(sql, String(fd.get("id") ?? ""), "manual");
    if (r.ok && r.taskId) scheduleTeamRun([r.taskId]);
    refresh();
    return r.ok ? ok(r.message) : { ok: false, error: r.message, ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}
