"use client";

import { useState } from "react";
import { addLedgerEntryAction, voidLedgerEntryAction } from "@/app/actions/ledger";
import { ActionForm, SubmitButton } from "@/components/forms";
import { LEDGER_CATEGORIES, type LedgerKind } from "@/lib/constants";

export function LedgerEntryForm({
  today,
  businesses,
  defaultBusinessId,
}: {
  today: string;
  businesses: { id: string; name: string }[];
  defaultBusinessId?: string;
}) {
  const [kind, setKind] = useState<LedgerKind>("income");
  return (
    <ActionForm action={addLedgerEntryAction} resetOnSuccess>
      <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-surface-3 p-1" role="radiogroup" aria-label="収益か費用か">
        {(["income", "expense"] as const).map((k) => (
          <label
            key={k}
            className={`cursor-pointer rounded-[9px] py-2 text-center text-[14px] font-semibold ${kind === k ? "bg-surface text-ink shadow-card" : "text-muted"}`}
          >
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
            {k === "income" ? "入ったお金（収益）" : "出たお金（費用）"}
          </label>
        ))}
      </div>
      <label className="block">
        <span className="label">金額（円）</span>
        <input name="amount_jpy" type="number" inputMode="numeric" min={1} max={100000000} step={1} required className="field" placeholder="例：3000" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="label">日付</span>
          <input name="occurred_on" type="date" defaultValue={today} required className="field" />
        </label>
        <label className="block">
          <span className="label">種類</span>
          <select name="category" key={kind} defaultValue={LEDGER_CATEGORIES[kind][0]} className="field">
            {LEDGER_CATEGORIES[kind].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">どの事業のお金？（なくてもOK）</span>
        <select name="business_project_id" defaultValue={defaultBusinessId ?? ""} className="field">
          <option value="">事業に関係なし</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">メモ（なくてもOK）</span>
        <input name="description" maxLength={500} className="field" placeholder="例：ココナラで翻訳の注文1件" />
      </label>
      <SubmitButton className="btn-primary w-full">記録する</SubmitButton>
      <p className="text-xs text-muted">記録はあとから変更・削除できません。間違えたときは「取り消し」にして、新しく記録してください。</p>
    </ActionForm>
  );
}

export function VoidLedgerForm({ id }: { id: string }) {
  return (
    <ActionForm action={voidLedgerEntryAction} className="mt-2 space-y-2">
      <input type="hidden" name="id" value={id} />
      <input name="reason" required maxLength={300} className="field" placeholder="取り消す理由（例：金額の打ち間違い）" />
      <SubmitButton className="btn-secondary w-full text-danger" confirmText="この記録を取り消しますか？（元に戻せません）">
        この記録を取り消す
      </SubmitButton>
    </ActionForm>
  );
}
