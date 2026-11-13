"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { runWorkflowStep, type StepResult } from "@/lib/workflow/engine";
import { pauseTeam, postInstruction, resumeTeam, startTeam } from "@/lib/workflow/human";
import { scheduleTeamRun } from "@/lib/workflow/trigger";
import type { ActionState } from "@/components/forms";

const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });

export async function startTeamAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const taskId = String(fd.get("taskId") ?? "");
    const sql = await getDb();
    await startTeam(sql, taskId);
    await audit(sql, "user", "team_start", "task", taskId);
    scheduleTeamRun([taskId]);
    refresh();
    return { ok: true, message: "チームでの作業を始めました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function pauseTeamAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const taskId = String(fd.get("taskId") ?? "");
    const sql = await getDb();
    await pauseTeam(sql, taskId);
    await audit(sql, "user", "team_pause", "task", taskId);
    refresh();
    return { ok: true, message: "チームの作業を一時停止しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function resumeTeamAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const taskId = String(fd.get("taskId") ?? "");
    const sql = await getDb();
    await resumeTeam(sql, taskId);
    await audit(sql, "user", "team_resume", "task", taskId);
    scheduleTeamRun([taskId]);
    refresh();
    return { ok: true, message: "チームの作業を再開しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/** グループチャットへの経営者の指示 */
export async function postInstructionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const taskId = String(fd.get("taskId") ?? "");
    const sql = await getDb();
    const r = await postInstruction(sql, taskId, { type: "owner" }, String(fd.get("message") ?? ""));
    await audit(sql, "user", "team_instruction", "task", taskId);
    scheduleTeamRun([taskId]);
    refresh();
    return { ok: true, message: r.resumed ? "指示を送り、チームの作業を再開しました" : "指示を送りました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/** 画面を開いている間、チームの作業を1段階ずつ進める（グループチャット画面から呼ばれる） */
export async function advanceTeamAction(taskId: string): Promise<StepResult | { status: "error"; message: string }> {
  try {
    await assertAuth();
    const sql = await getDb();
    return await runWorkflowStep(sql, taskId, `screen-${Math.random().toString(36).slice(2, 10)}`);
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "処理に失敗しました" };
  }
}
