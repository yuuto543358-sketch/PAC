"use client";

import { planSnsNowAction, updateSnsSettingsAction } from "@/app/actions/sns";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SNS_PLAN_OPTIONS, SNS_PLATFORM_LABEL, SNS_PLATFORMS } from "@/lib/constants";

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
  initial: { sns_plan_frequency: string; sns_posts_per_plan: number; sns_platforms: string[] };
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
      <label className="block">
        <span className="label">1回に作る数</span>
        <input name="sns_posts_per_plan" type="number" min={1} max={7} defaultValue={initial.sns_posts_per_plan} className="field" />
      </label>
      <fieldset>
        <legend className="label">どのSNS向けに作る？</legend>
        <div className="flex gap-4">
          {SNS_PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`platform_${p}`} defaultChecked={initial.sns_platforms.includes(p)} className="h-5 w-5 accent-[var(--brand)]" />
              {SNS_PLATFORM_LABEL[p]}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton className="btn-secondary w-full">SNS運用の設定を保存</SubmitButton>
    </ActionForm>
  );
}
