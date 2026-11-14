import "server-only";
import type { Sql } from "@/lib/db";
import { enqueueNotification } from "@/lib/notify";
import { runLifeAnalysis, type AnalysisResult } from "./analysis";
import { createQuestionBatch, type BatchResult } from "./questions";
import { autoTasksFromSuggestions } from "./team";

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

export type LifeJobsResult = { questions?: BatchResult; analyses: AnalysisResult[]; taskIds: string[] };

export async function runLifeJobs(
  sql: Sql,
  date: string,
  now: Date,
  claim: (column: "last_life_question_on" | "last_life_analysis_on") => Promise<boolean>,
): Promise<LifeJobsResult> {
  const result: LifeJobsResult = { analyses: [], taskIds: [] };
  if (await claim("last_life_question_on")) {
    result.questions = await createQuestionBatch(sql, "scheduled", now);
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
