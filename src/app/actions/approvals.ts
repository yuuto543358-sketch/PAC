"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { decideApproval, resubmitApproval } from "@/lib/repo/approvals";
import { audit } from "@/lib/repo/audit";
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
    refresh();
    const msg = decision === "approve" ? "承認しました" : decision === "reject" ? "却下しました" : "保留にしました";
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
