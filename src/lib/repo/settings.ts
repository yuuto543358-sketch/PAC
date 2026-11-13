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

export async function getSettings(db: Db): Promise<CompanySettings> {
  const [row] = await db<CompanySettings[]>`select * from company_settings where id = 1`;
  if (!row) throw new Error("会社設定が見つかりません");
  return row;
}

export async function getBudget(db: Db): Promise<Budget> {
  const [row] = await db<Budget[]>`select * from budgets where id = 1`;
  if (!row) throw new Error("予算設定が見つかりません");
  return row;
}
