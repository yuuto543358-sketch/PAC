"use client";

import { planSnsNowAction, updateSnsSettingsAction } from "@/app/actions/sns";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SNS_PLAN_OPTIONS } from "@/lib/constants";

export function PlanSnsButton() {
  return (
    <ActionForm action={planSnsNowAction}>
      <SubmitButton className="btn-primary w-full" pendingText="SNS担当が考えています…（1分ほど）">
        今すぐ投稿案を作る
      </SubmitButton>
    </ActionForm>
  );
}

export function SnsSettingsForm({
  initial,
}: {
  initial: { sns_plan_frequency: string; sns_posts_per_plan: number; sns_monthly_post_limit: number };
}) {
  return (
    <ActionForm action={updateSnsSettingsAction}>
      <label className="block">
        <span className="label">投稿案を自動で作る頻度</span>
        <select name="sns_plan_frequency" defaultValue={initial.sns_plan_frequency} className="field">
          {SNS_PLAN_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="label">1回に作る数</span>
          <input name="sns_posts_per_plan" type="number" min={1} max={7} defaultValue={initial.sns_posts_per_plan} className="field" />
        </label>
        <label className="block">
          <span className="label">1か月の投稿の上限</span>
          <input name="sns_monthly_post_limit" type="number" min={0} max={300} defaultValue={initial.sns_monthly_post_limit} className="field" />
        </label>
      </div>
      <SubmitButton className="btn-secondary w-full">SNS運用の設定を保存</SubmitButton>
    </ActionForm>
  );
}
