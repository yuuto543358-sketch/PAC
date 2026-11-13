"use client";

import { addTaskCommentAction, changeTaskStatusAction, updateDeliverableAction, updateTaskAction } from "@/app/actions/tasks";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PRIORITIES, PRIORITY_LABEL, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/constants";

export function StatusForm({ taskId, options }: { taskId: string; options: TaskStatus[] }) {
  return (
    <ActionForm action={changeTaskStatusAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <label className="block">
        <span className="label">次のステータス</span>
        <select name="to" className="field" defaultValue={options[0]}>
          {options.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <input name="note" maxLength={500} className="field" placeholder="メモ（任意）" />
      <SubmitButton className="btn-primary w-full">ステータスを変更</SubmitButton>
    </ActionForm>
  );
}

export function EditTaskForm({
  taskId,
  employees,
  initial,
}: {
  taskId: string;
  employees: { id: string; name: string }[];
  initial: { assignee: string; priority: string; due: string; budget: number };
}) {
  return (
    <ActionForm action={updateTaskAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">担当社員</span>
          <select name="assignee" className="field" defaultValue={initial.assignee}>
            <option value="">未定</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">優先順位</span>
          <select name="priority" className="field" defaultValue={initial.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">期限</span>
          <input type="date" name="due" defaultValue={initial.due} className="field" />
        </label>
        <label className="block">
          <span className="label">業務予算（円）</span>
          <input type="number" name="budget" min={0} max={10000} step="1" defaultValue={initial.budget} className="field" />
        </label>
      </div>
      <SubmitButton className="btn-secondary w-full">変更を保存</SubmitButton>
    </ActionForm>
  );
}

export function DeliverableForm({ taskId, initial }: { taskId: string; initial: string }) {
  return (
    <ActionForm action={updateDeliverableAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <textarea name="deliverable" rows={5} maxLength={20000} defaultValue={initial} className="field" placeholder="成果物（調査結果・資料・メモなど）を記録できます" />
      <SubmitButton className="btn-secondary w-full">成果物を保存</SubmitButton>
    </ActionForm>
  );
}

export function CommentForm({ taskId }: { taskId: string }) {
  return (
    <ActionForm action={addTaskCommentAction} resetOnSuccess>
      <input type="hidden" name="taskId" value={taskId} />
      <textarea name="comment" rows={2} maxLength={2000} required className="field" placeholder="履歴にコメントを追加（修正指示・メモなど）" />
      <SubmitButton className="btn-secondary w-full">コメントを追加</SubmitButton>
    </ActionForm>
  );
}
