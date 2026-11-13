"use client";

import { decideApprovalAction, resubmitApprovalAction } from "@/app/actions/approvals";
import { ActionForm, SubmitButton } from "@/components/forms";

export function DecisionForm({ approvalId, hash, isOnHold }: { approvalId: string; hash: string; isOnHold: boolean }) {
  return (
    <ActionForm action={decideApprovalAction}>
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="hash" value={hash} />
      <label className="block">
        <span className="label">判断メモ（任意）</span>
        <textarea name="note" rows={2} maxLength={2000} className="field" placeholder="却下の理由・注意点など" />
      </label>
      <p className="text-[12px] text-muted">下のボタンで判断します。承認は、この画面に表示されている内容・実行先・費用に対してだけ有効です。</p>
      {/* 画面の下に固定される判断ボタン（iPhone アプリのアクションバー風） */}
      <div
        className="fixed inset-x-0 z-20 bg-[var(--tabbar)] shadow-[0_-0.5px_0_var(--separator)] backdrop-blur-xl backdrop-saturate-150"
        style={{ bottom: "calc(54px + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto grid max-w-2xl grid-cols-[1fr_1fr_1.6fr] gap-2 px-3 py-2.5">
          <SubmitButton name="decision" value="reject" className="btn-secondary min-h-11 px-2 text-[15px] text-danger" confirmText="却下しますか？" pendingText="…">
            却下する
          </SubmitButton>
          {!isOnHold ? (
            <SubmitButton name="decision" value="hold" className="btn-secondary min-h-11 px-2 text-[15px]" pendingText="…">
              保留する
            </SubmitButton>
          ) : (
            <span className="btn-secondary pointer-events-none min-h-11 px-2 text-[15px] opacity-60">保留中</span>
          )}
          <SubmitButton name="decision" value="approve" className="btn-primary min-h-11 px-2 text-[15px]" confirmText="この内容で承認しますか？" pendingText="処理中…">
            承認する
          </SubmitButton>
        </div>
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
