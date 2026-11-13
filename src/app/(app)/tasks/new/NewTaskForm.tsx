"use client";

import { createTaskAction } from "@/app/actions/tasks";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/constants";

export function NewTaskForm({ employees, defaultBudget }: { employees: { id: string; name: string; role: string }[]; defaultBudget: number }) {
  return (
    <ActionForm action={createTaskAction} className="card space-y-4 p-4">
      <label className="block">
        <span className="label">業務名（必須）</span>
        <input name="title" required maxLength={200} className="field" placeholder="例：低価格のデジタル商品の市場調査" />
      </label>
      <label className="block">
        <span className="label">内容・目的・完了条件</span>
        <textarea name="description" rows={4} maxLength={5000} className="field" placeholder="何のために、何を、どこまでやれば完了か" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">担当社員</span>
          <select name="assignee" className="field" defaultValue="">
            <option value="">未定（社長が決める）</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}（{e.role}）
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">優先順位</span>
          <select name="priority" className="field" defaultValue="medium">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">期限</span>
          <input type="date" name="due" className="field" />
        </label>
        <label className="block">
          <span className="label">業務予算（円）</span>
          <input type="number" name="budget" min={0} max={10000} step="1" defaultValue={defaultBudget} className="field" />
        </label>
      </div>
      <label className="flex items-start gap-3 rounded-[14px] bg-brand-soft p-3.5">
        <input type="checkbox" name="team" defaultChecked className="mt-0.5 h-5 w-5 accent-[var(--brand)]" />
        <span>
          <span className="block text-[15px] font-semibold text-brand">チームで自動的に進める</span>
          <span className="mt-0.5 block text-[12px] text-ink/70">社長がチームを編成し、議論・成果物の作成・監査・報告まで進めます。あなたは最後に承認するだけです（AI利用料がかかります。1業務あたり通常数円〜十数円）。</span>
        </span>
      </label>
      <SubmitButton pendingText="登録中…">業務を登録する</SubmitButton>
    </ActionForm>
  );
}
