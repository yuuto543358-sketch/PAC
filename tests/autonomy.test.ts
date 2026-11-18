// Phase 3：自主的な仕事探し・Web検索・自動報告・定期実行のテスト（AI_MOCK=1 のテスト用応答で動かす）
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { actualCostUsd, estimateCostJpy, WEB_SEARCH_CALL_USD } from "@/lib/pricing";
import { reserveApiCall, failApiCall } from "@/lib/budget";
import { extractWebSearch, webSearchMaxUsd } from "@/lib/ai/client";
import { collectStats, formatStats, generateCompanyReport } from "@/lib/autonomy/reports";
import { jstDateParts, runScheduledJobs } from "@/lib/autonomy/scheduler";
import { createTask } from "@/lib/repo/tasks";
import { initWorkflow } from "@/lib/workflow/repo";
import { listRoomMessages } from "@/lib/workflow/repo";
import { runWorkflows, shouldUseWebSearch } from "@/lib/workflow/engine";

async function resetState() {
  const sql = await getDb();
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, daily_limit_jpy = 100000,
    max_calls_per_day = 2000, max_calls_per_minute = 60, max_calls_per_task = 20, per_task_limit_jpy = 30`;
  await sql`update company_settings set media_enabled = false, emergency_stop = false, web_research_enabled = true,
    sns_plan_frequency = 'off', last_sns_plan_on = null, last_daily_report_on = null, last_weekly_report_on = null`;
  // ライフの定期処理はこのテストの対象外（質問は停止、分析は実行済みの扱い）
  await sql`update company_settings set life_question_frequency = 'off', last_life_analysis_on = '2099-12-31', last_life_review_on = '2099-12-31', life_nudge_enabled = false, life_prep_enabled = false, life_research_enabled = false`;
  // 「AIが見つけた業務」の同時進行の上限（2件）に掛からないよう、過去のテストの業務を終わらせる
  await sql`update tasks set status = 'completed', completed_at = now() where source = 'ai_discovered' and status not in ('completed','rejected','failed')`;
  await sql.begin(async (tx) => {
    await tx`alter table api_usage disable trigger api_usage_guard`;
    await tx`update api_usage set created_at = created_at - interval '2 minutes' where created_at > now() - interval '2 minutes'`;
    await tx`alter table api_usage enable trigger api_usage_guard`;
  });
}

beforeAll(async () => {
  await closeDb();
});
beforeEach(resetState);
afterAll(async () => {
  const sql = await getDb();
  await sql`update company_settings set sns_plan_frequency = 'off', last_sns_plan_on = null, last_daily_report_on = null, last_weekly_report_on = null`;
  await closeDb();
});

describe("Web検索の費用", () => {
  it("Web検索の回数を費用に加える", () => {
    const base = actualCostUsd("gpt-5-mini", { input_tokens: 1000, output_tokens: 500 })!;
    const withSearch = actualCostUsd("gpt-5-mini", { input_tokens: 1000, output_tokens: 500, web_search_calls: 2 })!;
    expect(withSearch - base).toBeCloseTo(2 * WEB_SEARCH_CALL_USD, 10);
  });

  it("見積もり（予約）にWeb検索の最大費用を上乗せする", async () => {
    const sql = await getDb();
    const plain = estimateCostJpy("gpt-5-mini", 1000, 1000, 150)!;
    const extra = webSearchMaxUsd("gpt-5-mini", 2);
    expect(extra).toBeGreaterThan(2 * WEB_SEARCH_CALL_USD);
    const r = await reserveApiCall(sql, {
      model: "gpt-5-mini",
      purpose: "test:web",
      estInputTokens: 1000,
      maxOutputTokens: 1000,
      extraMaxUsd: extra,
    });
    const rate = r.usdJpyRate;
    const expected = estimateCostJpy("gpt-5-mini", 1000, 1000, rate)! + extra * rate * 1.2;
    expect(r.estimatedCostJpy).toBeCloseTo(expected, 6);
    expect(r.estimatedCostJpy).toBeGreaterThan(plain);
    await failApiCall(sql, r, "テスト", false);
  });

  it("応答から検索回数と参照ページを取り出す（重複・追跡用パラメータ・危険なURLを除く）", () => {
    const fake = {
      output: [
        { type: "web_search_call", id: "a", status: "completed", action: { type: "search", query: "x", sources: [{ type: "url", url: "https://example.com/a?utm_source=openai" }] } },
        { type: "web_search_call", id: "b", status: "completed", action: { type: "open_page", url: "javascript:alert(1)" } },
        {
          type: "message",
          id: "m",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "...",
              annotations: [
                { type: "url_citation", url: "https://example.com/a?utm_source=openai", title: "ページA", start_index: 0, end_index: 1 },
                { type: "url_citation", url: "https://example.org/b", title: "ページB", start_index: 0, end_index: 1 },
              ],
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof extractWebSearch>[0];
    const r = extractWebSearch(fake);
    expect(r.calls).toBe(2);
    expect(r.sources).toEqual([
      { url: "https://example.com/a", title: "ページA" },
      { url: "https://example.org/b", title: "ページB" },
    ]);
  });

  it("Web検索を使うのは、許可されているときの調査担当の議論だけ", () => {
    expect(shouldUseWebSearch("discussion", { role_key: "research" }, { web_research_enabled: true })).toBe(true);
    expect(shouldUseWebSearch("discussion", { role_key: "research" }, { web_research_enabled: false })).toBe(false);
    expect(shouldUseWebSearch("discussion", { role_key: "creative" }, { web_research_enabled: true })).toBe(false);
    expect(shouldUseWebSearch("drafting", { role_key: "research" }, { web_research_enabled: true })).toBe(false);
  });
});

describe("調査担当のWeb検索", () => {
  it("業務のチームでは、調査担当がWeb検索して参照ページをグループチャットに残す", async () => {
    const sql = await getDb();
    const r = await createTask(sql, {
      title: `市場の調査 ${Date.now()}`,
      description: "家計の節約アプリについて、いまの市場を調べてください。",
      source: "user",
      assigneeId: "research",
      createdBy: { type: "user" },
    });
    if (!r.created) throw new Error("not created");
    const taskId = r.task.id;
    await initWorkflow(sql, taskId, true);
    await runWorkflows(sql, { taskIds: [taskId], maxSteps: 25, deadlineMs: 60_000 });
    const msgs = await listRoomMessages(sql, taskId, 100);
    const research = msgs.find((m) => m.employee_id === "research" && m.kind === "findings");
    expect(research?.meta.sources?.length).toBeGreaterThan(0);
    const [usage] = await sql<{ n: number }[]>`
      select coalesce(sum(web_search_calls), 0)::int as n from api_usage where task_id = ${taskId}`;
    expect(usage.n).toBeGreaterThan(0);
    // 調査担当以外の発言ではWeb検索しない
    const [others] = await sql<{ n: number }[]>`
      select coalesce(sum(web_search_calls), 0)::int as n from api_usage
      where task_id = ${taskId} and (employee_id is distinct from 'research')`;
    expect(others.n).toBe(0);
  });
});

describe("自動の報告書", () => {
  it("日報を作る（数字はシステムの集計）", async () => {
    const sql = await getDb();
    const r = await generateCompanyReport(sql, "daily", "manual");
    expect(r.ok).toBe(true);
    expect(r.aiUsed).toBe(true);
    const [row] = await sql<{ report_type: string; title: string; content: string; employee_id: string }[]>`
      select report_type, title, content, employee_id from reports where id = ${r.reportId}`;
    expect(row.report_type).toBe("daily");
    expect(row.title).toMatch(/^日報：/);
    expect(row.employee_id).toBe("president");
    expect(row.content).toContain("数字のまとめ（直近1日");
  });

  it("緊急停止中でも、AIを使わずに数字だけの報告書を作る（費用0円）", async () => {
    const sql = await getDb();
    await sql`update company_settings set emergency_stop = true`;
    const r = await generateCompanyReport(sql, "weekly", "manual");
    expect(r.aiUsed).toBe(false);
    expect(r.costJpy).toBe(0);
    const [row] = await sql<{ title: string; content: string }[]>`select title, content from reports where id = ${r.reportId}`;
    expect(row.title).toBe("週報（数字のまとめ）");
    expect(row.content).toContain("緊急停止中");
  });

  it("集計は事実だけを並べる", async () => {
    const sql = await getDb();
    const s = await collectStats(sql, 7);
    expect(s.periodDays).toBe(7);
    expect(s.employeeActivity.length).toBeGreaterThan(0);
    expect(formatStats(s)).toContain("あなたの承認待ち");
  });
});

describe("定期実行", () => {
  it("日本時間の日付と曜日", () => {
    // 2030-01-06 15:30 UTC = 2030-01-07（月）0:30 日本時間
    expect(jstDateParts(new Date("2030-01-06T15:30:00Z"))).toEqual({ date: "2030-01-07", weekday: 1 });
  });

  it("自動で動かす設定が何もなければ、何もしない（事業の候補探し・事業の段階・運営レポートは、もうない）", async () => {
    const sql = await getDb();
    for (const d of ["2030-01-07T00:00:00Z", "2030-01-08T00:00:00Z", "2030-01-11T00:00:00Z"]) {
      const r = await runScheduledJobs(sql, new Date(d)); // 月曜・火曜・金曜
      expect(r.ran).toEqual([]);
    }
  });

  it("SNSの投稿案（1日1回）：同じ日に2回動いても二重に実行しない", async () => {
    const sql = await getDb();
    await sql`update company_settings set sns_plan_frequency = 'daily'`;
    const tuesday = new Date("2030-01-08T00:00:00Z");
    const r1 = await runScheduledJobs(sql, tuesday);
    expect(r1.ran).toEqual(["sns_plan"]);
    expect(r1.reports).toEqual([]);
    const r2 = await runScheduledJobs(sql, tuesday);
    expect(r2.ran).toEqual([]);
    expect(r2.skipped.length).toBe(1);
  });

  it("同時に2つ動いても、片方しか実行しない", async () => {
    const sql = await getDb();
    await sql`update company_settings set sns_plan_frequency = 'weekly'`;
    const monday = new Date("2030-01-07T00:00:00Z");
    const [a, b] = await Promise.all([runScheduledJobs(sql, monday), runScheduledJobs(sql, monday)]);
    const ran = [...a.ran, ...b.ran].sort();
    expect(ran).toEqual(["sns_plan"]);
  });

  it("週1回：月曜以外は何もしない", async () => {
    const sql = await getDb();
    await sql`update company_settings set sns_plan_frequency = 'weekly'`;
    const r = await runScheduledJobs(sql, new Date("2030-01-09T00:00:00Z"));
    expect(r.ran).toEqual([]);
  });
});
