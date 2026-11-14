"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { decideApproval, resubmitApproval } from "@/lib/repo/approvals";
import { audit } from "@/lib/repo/audit";
import { scheduleTeamRun } from "@/lib/workflow/trigger";
import { advanceBusiness } from "@/lib/business/pipeline";
import type { ActionState } from "@/components/forms";

export async function decideApprovalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const id = String(fd.get("approvalId") ?? "");
    const decision = String(fd.get("decision") ?? "");
    if (decision !== "approve" && decision !== "reject" && decision !== "hold") throw new Error("操作が正しくありません");
    const sql = await getDb();
    await decideApproval(sql, id, decision, String(fd.get("note") ?? ""), String(fd.get("hash") ?? ""));
    await audit(sql, "user", `approval_${decision}`, "approval", id);
    const [a] = await sql<{ task_id: string | null; action_type: string }[]>`select task_id, action_type from approvals where id = ${id}`;
    const isDeliverable = a?.action_type === "accept_deliverable";
    const ownerSends = a?.action_type === "send_message";
    const ownerPosts = a?.action_type === "sns_post";
    // 成果物を差し戻したら、チームがすぐ修正に取りかかる
    if (decision === "reject" && isDeliverable && a?.task_id) scheduleTeamRun([a.task_id]);
    // 事業の段階の成果物を受け取ったら、次の段階（出品の準備など）を自動で始める
    let nextStage = false;
    if (decision === "approve" && isDeliverable && a?.task_id) {
      const [t] = await sql<{ business_project_id: string | null }[]>`select business_project_id from tasks where id = ${a.task_id}`;
      if (t?.business_project_id) {
        const started = await advanceBusiness(sql, t.business_project_id);
        if (started.length) scheduleTeamRun(started);
        nextStage = started.length > 0;
      }
    }
    refresh();
    const msg =
      decision === "approve"
        ? isDeliverable
          ? nextStage
            ? "承認しました。次の段階をチームが始めました"
            : "承認しました。業務完了です"
          : ownerSends
            ? "承認しました。下のボタンから、ご自身で送ってください"
            : ownerPosts
              ? "承認しました。下のボタンから、ご自身で投稿してください"
              : "承認しました"
        : decision === "reject"
          ? isDeliverable
            ? "差し戻しました。チームが修正します"
            : "却下しました"
          : "保留にしました";
    return { ok: true, message: msg, ts: Date.now() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() };
  }
}

export async function resubmitApprovalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    await assertAuth();
    const id = String(fd.get("approvalId") ?? "");
    const cost = Number(fd.get("estimatedCostJpy"));
    if (!Number.isFinite(cost) || cost < 0) throw new Error("費用は0以上の数字で入力してください");
    const sql = await getDb();
    const newId = await resubmitApproval(
      sql,
      id,
      {
        title: String(fd.get("title") ?? ""),
        content: String(fd.get("content") ?? ""),
        destination: String(fd.get("destination") ?? ""),
        estimatedCostJpy: cost,
        reason: String(fd.get("reason") ?? ""),
        risks: String(fd.get("risks") ?? ""),
        afterEffect: String(fd.get("afterEffect") ?? ""),
      },
      String(fd.get("hash") ?? ""),
    );
    await audit(sql, "user", "approval_resubmit", "approval", newId, { supersedes: id });
    target = `/approvals/${newId}`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() };
  }
  redirect(target);
}
