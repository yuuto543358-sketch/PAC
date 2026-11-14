"use client";

import { useState } from "react";
import {
  addLifeRecordAction,
  answerQuestionAction,
  askNowAction,
  confirmLifeRecordAction,
  deleteLifeRecordAction,
  runLifeAnalysisAction,
  setLifeSuggestionStatusAction,
  suggestionToTeamAction,
  updateLifeRecordAction,
  updateLifeSettingsAction,
} from "@/app/actions/life";
import { ActionForm, SubmitButton } from "@/components/forms";
import { LIFE_FREQUENCY_OPTIONS, LIFE_SUGGESTION_STATUSES, LIFE_SUGGESTION_STATUS_LABEL } from "@/lib/constants";

type Q = {
  id: string;
  text: string;
  reason: string;
  value_type: string | null;
  unit: string | null;
  choices: string[] | null;
  status: string;
};

/** 値の入力欄（数字・選択肢・文章） */
function ValueInput({ valueType, unit, choices, defaultValue }: { valueType: string | null; unit: string | null; choices: string[] | null; defaultValue?: string }) {
  const [picked, setPicked] = useState(defaultValue ?? "");
  if (valueType === "choice" && choices?.length) {
    return (
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {choices.map((c) => (
          <label
            key={c}
            className={`cursor-pointer rounded-full px-3.5 py-2 text-[14px] font-semibold ring-1 ${picked === c ? "bg-brand text-brand-fg ring-brand" : "bg-surface text-ink ring-line"}`}
          >
            <input type="radio" name="value" value={c} checked={picked === c} onChange={() => setPicked(c)} className="sr-only" />
            {c}
          </label>
        ))}
      </div>
    );
  }
  if (valueType === "number") {
    return (
      <div className="flex items-center gap-2">
        <input name="value" type="text" inputMode="decimal" defaultValue={defaultValue} className="field" placeholder="例：3980" aria-label="答え（数字）" />
        {unit && <span className="shrink-0 text-[14px] text-muted">{unit}</span>}
      </div>
    );
  }
  return <textarea name="value" rows={3} maxLength={2000} defaultValue={defaultValue} className="field" placeholder="思いつく範囲でOKです" aria-label="答え" />;
}

