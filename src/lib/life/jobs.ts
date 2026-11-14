import "server-only";
import type { Sql } from "@/lib/db";
import { enqueueNotification } from "@/lib/notify";
import { runLifeAnalysis, type AnalysisResult } from "./analysis";
import { createQuestionBatch, type BatchResult } from "./questions";
import { autoTasksFromSuggestions } from "./team";
import { runWeeklyReview, type ReviewResult } from "./review";
import { habitProgressList } from "./habits";
import { listEvents } from "./events";
import { getSettings } from "@/lib/repo/settings";

// ライフインテリジェンスの定期処理（毎朝のサーバーの定期実行から呼ばれる。アプリを開いていなくても動く）。
// 1. 質問の日なら、次に聞くことを選んで質問を作る（AIなし・0円）
// 2. 月の初めに、分析と改善提案を作る（毎月：1か月／1・4・7・10月：3か月／1・7月：6か月／1月：12か月）
// 3. 優先度の高い提案は、設定がオンならチームの業務にする（同時に2件まで）

/** その日に作る分析の期間（日本時間の日付 'YYYY-MM-DD'） */
export function analysisPeriodsFor(date: string): (1 | 3 | 6 | 12)[] {
  if (!date.endsWith("-01")) return [];
  const m = Number(date.slice(5, 7));
  const out: (1 | 3 | 6 | 12)[] = [1];
  if ([1, 4, 7, 10].includes(m)) out.push(3);
  if ([1, 7].includes(m)) out.push(6);
  if (m === 1) out.push(12);
  return out;
}

export type LifeJobsResult = { questions?: BatchResult; analyses: AnalysisResult[]; review?: ReviewResult; taskIds: string[]; digest?: string | null };

/** 朝のお知らせ（1日1回だけ。質問・今日の習慣・近づいた予定をまとめて1つの通知にする） */
export async function morningDigest(sql: Sql, date: string): Promise<string | null> {
  const [habits, events, [{ n: questions }]] = await Promise.all([
    habitProgressList(sql, date),
    listEvents(sql, date),
    sql<{ n: number }[]>`select count(*)::int as n from life_questions where status = 'pending' or (status = 'later' and remind_after <= now())`,
  ]);
  const parts: string[] = [];
  const todo = habits.filter((h) => h.frequency === "daily" || h.thisWeek < h.target_per_week);
  if (todo.length) parts.push(`今日の習慣${todo.length}つ`);
  if (questions) parts.push(`森野からの質問${questions}問`);
  for (const e of events.filter((x) => x.remindNow).slice(0, 2)) {
    parts.push(e.daysLeft! < 0 ? `「${e.title}」の日を過ぎています` : e.daysLeft === 0 ? `今日は「${e.title}」` : `「${e.title}」まであと${e.daysLeft}日`);
  }
  if (parts.length === 0) return null;
  const body = parts.join("・");
  await enqueueNotification(sql, { kind: "question", title: "おはようございます。今日のお知らせです", body, url: "/", dedupeKey: `morning:${date}` });
  return body;
}

export async function runLifeJobs(
  sql: Sql,
  date: string,
  weekday: number,
  now: Date,
  claim: (column: "last_life_question_on" | "last_life_analysis_on" | "last_life_review_on") => Promise<boolean>,
): Promise<LifeJobsResult> {
  const result: LifeJobsResult = { analyses: [], taskIds: [] };
  if (await claim("last_life_question_on")) {
    result.questions = await createQuestionBatch(sql, "scheduled", now);
    // 朝のお知らせは「質問の処理を今日はじめて行ったとき」に1回だけ
    result.digest = await morningDigest(sql, date);
  }
  // 週のふりかえり（月曜の朝）
  const settings = await getSettings(sql);
  if (weekday === 1 && settings.life_review_enabled && (await claim("last_life_review_on"))) {
    result.review = await runWeeklyReview(sql, "scheduled", now);
    if (result.review.reviewId && result.review.aiUsed) {
      await enqueueNotification(sql, {
        kind: "report",
        title: "森野から先週のふりかえりが届きました",
        body: result.review.message,
        url: `/life/reviews/${result.review.reviewId}`,
        dedupeKey: `life-r:${date}`,
      });
    }
  }
  const periods = analysisPeriodsFor(date);
  if (periods.length && (await claim("last_life_analysis_on"))) {
    for (const m of periods) {
      const a = await runLifeAnalysis(sql, m, "scheduled", now);
      result.analyses.push(a);
      result.taskIds.push(...(await autoTasksFromSuggestions(sql, a.suggestionIds)));
    }
    const count = result.analyses.reduce((n, a) => n + a.suggestionIds.length, 0);
    const first = result.analyses[0];
    if (first?.reportId) {
      await enqueueNotification(sql, {
        kind: "report",
        title: count ? `森野から暮らしの改善提案が${count}件届きました` : "森野から暮らしの分析レポートが届きました",
        body: first.message,
        url: count ? "/life/suggestions" : `/life/reports/${first.reportId}`,
        dedupeKey: `life-a:${date}`,
      });
    }
  }
  return result;
}
