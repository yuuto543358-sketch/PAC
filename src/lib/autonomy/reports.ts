import "server-only";
import { enqueueNotification } from "@/lib/notify";
import { z } from "zod";
import type { Sql } from "@/lib/db";
import { AiUnavailableError, BudgetBlockedError, callStructured } from "@/lib/ai/client";
import { FIXED_COMPANY_PRINCIPLES, PLAIN_LANGUAGE_RULES } from "@/lib/ai/prompts";
import { BUSINESS_STATUS_LABEL, type BusinessStatus } from "@/lib/constants";
import { createStepLogger } from "@/lib/log";
import { audit } from "@/lib/repo/audit";
import { getBudget, getSettings } from "@/lib/repo/settings";

// 社長（天城 翔）が、会社の状況をまとめた日報・週報を自動で作る仕組み。
// 数字はシステムがデータベースから集計した「事実」で、AIには文章のまとめだけを任せます。

export type ReportKind = "daily" | "weekly" | "monthly";
const REPORT_DAYS: Record<ReportKind, number> = { daily: 1, weekly: 7, monthly: 30 };
const REPORT_LABEL: Record<ReportKind, string> = { daily: "日報", weekly: "週報", monthly: "月報" };

export type CompanyStats = {
  periodDays: number;
  tasksCreated: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksActive: number;
  approvalsPending: { title: string; action_type: string }[];
  approvalsPendingCount: number;
  spendPeriodJpy: number;
  spendMonthJpy: number;
  monthlyLimitJpy: number;
  monthlyTargetJpy: number;
  waitingTeams: { title: string; reason: string }[];
  stoppedTeams: { title: string }[];
  newCandidates: { name: string; status: string }[];
  candidatesByStatus: Record<string, number>;
  employeeActivity: { name: string; calls: number; cost_jpy: number; messages: number }[];
  webSearchCalls: number;
  /** 経営者が記録した、この期間の収益・費用（取り消したものは除く） */
  incomePeriodJpy: number;
  expensePeriodJpy: number;
};

const COST = `coalesce(cost_jpy, estimated_cost_jpy)`;

/** 直近 days 日間の会社の状況を集計（すべてデータベースの事実） */
export async function collectStats(sql: Sql, days: number): Promise<CompanyStats> {
  const since = `now() - interval '${Math.max(1, Math.min(31, Math.floor(days)))} days'`;
  const [tasks] = await sql.unsafe<{ created: number; completed: number; failed: number; active: number }[]>(
    `select
      count(*) filter (where created_at >= ${since})::int as created,
      count(*) filter (where status = 'completed' and completed_at >= ${since})::int as completed,
      count(*) filter (where status = 'failed' and updated_at >= ${since})::int as failed,
      count(*) filter (where status not in ('completed','rejected','failed'))::int as active
    from tasks`,
    [],
    { simple: false },
  );
  const approvals = await sql<{ title: string; action_type: string }[]>`
    select title, action_type from approvals where status = 'pending' order by created_at desc limit 50`;
  const [spend] = await sql.unsafe<{ period: number; month: number; searches: number }[]>(
    `select
      coalesce(sum(${COST}) filter (where created_at >= ${since}), 0)::float8 as period,
      coalesce(sum(${COST}) filter (where created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'), 0)::float8 as month,
      coalesce(sum(web_search_calls) filter (where created_at >= ${since}), 0)::int as searches
    from api_usage`,
    [],
    { simple: false },
  );
  const teams = await sql<{ title: string; phase: string; waiting_reason: string | null }[]>`
    select t.title, w.phase, w.waiting_reason from task_workflows w join tasks t on t.id = w.task_id
    where w.phase in ('waiting_human','stopped') and t.status not in ('completed','rejected','failed')
    order by w.updated_at desc limit 20`;
  const newCandidates = await sql.unsafe<{ name: string; status: string }[]>(
    `select name, status from business_projects where created_at >= ${since} order by created_at desc limit 10`,
    [],
    { simple: false },
  );
  const byStatus = await sql<{ status: string; n: number }[]>`
    select status, count(*)::int as n from business_projects group by status`;
  const activity = await sql.unsafe<{ name: string; calls: number; cost_jpy: number; messages: number }[]>(
    `select e.name,
      (select count(*) from api_usage u where u.employee_id = e.id and u.created_at >= ${since})::int as calls,
      (select coalesce(sum(coalesce(u.cost_jpy, u.estimated_cost_jpy)), 0) from api_usage u where u.employee_id = e.id and u.created_at >= ${since})::float8 as cost_jpy,
      (select count(*) from task_messages m where m.employee_id = e.id and m.created_at >= ${since})::int as messages
    from employees e where e.is_active order by e.sort_order`,
    [],
    { simple: false },
  );
  const budget = await getBudget(sql);
  const [money] = await sql.unsafe<{ income: number; expense: number }[]>(
    `select
      coalesce(sum(amount_jpy) filter (where kind = 'income'), 0)::float8 as income,
      coalesce(sum(amount_jpy) filter (where kind = 'expense'), 0)::float8 as expense
    from ledger_entries
    where voided_at is null and occurred_on > ((${since}) at time zone 'Asia/Tokyo')::date`,
    [],
    { simple: false },
  );
  return {
    incomePeriodJpy: money.income,
    expensePeriodJpy: money.expense,
    periodDays: days,
    tasksCreated: tasks.created,
    tasksCompleted: tasks.completed,
    tasksFailed: tasks.failed,
    tasksActive: tasks.active,
    approvalsPending: approvals.slice(0, 5),
    approvalsPendingCount: approvals.length,
    spendPeriodJpy: spend.period,
    spendMonthJpy: spend.month,
    monthlyLimitJpy: Number(budget.monthly_limit_jpy),
    monthlyTargetJpy: Number(budget.monthly_target_jpy),
    waitingTeams: teams.filter((t) => t.phase === "waiting_human").map((t) => ({ title: t.title, reason: t.waiting_reason ?? "" })),
    stoppedTeams: teams.filter((t) => t.phase === "stopped").map((t) => ({ title: t.title })),
    newCandidates,
    candidatesByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    employeeActivity: activity,
    webSearchCalls: spend.searches,
  };
}

