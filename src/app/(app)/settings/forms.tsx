"use client";

import {
  setEmergencyStopAction,
  updateAutorunAction,
  updateBudgetAction,
  updateCompanyAction,
  updateModelsAction,
  updateOpsCostAction,
} from "@/app/actions/settings";
import { logoutAllDevices } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { AUTORUN_OPTIONS, MODEL_OPTIONS } from "@/lib/constants";

export function EmergencyForm({ on }: { on: boolean }) {
  return (
    <ActionForm action={setEmergencyStopAction}>
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <p className="text-sm">
        状態：{on ? <span className="font-bold text-danger">緊急停止中（AIは動きません）</span> : <span className="font-bold text-success">通常稼働</span>}
      </p>
      <p className="text-xs text-muted">緊急停止すると、すべてのAI呼び出しが即座に止まります。費用が心配なときや、様子がおかしいときに使ってください。</p>
      {on ? (
        <SubmitButton className="btn-primary w-full">緊急停止を解除する</SubmitButton>
      ) : (
        <SubmitButton className="btn-danger w-full" confirmText="AIの呼び出しをすべて止めますか？">
          緊急停止する
        </SubmitButton>
      )}
    </ActionForm>
  );
}

export function CompanyForm({ initial }: { initial: { company_name: string; philosophy: string; custom_rules: string } }) {
  return (
    <ActionForm action={updateCompanyAction}>
      <label className="block">
        <span className="label">会社名</span>
        <input name="company_name" defaultValue={initial.company_name} required maxLength={60} className="field" />
      </label>
      <label className="block">
        <span className="label">会社理念</span>
        <input name="philosophy" defaultValue={initial.philosophy} maxLength={300} className="field" />
      </label>
      <label className="block">
        <span className="label">社内ルール（AI社員が守る追加ルール）</span>
        <textarea name="custom_rules" defaultValue={initial.custom_rules} rows={4} maxLength={3000} className="field" placeholder="例：報告は必ず箇条書きで。土日は提案を控える。" />
      </label>
      <SubmitButton className="btn-secondary w-full">会社情報を保存</SubmitButton>
    </ActionForm>
  );
}

type BudgetInit = {
  monthly_limit_jpy: number;
  monthly_target_jpy: number;
  emergency_stop_jpy: number;
  per_task_limit_jpy: number;
  daily_limit_jpy: number;
  max_calls_per_task: number;
  max_calls_per_day: number;
  max_calls_per_minute: number;
};

export function BudgetForm({ initial }: { initial: BudgetInit }) {
  const f = (name: keyof BudgetInit, label: string, unit: string, step = "1") => (
    <label className="block">
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input name={name} type="number" min={0} step={step} defaultValue={initial[name]} required className="field" />
        <span className="shrink-0 text-sm text-muted">{unit}</span>
      </div>
    </label>
  );
  return (
    <ActionForm action={updateBudgetAction}>
      <div className="grid grid-cols-2 gap-3">
        {f("monthly_limit_jpy", "月間上限", "円")}
        {f("monthly_target_jpy", "通常利用目標", "円")}
        {f("emergency_stop_jpy", "緊急停止ライン", "円")}
        {f("daily_limit_jpy", "1日あたりの上限", "円")}
        {f("per_task_limit_jpy", "1業務あたりの上限", "円")}
        {f("max_calls_per_task", "1業務の呼び出し回数", "回")}
        {f("max_calls_per_day", "1日の呼び出し回数", "回")}
        {f("max_calls_per_minute", "1分の呼び出し回数", "回")}
      </div>
      <p className="text-xs text-muted">緊急停止ラインに達すると、その月は新しいAI処理が止まります。1分あたりの回数制限は、無限ループの防止用です。</p>
      <SubmitButton className="btn-secondary w-full">予算設定を保存</SubmitButton>
    </ActionForm>
  );
}

export function ModelForm({ initial }: { initial: { model_standard: string; model_advanced: string; advanced_model_allowed: boolean; usd_jpy_rate: number } }) {
  return (
    <ActionForm action={updateModelsAction}>
      <label className="block">
        <span className="label">通常業務で使うモデル</span>
        <select name="model_standard" defaultValue={initial.model_standard} className="field">
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">難しい業務で使うモデル</span>
        <select name="model_advanced" defaultValue={initial.model_advanced} className="field">
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="advanced_model_allowed" defaultChecked={initial.advanced_model_allowed} className="h-5 w-5" />
        高性能モデルの利用を許可する（費用が20〜40倍になります）
      </label>
      <label className="block">
        <span className="label">為替レート（1ドルあたりの円）</span>
        <input name="usd_jpy_rate" type="number" min={50} max={500} step="0.01" defaultValue={initial.usd_jpy_rate} className="field" />
      </label>
      <p className="text-xs text-muted">為替レートは費用の計算に使います。実際より少し高めにしておくと安全です。</p>
      <SubmitButton className="btn-secondary w-full">AIモデル設定を保存</SubmitButton>
    </ActionForm>
  );
}

export function AutorunForm({ initial }: { initial: string }) {
  return (
    <ActionForm action={updateAutorunAction}>
      <select name="autorun_frequency" defaultValue={initial} className="field">
        {AUTORUN_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <SubmitButton className="btn-secondary w-full">頻度を保存</SubmitButton>
    </ActionForm>
  );
}

export function OpsCostForm({ initial }: { initial: number }) {
  return (
    <ActionForm action={updateOpsCostAction}>
      <label className="block">
        <span className="label">サーバー・データベース等の月額（円）</span>
        <input name="hosting_cost_jpy_monthly" type="number" min={0} step="1" defaultValue={initial} className="field" />
      </label>
      <p className="text-xs text-muted">無料プランなら0円のままで大丈夫です。</p>
      <SubmitButton className="btn-secondary w-full">運用料金を保存</SubmitButton>
    </ActionForm>
  );
}

export function LogoutAllForm() {
  return (
    <form action={logoutAllDevices}>
      <SubmitButton className="btn-secondary w-full text-danger" confirmText="すべての端末でログアウトしますか？（この端末も含む）">
        すべての端末からログアウト
      </SubmitButton>
    </form>
  );
}
