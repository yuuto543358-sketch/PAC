import "server-only";
import type { Sql } from "@/lib/db";
import { createStepLogger } from "@/lib/log";
import { getSettings } from "@/lib/repo/settings";
import { runDiscovery, type DiscoveryResult } from "./discovery";
import { generateCompanyReport, type ReportResult } from "./reports";

// 定期実行（1日1回、夜中に動く）で行う「自主的な仕事」。
// 設定の「自動で動く頻度」が「停止」なら何もしません。
// 同じ日に2回動いても二重に実行しないよう、実行した日をデータベースに記録します。

export type ScheduledJobsResult = {
  frequency: string;
  ran: string[];
  skipped: string[];
  discovery?: DiscoveryResult;
  reports: ReportResult[];
  /** チームでの作業を始めた業務 */
  taskIds: string[];
};

/** 日本時間の日付（YYYY-MM-DD）と曜日（0=日曜） */
export function jstDateParts(now: Date): { date: string; weekday: number } {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short" }).format(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return { date, weekday };
}

type ClaimColumn = "last_discovery_on" | "last_daily_report_on" | "last_weekly_report_on";

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
  const freq = settings.autorun_frequency;
  const result: ScheduledJobsResult = { frequency: freq, ran: [], skipped: [], reports: [], taskIds: [] };
  if (freq !== "daily" && freq !== "weekly") {
    result.skipped.push("自動で動く頻度が「停止」のため");
    return result;
  }
  if (settings.emergency_stop) {
    result.skipped.push("緊急停止中のため");
    return result;
  }
  const { date, weekday } = jstDateParts(now);
  const isMonday = weekday === 1;

  // 仕事探し: 毎日（daily）または月曜（weekly）
  if (freq === "daily" || isMonday) {
    if (await claim(sql, "last_discovery_on", date)) {
      const r = await runDiscovery(sql, "scheduled");
      result.discovery = r;
      result.taskIds.push(...r.taskIds);
      result.ran.push("discovery");
    } else {
      result.skipped.push("仕事探しは今日すでに実行済み");
    }
  }

  // 日報: 毎日（daily のとき）
  if (freq === "daily") {
    if (await claim(sql, "last_daily_report_on", date)) {
      result.reports.push(await generateCompanyReport(sql, "daily", "scheduled"));
      result.ran.push("daily_report");
    } else {
      result.skipped.push("日報は今日すでに作成済み");
    }
  }

  // 週報: 月曜（daily・weekly どちらでも）
  if (isMonday) {
    if (await claim(sql, "last_weekly_report_on", date)) {
      result.reports.push(await generateCompanyReport(sql, "weekly", "scheduled"));
      result.ran.push("weekly_report");
    } else {
      result.skipped.push("週報は今日すでに作成済み");
    }
  }
  log.step("done", { freq, ran: result.ran, skipped: result.skipped.length });
  return result;
}