const yen = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("ja-JP")}円`;
const statusLabel = (s: string) => BUSINESS_STATUS_LABEL[s as BusinessStatus] ?? s;

/** 集計した数字を、読みやすい文章（箇条書き）にする。AIを使わない */
export function formatStats(s: CompanyStats): string {
  const lines: string[] = [];
  lines.push(`## 数字のまとめ（直近${s.periodDays}日・システムが自動で集計）`);
  lines.push(`- 新しい業務: ${s.tasksCreated}件 ／ 完了: ${s.tasksCompleted}件 ／ 失敗: ${s.tasksFailed}件 ／ 進行中: ${s.tasksActive}件`);
  lines.push(`- あなたの承認待ち: ${s.approvalsPendingCount}件`);
  for (const a of s.approvalsPending) lines.push(`  - ${a.title}`);
  lines.push(
    `- AIの利用料: この期間 ${yen(s.spendPeriodJpy)} ／ 今月 ${yen(s.spendMonthJpy)}（目標 ${yen(s.monthlyTargetJpy)}・上限 ${yen(s.monthlyLimitJpy)}）`,
  );
  if (s.webSearchCalls > 0) lines.push(`- Web検索: ${s.webSearchCalls}回`);
  lines.push(
    `- あなたが記録したお金: 入ったお金 ${yen(s.incomePeriodJpy)} ／ 出たお金 ${yen(s.expensePeriodJpy)} ／ AIの利用料を引いたもうけ ${yen(s.incomePeriodJpy - s.expensePeriodJpy - s.spendPeriodJpy)}`,
  );
  if (s.waitingTeams.length) {
    lines.push(`- あなたの返事を待っているチーム: ${s.waitingTeams.length}件`);
    for (const t of s.waitingTeams.slice(0, 5)) lines.push(`  - ${t.title}`);
  }
  if (s.stoppedTeams.length) {
    lines.push(`- 止まっているチーム: ${s.stoppedTeams.length}件`);
    for (const t of s.stoppedTeams.slice(0, 5)) lines.push(`  - ${t.title}`);
  }
  if (s.newCandidates.length) {
    lines.push(`- 新しい事業の候補: ${s.newCandidates.length}件`);
    for (const c of s.newCandidates) lines.push(`  - ${c.name}（${statusLabel(c.status)}）`);
  }
  const statusSummary = Object.entries(s.candidatesByStatus)
    .map(([k, v]) => `${statusLabel(k)} ${v}件`)
    .join("・");
  if (statusSummary) lines.push(`- 事業の候補の全体: ${statusSummary}`);
  const active = s.employeeActivity.filter((e) => e.calls > 0 || e.messages > 0);
  if (active.length) {
    lines.push(`- 社員の動き:`);
    for (const e of active) lines.push(`  - ${e.name}: 発言 ${e.messages}回・AI利用 ${e.calls}回（${yen(e.cost_jpy)}）`);
  }
  return lines.join("\n");
}

export const ReportSchema = z.object({
  title: z.string().describe("報告書の題名（30字以内）"),
  summary: z.string().describe("ひとことで言うと、今どんな状況か（100字以内）"),
  body: z.string().describe("報告の本文。見出しと箇条書きで。うまくいったこと／困っていること／次にやること"),
  owner_decisions: z.array(z.string()).describe("経営者に決めてほしいこと・やってほしいこと（0〜3件）"),
});
export type ReportOutput = z.infer<typeof ReportSchema>;

