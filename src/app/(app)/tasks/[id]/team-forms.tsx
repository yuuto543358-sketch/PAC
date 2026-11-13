"use client";

import { pauseTeamAction, resumeTeamAction, startTeamAction } from "@/app/actions/workflow";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Icon } from "@/components/Icon";

export function StartTeamButton({ taskId }: { taskId: string }) {
  return (
    <ActionForm action={startTeamAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <SubmitButton pendingText="開始中…">
        <Icon name="users" size={20} stroke={2} />
        チームで進める
      </SubmitButton>
    </ActionForm>
  );
}

export function PauseResumeButton({ taskId, paused }: { taskId: string; paused: boolean }) {
  return (
    <ActionForm action={paused ? resumeTeamAction : pauseTeamAction} className="">
      <input type="hidden" name="taskId" value={taskId} />
      <SubmitButton className={paused ? "btn-primary w-full" : "btn-secondary w-full"} pendingText="…">
        <Icon name={paused ? "sparkles" : "clock"} size={18} stroke={2} />
        {paused ? "再開する" : "一時停止する"}
      </SubmitButton>
    </ActionForm>
  );
}
