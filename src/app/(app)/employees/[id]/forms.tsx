"use client";

import { useActionState, useState } from "react";
import { directInstructionAction, type ChatActionState } from "@/app/actions/chat";
import { rateEmployeeAction } from "@/app/actions/employees";
import { ActionForm, FormError, SubmitButton } from "@/components/forms";

export function DirectInstructionForm({ employeeId }: { employeeId: string }) {
  const [state, action] = useActionState<ChatActionState, FormData>(directInstructionAction, {});
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="employeeId" value={employeeId} />
      <textarea name="message" required maxLength={2000} rows={3} className="field" placeholder="例：今週中に、低コストで始められる副業のアイデアを3つ考えてください" />
      <FormError message={state.error} />
      <SubmitButton pendingText="送信中…（AIが考えています）">指示を送る</SubmitButton>
      <p className="text-[12px] text-muted">送信するとAIが1回呼び出され、API利用料がかかります（通常1円未満）。</p>
    </form>
  );
}

export function RatingForm({ employeeId }: { employeeId: string }) {
  const [rating, setRating] = useState(0);
  return (
    <ActionForm action={rateEmployeeAction} resetOnSuccess>
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="rating" value={rating || ""} />
      <div className="flex items-center justify-center gap-1" role="radiogroup" aria-label="評価">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n}点`}
            onClick={() => setRating(n)}
            className={`flex h-12 w-12 items-center justify-center text-[34px] transition-transform active:scale-90 ${n <= rating ? "text-accent" : "text-surface-3"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea name="comment" rows={2} maxLength={1000} className="field" placeholder="コメント（任意）：良かった点・直してほしい点" />
      <SubmitButton className="btn-secondary w-full">評価を記録する</SubmitButton>
    </ActionForm>
  );
}
