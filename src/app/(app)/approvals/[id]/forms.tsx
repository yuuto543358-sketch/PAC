"use client";

import { decideApprovalAction, resubmitApprovalAction } from "@/app/actions/approvals";
import { ActionForm, SubmitButton } from "@/components/forms";

export function DecisionForm({ approvalId, hash, isOnHold }: { approvalId: string; hash: string; isOnHold: boolean }) {
  return (
    <ActionForm action={decideApprovalAction}>
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="hash" value={hash} />
      <textarea name="note" rows={2} maxLength={2000} className="field" placeholder="判断メモ（任意）：却下の理由など" />
      <div className="grid grid-cols-2 gap-2">
        <SubmitButton name="decision" value="approve" className="btn-primary col-span-2" confirmText="この内容で承認しますか？">
          承認する
        </SubmitButton>
        <SubmitButton name="decision" value="reject" className="btn-danger" confirmText="却下しますか？">
          却下する
        </SubmitButton>
        {!isOnHold ? (
          <SubmitButton name="decision" value="hold" className="btn-secondary">
            保留する
          </SubmitButton>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-60">保留中</span>
        )}
      </div>
    </ActionForm>
  );
}

type Initial = {
  title: string;
  content: string;
  destination: string;
  estimatedCostJpy: number;
  reason: string;
  risks: string;
  afterEffect: string;
};

export function ResubmitForm({ approvalId, hash, initial }: { approvalId: string; hash: string; initial: Initial }) {
  return (
    <ActionForm action={resubmitApprovalAction}>
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="hash" value={hash} />
      <p className="text-xs text-muted">修正すると新しい承認依頼として再提出され、元の依頼は無効になります。修正版はもう一度承認が必要です。</p>
      <label className="block">
        <span className="label">件名</span>
        <input name="title" defaultValue={initial.title} required maxLength={200} className="field" />
      </label>
      <label className="block">
        <span className="label">実行する内容</span>
        <textarea name="content" defaultValue={initial.content} required rows={6} maxLength={20000} className="field" />
      </label>
      <label className="block">
        <span className="label">実行先</span>
        <input name="destination" defaultValue={initial.destination} maxLength={500} className="field" />
      </label>
      <label className="block">
        <span className="label">発生する費用（円）</span>
        <input name="estimatedCostJpy" type="number" min={0} step="1" defaultValue={initial.estimatedCostJpy} className="field" />
      </label>
      <label className="block">
        <span className="label">実行する理由</span>
        <textarea name="reason" defaultValue={initial.reason} rows={2} maxLength={2000} className="field" />
      </label>
      <label className="block">
        <span className="label">想定されるリスク</span>
        <textarea name="risks" defaultValue={initial.risks} rows={2} maxLength={2000} className="field" />
      </label>
      <label className="block">
        <span className="label">承認後に何が起こるか</span>
        <textarea name="afterEffect" defaultValue={initial.afterEffect} rows={2} maxLength={2000} className="field" />
      </label>
      <SubmitButton className="btn-secondary w-full">修正して再提出する</SubmitButton>
    </ActionForm>
  );
}