export type ReportResult = { ok: boolean; reportId: string | null; message: string; costJpy: number; aiUsed: boolean };

/**
 * 日報・週報を作って保存する。
 * AIが使えない（予算の上限・緊急停止など）ときも、数字だけの報告書を保存する（AI費用0円）。
 */
export async function generateCompanyReport(sql: Sql, kind: ReportKind, trigger: "manual" | "scheduled"): Promise<ReportResult> {
  const log = createStepLogger("report");
  const days = REPORT_DAYS[kind];
  const label = REPORT_LABEL[kind];
  const [settings, stats] = await Promise.all([getSettings(sql), collectStats(sql, days)]);
  const facts = formatStats(stats);
  const [president] = await sql<{ name: string; personality: string; speaking_style: string }[]>`
    select name, personality, speaking_style from employees where id = 'president'`;

  let ai: ReportOutput | null = null;
  let costJpy = 0;
  let note = "";
  if (settings.emergency_stop) {
    note = "緊急停止中のため、AIは使わず数字だけをまとめました。";
  } else {
    try {
      const r = await callStructured(sql, {
        model: settings.model_standard,
        effort: "low",
        maxTokens: 3000,
        system: `あなたは「${settings.company_name}」の社長「${president?.name ?? "社長"}」（AI社員）です。
経営者に、会社の${label}を書きます。

【会社の基本原則（変更不可）】
${FIXED_COMPANY_PRINCIPLES}

【あなた】
- 性格: ${president?.personality ?? ""}
- 話し方: ${president?.speaking_style ?? ""}

${PLAIN_LANGUAGE_RULES}

【書き方】
- 下の「数字のまとめ」は、システムが集計した事実です。数字を変えたり、書かれていないことを事実のように書いたりしない。
- 経営者が1分で読める長さにする。
- 承認待ちや、返事を待っているチームがあれば、はっきり伝える。
- 費用が目標を超えそうなら、注意をうながす。
- お金の記録（入ったお金・出たお金）があれば、もうけが出ているかをひとことで伝える。記録がなければ、売上はまだ記録されていないと伝える。${
          kind === "monthly" ? "\n- 月報なので、この1か月の振り返りと、来月に力を入れることを書く。" : ""
        }`,
        messages: [{ role: "user", content: `${label}を書いてください。\n\n${facts}` }],
        schema: ReportSchema,
        schemaName: "company_report",
        purpose: `report:${kind}`,
        employeeId: "president",
        mock: () => ({
          title: `【テスト用モック】${label}`,
          summary: "【テスト用モック】会社は予定どおり動いています。",
          body: "## うまくいったこと\n- テスト用の内容です\n\n## 次にやること\n- 承認待ちを確認してもらう",
          owner_decisions: stats.approvalsPendingCount > 0 ? ["承認待ちの内容を確認してください"] : [],
        }),
      });
      costJpy = r.costJpy;
      if (r.ok) ai = r.data;
      else note = `AIの文章を作れなかったため、数字だけをまとめました（${r.message}）`;
    } catch (err) {
      if (err instanceof BudgetBlockedError || err instanceof AiUnavailableError) {
        note = `AIを使えなかったため、数字だけをまとめました（${err.message}）`;
      } else {
        log.fail("report", err);
        note = "予期しないエラーのため、数字だけをまとめました。";
      }
    }
  }

  const title = ai ? `${label}：${ai.title}`.slice(0, 200) : `${label}（数字のまとめ）`;
  const content = ai
    ? [
        ai.summary,
        "",
        ai.body,
        ai.owner_decisions.length ? `\n## あなたに決めてほしいこと\n${ai.owner_decisions.map((d) => `- ${d}`).join("\n")}` : "",
        "",
        facts,
      ].join("\n")
    : `${note}\n\n${facts}`;
  const [row] = await sql<{ id: string }[]>`
    insert into reports (report_type, title, content, employee_id, period_start, period_end)
    values (${kind}, ${title}, ${content}, 'president',
      ((now() - ${`${days} days`}::interval) at time zone 'Asia/Tokyo')::date, (now() at time zone 'Asia/Tokyo')::date)
    returning id`;
  if (trigger === "scheduled") {
    await enqueueNotification(sql, { kind: "report", title: `社長から${label}が届きました`, body: title, url: "/reports", dedupeKey: `report:${row.id}` });
  }
  await audit(sql, trigger === "manual" ? "owner" : "system", "report_generated", "report", row.id, {
    kind,
    trigger,
    aiUsed: Boolean(ai),
    costJpy,
  });
  return {
    ok: true,
    reportId: row.id,
    message: ai ? `${label}を作りました。` : `${label}を作りました（${note}）`,
    costJpy,
    aiUsed: Boolean(ai),
  };
}
