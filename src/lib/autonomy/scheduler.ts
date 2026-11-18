import "server-only";
import { runDueSeries } from "@/lib/series";
import { runMediaEngine, type EngineResult } from "@/lib/mediaco/engine";
import type { Sql } from "@/lib/db";
import { createStepLogger } from "@/lib/log";
import { getSettings } from "@/lib/repo/settings";
import type { ReportResult } from "./reports";
import { runSnsPlanning, type SnsPlanResult } from "./sns";
import { runLifeJobs, type LifeJobsResult } from "@/lib/life/jobs";

// 定期実行（1日1回、朝7時半ごろに動く）で行う「自主的な仕事」。
// 同じ日に2回動いても二重に実行しないよう、実行した日をデータベースに記録します。

export type ScheduledJobsResult = {
  ran: string[];
  skipped: string[];
  sns?: SnsPlanResult;
  life?: LifeJobsResult;
  /** AI Media Company の自動運営 */
  media?: EngineResult;
  reports: ReportResult[];
  /** チームでの作業を始めた業務 */
  taskIds: string[];
};

export { jstDateParts } from "@/lib/format";
import { jstDateParts } from "@/lib/format";

type ClaimColumn =
  | "last_daily_report_on"
  | "last_weekly_report_on"
  | "last_monthly_report_on"
  | "last_sns_plan_on"
  | "last_life_question_on"
  | "last_life_analysis_on"
  | "last_life_review_on"
  | "last_life_nudge_on"
  | "last_life_prep_on"
  | "last_life_research_on";

/**
 * 「今日この仕事をするのは自分」という権利を取る。すでに今日実行済みなら false。
 * （1つの更新文で判定と記録を同時に行うので、同時に2か所で動いても片方しか実行しない）
 */
async function claim(sql: Sql, column: ClaimColumn, date: string): Promise<boolean> {
  const rows = await sql.unsafe<{ id: number }[]>(
    `update company_settings set ${column} = $1::date
     where id = 1 and (${column} is null or ${column} < $1::date)
     returning id`,
    [date],
  );
  return rows.length > 0;
}

export async function runScheduledJobs(sql: Sql, now: Date = new Date()): Promise<ScheduledJobsResult> {
  const log = createStepLogger("scheduler");
  const settings = await getSettings(sql);
  const result: ScheduledJobsResult = { ran: [], skipped: [], reports: [], taskIds: [] };
  if (settings.life_enabled) {
    // ライフインテリジェンス（いまは使っていない。設定でオンにしたときだけ）
    const { date, weekday } = jstDateParts(now);
    result.life = await runLifeJobs(sql, date, weekday, now, (col) => claim(sql, col, date));
    if (result.life.questions?.created) result.ran.push("life_questions");
    if (result.life.review) result.ran.push("life_review");
    if (result.life.nudges) result.ran.push("life_nudges");
    if (result.life.prepTaskIds?.length) result.ran.push("life_prep");
    if (result.life.researchReportId) result.ran.push("self_research");
    if (result.life.analyses.length) result.ran.push("life_analysis");
    result.taskIds.push(...result.life.taskIds);
  }
  if (settings.emergency_stop) {
    result.skipped.push("緊急停止中のため");
    return result;
  }
  if (settings.media_enabled) {
    // AI Media Company：市場調査・記事づくり・Xの投稿案・分析などを、次にやるべき順に進める（1回の実行で最大4つ）
    try {
      result.media = await runMediaEngine(sql, { now, maxSteps: 4, deadlineMs: 150_000, trigger: "scheduled" });
      if (result.media.steps.length) result.ran.push("media");
    } catch (err) {
      log.fail("media engine", err);
    }
  }
  {
    // 作り続けるシリーズ：予定日になったら次の回を作り始める（毎回確認・AIはここでは使わない）
    const series = await runDueSeries(sql, now);
    if (series.created.length) {
      result.ran.push("series");
      result.taskIds.push(...series.created.map((c) => c.taskId));
    }
  }
  const { date, weekday } = jstDateParts(now);
  const isMonday = weekday === 1;

  // SNSの投稿案: 「SNS運用」の設定で動く
  const snsFreq = settings.sns_plan_frequency;
  if (snsFreq === "daily" || (snsFreq === "weekly" && isMonday)) {
    if (await claim(sql, "last_sns_plan_on", date)) {
      result.sns = await runSnsPlanning(sql, "scheduled");
      result.ran.push("sns_plan");
    } else {
      result.skipped.push("SNSの投稿案は今日すでに作成済み");
    }
  }

  // 日報・週報・月報は、自動では作らない（AIの費用を使うわりに、なくても困らないため。経営者の方針 2026年11月）。
  // 必要なときは「報告書」の画面のボタンで作れる。
  log.step("done", { ran: result.ran, skipped: result.skipped.length });
  return result;
}
