"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { remakeMediaAction } from "@/app/actions/media";

export function RemakeMediaButton({ taskId, label = "足りない絵と声を作る" }: { taskId: string; label?: string }) {
  return (
    <ActionForm action={remakeMediaAction} className="mt-2 space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      <SubmitButton className="btn-tinted w-full" pendingText="作っています（1〜2分）…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
