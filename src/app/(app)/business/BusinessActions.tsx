"use client";

import { createReportNowAction, findWorkNowAction, investigateBusinessAction, setBusinessStatusAction } from "@/app/actions/autonomy";
import { ActionForm, SubmitButton } from "@/components/forms";
import { BUSINESS_STATUS_LABEL, OWNER_BUSINESS_STATUSES, type BusinessStatus } from "@/lib/constants";

export function FindWorkButton({ disabled }: { disabled?: boolean }) {
  return (
    <ActionForm action={findWorkNowAction}>
      <SubmitButton className="btn-primary w-full" pendingText="事業開発担当が探しています…（1分ほど）">
        今すぐ仕事を探す
      </SubmitButton>
      {disabled && <p className="text-center text-xs text-danger">緊急停止中のため動きません</p>}
    </ActionForm>
  );
}

export function ReportNowButtons() {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ActionForm action={createReportNowAction}>
        <input type="hidden" name="kind" value="daily" />
        <SubmitButton className="btn-secondary w-full" pendingText="作成中…">
          日報を作る
        </SubmitButton>
      </ActionForm>
      <ActionForm action={createReportNowAction}>
        <input type="hidden" name="kind" value="weekly" />
        <SubmitButton className="btn-secondary w-full" pendingText="作成中…">
          週報を作る
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

export function InvestigateButton({ id }: { id: string }) {
  return (
    <ActionForm action={investigateBusinessAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn-primary w-full" pendingText="チームを編成しています…">
        チームで調べる
      </SubmitButton>
    </ActionForm>
  );
}

export function BusinessStatusForm({ id, current }: { id: string; current: BusinessStatus }) {
  return (
    <ActionForm action={setBusinessStatusAction}>
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="label">状態</span>
        <select name="status" defaultValue={current} className="field">
          {!OWNER_BUSINESS_STATUSES.includes(current) && (
            <option value={current}>{BUSINESS_STATUS_LABEL[current]}（いまの状態）</option>
          )}
          {OWNER_BUSINESS_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BUSINESS_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">メモ（なくてもOK）</span>
        <textarea name="note" rows={2} maxLength={1000} className="field" placeholder="例：値段をもう少し下げられるか知りたい" />
      </label>
      <SubmitButton className="btn-secondary w-full">状態を保存</SubmitButton>
    </ActionForm>
  );
}
