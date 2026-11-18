"use client";

import { createReportNowAction } from "@/app/actions/reports";
import { ActionForm, SubmitButton } from "@/components/forms";

export function ReportNowButtons() {
  return (
    <div className="grid grid-cols-3 gap-2">
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
      <ActionForm action={createReportNowAction}>
        <input type="hidden" name="kind" value="monthly" />
        <SubmitButton className="btn-secondary w-full" pendingText="作成中…">
          月報を作る
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
