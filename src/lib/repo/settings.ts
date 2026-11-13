import "server-only";
import type { Db } from "@/lib/db";

export type CompanySettings = {
  company_name: string;
  philosophy: string;
  custom_rules: string;
  model_standard: string;
  model_advanced: string;
  advanced_model_allowed: boolean;
  usd_jpy_rate: number;
  autorun_frequency: string;
  notify_approvals: boolean;
  notify_budget: boolean;
  emergency_stop: boolean;
  hosting_cost_jpy_monthly: number;
  session_version: number;
  updated_at: Date;
};

export type Budget = {
  monthly_limit_jpy: number;
  monthly_target_jpy: number;
  emergency_stop_jpy: number;
  per_task_limit_jpy: number;
  daily_limit_jpy: number;
  max_calls_per_task: number;
  max_calls_per_day: number;
  max_calls_per_minute: number;
  updated_at: Date;
};

/** 会社設定を読む。まだ作られていなければ初期値で作ってから読む（初回利用時でも止まらないように）。 */
export async function getSettings(db: Db): Promise<CompanySettings> {
  const [row] = await db<CompanySettings[]>`select * from company_settings where id = 1`;
  if (row) return row;
  await db`insert into company_settings (id) values (1) on conflict do nothing`;
  const [created] = await db<CompanySettings[]>`select * from company_settings where id = 1`;
  if (!created) throw new Error("会社設定を作成できませんでした");
  return created;
}

/** 予算設定を読む。まだ作られていなければ初期値（月2,000円など）で作ってから読む。 */
export async function getBudget(db: Db): Promise<Budget> {
  const [row] = await db<Budget[]>`select * from budgets where id = 1`;
  if (row) return row;
  await db`insert into budgets (id) values (1) on conflict do nothing`;
  const [created] = await db<Budget[]>`select * from budgets where id = 1`;
  if (!created) throw new Error("予算設定を作成できませんでした");
  return created;
}
