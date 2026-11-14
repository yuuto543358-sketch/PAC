"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { sendChatMessage } from "@/lib/ai/chat";
import { scheduleTeamRun } from "@/lib/workflow/trigger";
import { kickNotifications } from "@/lib/notify/trigger";

export type ChatActionState = { ok?: boolean; error?: string; conversationId?: string; ts?: number };

export async function sendChatAction(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  try {
    await assertAuth();
    const employeeId = String(formData.get("employeeId") ?? "");
    const conversationId = String(formData.get("conversationId") ?? "") || null;
    const message = String(formData.get("message") ?? "");
    const advanced = formData.get("advanced") === "on";
    const sql = await getDb();
    const r = await sendChatMessage(sql, employeeId, conversationId, message, advanced);
    if (r.teamTaskIds?.length) scheduleTeamRun(r.teamTaskIds);
    else kickNotifications();
    refresh();
    return { ok: r.ok, error: r.error, conversationId: r.conversationId, ts: Date.now() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "送信に失敗しました", ts: Date.now() };
  }
}

/** 社員詳細画面からの直接指示。送信後にチャット画面へ移動します。 */
export async function directInstructionAction(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  let target: string | null = null;
  try {
    await assertAuth();
    const employeeId = String(formData.get("employeeId") ?? "");
    const message = String(formData.get("message") ?? "");
    const sql = await getDb();
    const r = await sendChatMessage(sql, employeeId, null, message, false);
    if (r.teamTaskIds?.length) scheduleTeamRun(r.teamTaskIds);
    else kickNotifications();
    target = `/employees/${encodeURIComponent(employeeId)}/chat?c=${r.conversationId}`;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "送信に失敗しました", ts: Date.now() };
  }
  redirect(target);
}