export function QuestionCard({ q }: { q: Q }) {
  return (
    <ActionForm action={answerQuestionAction} className="card space-y-3 p-4">
      <input type="hidden" name="id" value={q.id} />
      <div>
        <p className="text-[16px] leading-relaxed font-semibold">{q.text}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">質問の理由：{q.reason}</p>
      </div>
      <ValueInput valueType={q.value_type} unit={q.unit} choices={q.choices} />
      <SubmitButton className="btn-primary w-full" name="act" value="answer">
        答える
      </SubmitButton>
      <div className="grid grid-cols-3 gap-2">
        <SubmitButton className="btn-secondary px-1 text-[13px]" name="act" value="later" pendingText="…">
          後で答える
        </SubmitButton>
        <SubmitButton className="btn-secondary px-1 text-[13px]" name="act" value="skip" pendingText="…">
          スキップ
        </SubmitButton>
        <SubmitButton className="btn-secondary px-1 text-[13px]" name="act" value="unknown" pendingText="…">
          分からない
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AskNowButton() {
  return (
    <ActionForm action={askNowAction}>
      <SubmitButton className="btn-secondary w-full">今すぐ質問をもらう（無料）</SubmitButton>
    </ActionForm>
  );
}

export function AddRecordForm({ field }: { field: { id: string; value_type: string; unit: string; choices: string[]; kind: string; period: string } }) {
  return (
    <ActionForm action={addLifeRecordAction} resetOnSuccess>
      <input type="hidden" name="fieldId" value={field.id} />
      {field.kind === "periodic" && field.period === "month" && (
        <label className="block">
          <span className="label">いつの分？</span>
          <input name="period" type="month" required className="field" />
        </label>
      )}
      {field.kind === "periodic" && field.period === "week" && (
        <label className="block">
          <span className="label">いつまでの1週間？</span>
          <input name="period" type="date" required className="field" />
        </label>
      )}
      <ValueInput valueType={field.value_type} unit={field.unit} choices={field.choices} />
      <SubmitButton className="btn-primary w-full">記録する</SubmitButton>
    </ActionForm>
  );
}

export function RecordActions({
  id,
  field,
  current,
  canConfirm,
}: {
  id: string;
  field: { value_type: string; unit: string; choices: string[] };
  current: string;
  canConfirm: boolean;
}) {
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-[12px] text-brand">直す・削除する</summary>
      <div className="mt-2 space-y-3">
        {canConfirm && (
          <ActionForm action={confirmLifeRecordAction}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton className="btn-tinted w-full">いまも同じ（確認だけする）</SubmitButton>
          </ActionForm>
        )}
        <ActionForm action={updateLifeRecordAction}>
          <input type="hidden" name="id" value={id} />
          <ValueInput valueType={field.value_type} unit={field.unit} choices={field.choices} defaultValue={current} />
          <input name="reason" maxLength={300} className="field" placeholder="直す理由（なくてもOK）" />
          <SubmitButton className="btn-secondary w-full">この記録を直す</SubmitButton>
        </ActionForm>
        <ActionForm action={deleteLifeRecordAction}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton className="btn-secondary w-full text-danger" confirmText="この記録を完全に削除しますか？（履歴も消え、元に戻せません）">
            この記録を削除する
          </SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}

export function LifeSettingsForm({
  initial,
  categories,
}: {
  initial: { frequency: string; perBatch: number; autoTask: boolean; review: boolean; prep: boolean; nudge: boolean; research: boolean };
  categories: { id: string; name: string; is_active: boolean; ai_allowed: boolean }[];
}) {
  return (
    <ActionForm action={updateLifeSettingsAction}>
      <label className="block">
        <span className="label">質問の頻度</span>
        <select name="frequency" defaultValue={initial.frequency} className="field">
          {LIFE_FREQUENCY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">1回の質問数</span>
        <select name="perBatch" defaultValue={String(initial.perBatch)} className="field">
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}問
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="autoTask" defaultChecked={initial.autoTask} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]" />
        <span>
          大事な改善提案は、自動でチームに検討させる
          <span className="block text-xs text-muted">同時に進めるのは2件まで。調べる・比べる・確認するところまでで、契約や購入はしません</span>
        </span>
      </label>
      <fieldset className="space-y-2">
        <legend className="label">AI社員が裏で動く仕事</legend>
        {[
          { name: "review", label: "週のふりかえり（月曜の朝・約1円）", on: initial.review },
          { name: "nudge", label: "記録の変化に気づいて、森野が声をかける（月 約10〜30円）", on: initial.nudge },
          { name: "prep", label: "予定が近づいたら、白石がチームに下調べを頼む（1件 約10〜20円）", on: initial.prep },
          { name: "research", label: "社員の自主研究（毎週木曜に1人ずつ・約3〜6円）", on: initial.research },
        ].map((t) => (
          <label key={t.name} className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" name={t.name} defaultChecked={t.on} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]" />
            <span>{t.label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="label">カテゴリ</legend>
        <ul className="divide-y divide-separator rounded-[12px] bg-surface-2/70">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-[14px]">
              <input type="hidden" name="category" value={c.id} />
              <span className="font-medium">{c.name}</span>
              <span className="flex shrink-0 gap-3 text-[12px]">
                <label className="flex items-center gap-1">
                  <input type="checkbox" name={`active_${c.id}`} defaultChecked={c.is_active} className="h-4 w-4 accent-[var(--brand)]" />
                  使う
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" name={`ai_${c.id}`} defaultChecked={c.ai_allowed} className="h-4 w-4 accent-[var(--brand)]" />
                  AIに渡す
                </label>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">「使う」を外すと、そのカテゴリの質問をしません。「AIに渡す」を外すと、分析のときにそのカテゴリの情報をAI（OpenAI）に送りません。</p>
      </fieldset>
      <SubmitButton className="btn-secondary w-full">ライフの設定を保存</SubmitButton>
    </ActionForm>
  );
}

export function RunAnalysisButton({ months }: { months: number }) {
  return (
    <ActionForm action={runLifeAnalysisAction}>
      <input type="hidden" name="months" value={months} />
      <SubmitButton className="btn-primary w-full" pendingText="森野が分析しています…（1分ほど）">
        今すぐ分析する（約1〜2円）
      </SubmitButton>
    </ActionForm>
  );
}

export function SuggestionStatusForm({ id, current }: { id: string; current: string }) {
  return (
    <ActionForm action={setLifeSuggestionStatusAction}>
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="label">状態</span>
        <select name="status" defaultValue={current} className="field">
          {LIFE_SUGGESTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LIFE_SUGGESTION_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <input name="note" maxLength={1000} className="field" placeholder="メモ（なくてもOK）" />
      <SubmitButton className="btn-secondary w-full">状態を保存</SubmitButton>
    </ActionForm>
  );
}

export function SuggestionTeamButton({ id }: { id: string }) {
  return (
    <ActionForm action={suggestionToTeamAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn-primary w-full" pendingText="社長がチームを編成しています…">
        チームで検討する
      </SubmitButton>
    </ActionForm>
  );
}
