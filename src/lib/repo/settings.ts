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
  /** 調査担当が議論のときにWeb検索を使ってよいか */
  web_research_enabled: boolean;
  /** 見つけた事業候補を、自動でチームに調べさせるか */
  discovery_auto_start: boolean;
  /** 自動の仕事探し・報告書を最後に行った日（日本時間。二重実行を防ぐため） */
  last_discovery_on: Date | null;
  last_daily_report_on: Date | null;
  last_weekly_report_on: Date | null;
  last_monthly_report_on: Date | null;
  /** SNSの投稿案を自動で作る頻度 */
  sns_plan_frequency: string;
  /** 1回に作る投稿案の数 */
  sns_posts_per_plan: number;
  /** （使っていません。以前の自動投稿の上限） */
  sns_monthly_post_limit: number;
  /** 投稿案を作るSNS（x / bluesky） */
  sns_platforms: string[];
  last_sns_plan_on: Date | null;
  /** 生活の質問の頻度（off / low / normal / high） */
  life_question_frequency: string;
  /** 1回の質問数（1〜3） */
  life_questions_per_batch: number;
  /** 大事な改善提案を、自動でチームの業務にするか */
  life_auto_task: boolean;
  last_life_question_on: Date | null;
  last_life_analysis_on: Date | null;
  last_life_review_on: Date | null;
  /** 週のふりかえり（月曜の朝）を作るか */
  life_review_enabled: boolean;
  /** 予定が近づいたら、チームに下調べを頼むか */
  life_prep_enabled: boolean;
  /** 記録の変化に気づいて、森野が声をかけるか */
  life_nudge_enabled: boolean;
  /** 毎週、社員が自主研究のメモを書くか */
  life_research_enabled: boolean;
  last_life_nudge_on: Date | null;
  last_life_prep_on: Date | null;
  last_life_research_on: Date | null;
  last_cron_at: Date | null;
  last_ops_review_on: Date | null;
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
