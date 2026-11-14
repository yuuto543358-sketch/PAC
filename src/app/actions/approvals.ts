"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { decideApproval, executeApprovedAction, resubmitApproval } from "@/lib/repo/approvals";
import { audit } from "@/lib/repo/audit";
import { scheduleTeamRun } from "@/lib/workflow/trigger";
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
    // 成果物を差し戻したら、チームがすぐ修正に取りかかる
    if (decision === "reject" && isDeliverable && a?.task_id) scheduleTeamRun([a.task_id]);
    // SNSへの投稿は、承認したらすぐにアプリが投稿する（そのSNSの設定が済んでいるとき）
    let snsMessage: string | null = null;
    let snsFailed = false;
    if (decision === "approve" && a?.action_type === "sns_post") {
      const r = await executeApprovedAction(sql, id);
      if (r.ok) snsMessage = `承認しました。${r.summary.replace(/\s*https?:\/\/\S+$/, "")}`;
      else if (r.reason === "not_implemented") snsMessage = "承認しました。SNSの設定がまだないため、「内容をコピー」を使って投稿してください";
      else {
        snsFailed = true;
        snsMessage = `承認しましたが、投稿できませんでした：${r.message}`;
      }
    }
    refresh();
    if (snsMessage) return snsFailed ? { ok: false, error: snsMessage, ts: Date.now() } : { ok: true, message: snsMessage, ts: Date.now() };
    const msg =
      decision === "approve"
        ? isDeliverable
          ? "承認しました。業務完了です"
          : ownerSends
            ? "承認しました。下のボタンから、ご自身で送ってください"
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
