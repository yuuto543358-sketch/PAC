// Phase 4：収益・費用の記録／プッシュ通知／月報 のテスト
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { OWNER_DOES_AFTER_EFFECT } from "@/lib/constants";
import { createApproval, getApproval, resubmitApproval } from "@/lib/repo/approvals";
import { addLedgerEntry, businessMoney, ledgerTotals, monthlyMoney, voidLedgerEntry } from "@/lib/repo/ledger";
import { insertBusinessProject } from "@/lib/repo/business";
import { dispatchNotifications, enqueueNotification, savePushSubscription } from "@/lib/notify";
import { finalizeApiCall, reserveApiCall } from "@/lib/budget";
import { generateCompanyReport } from "@/lib/autonomy/reports";
import { runScheduledJobs } from "@/lib/autonomy/scheduler";
import { createTask } from "@/lib/repo/tasks";
import { initWorkflow } from "@/lib/workflow/repo";
import { runWorkflows } from "@/lib/workflow/engine";

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
const uniq = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;

beforeAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  const sql = await getDb();
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, monthly_target_jpy = 100000,
    daily_limit_jpy = 100000, max_calls_per_day = 2000, max_calls_per_minute = 60, max_calls_per_task = 20, per_task_limit_jpy = 30`;
  await sql`update company_settings set emergency_stop = false, notify_approvals = true, notify_budget = true,
    autorun_frequency = 'off', last_discovery_on = null, last_daily_report_on = null, last_weekly_report_on = null,
    last_monthly_report_on = null, discovery_auto_start = false`;
  // 前のテストの通知・受け取り先を片づける（テスト用DBだけで行う操作）
  await sql`update notifications set status = 'skipped' where status = 'pending'`;
  await sql`delete from push_subscriptions`;
  await sql.begin(async (tx) => {
    await tx`alter table api_usage disable trigger api_usage_guard`;
    await tx`update api_usage set created_at = created_at - interval '2 minutes' where created_at > now() - interval '2 minutes'`;
    await tx`alter table api_usage enable trigger api_usage_guard`;
  });
});
afterAll(async () => {
  const sql = await getDb();
  await sql`update company_settings set autorun_frequency = 'off', last_monthly_report_on = null`;
  await sql`delete from push_subscriptions`;
  await closeDb();
});

async function newBusiness() {
  const sql = await getDb();
  return insertBusinessProject(sql, {
    name: `テスト事業 ${uniq()}`,
    summary: "テスト",
    target_customer: "",
    customer_problem: "",
    competitors: "",
    price_jpy: 1000,
    initial_cost_jpy: 0,
    running_cost_jpy: 0,
    monetization: "",
    difficulty: "やさしい",
    risks: "",
    validation_method: "",
    sources: [],
    discoveredBy: "bizdev",
  });
}

describe("収益・費用の記録", () => {
  it("記録すると合計に入り、取り消すと合計から外れる", async () => {
    const sql = await getDb();
    const before = await ledgerTotals(sql);
    const id = await addLedgerEntry(sql, { kind: "income", amountJpy: 3000, occurredOn: today, category: "売上", description: "テスト" });
    await addLedgerEntry(sql, { kind: "expense", amountJpy: 500, occurredOn: today, category: "広告", description: "" });
    const after = await ledgerTotals(sql);
    expect(after.month.income - before.month.income).toBe(3000);
    expect(after.month.expense - before.month.expense).toBe(500);
    await voidLedgerEntry(sql, id, "打ち間違い");
    const voided = await ledgerTotals(sql);
    expect(voided.month.income - before.month.income).toBe(0);
    await expect(voidLedgerEntry(sql, id, "もう一度")).rejects.toThrow(/すでに取り消されています/);
  });

  it("おかしな値は拒否し、記録は変更・削除できない", async () => {
    const sql = await getDb();
    await expect(addLedgerEntry(sql, { kind: "income", amountJpy: 0, occurredOn: today, category: "売上", description: "" })).rejects.toThrow();
    await expect(addLedgerEntry(sql, { kind: "income", amountJpy: -5, occurredOn: today, category: "売上", description: "" })).rejects.toThrow();
    await expect(addLedgerEntry(sql, { kind: "gift", amountJpy: 100, occurredOn: today, category: "", description: "" })).rejects.toThrow();
    await expect(addLedgerEntry(sql, { kind: "income", amountJpy: 100, occurredOn: "2026/1/1", category: "", description: "" })).rejects.toThrow();
    const id = await addLedgerEntry(sql, { kind: "income", amountJpy: 100, occurredOn: today, category: "売上", description: "" });
    await expect(sql`update ledger_entries set amount_jpy = 999 where id = ${id}`).rejects.toThrow(/変更できません/);
    await expect(sql`delete from ledger_entries where id = ${id}`).rejects.toThrow(/削除できません/);
    await expect(sql`update ledger_entries set voided_at = now() where id = ${id}`).rejects.toThrow(/理由が必要/);
    await expect(voidLedgerEntry(sql, id, "  ")).rejects.toThrow(/理由/);
  });

  it("事業ごとのもうけは、収益 − 費用 − その事業の業務で使ったAI利用料", async () => {
    const sql = await getDb();
    const b = await newBusiness();
    await addLedgerEntry(sql, { kind: "income", amountJpy: 5000, occurredOn: today, category: "売上", description: "", businessProjectId: b.id });
    await addLedgerEntry(sql, { kind: "expense", amountJpy: 1200, occurredOn: today, category: "材料・仕入れ", description: "", businessProjectId: b.id });
    const t = await createTask(sql, { title: `商品づくり ${uniq()}`, source: "user", businessProjectId: b.id, createdBy: { type: "user" } });
    if (!t.created) throw new Error("not created");
    await initWorkflow(sql, t.task.id, true);
    await runWorkflows(sql, { taskIds: [t.task.id], maxSteps: 3, deadlineMs: 30_000 });
    const m = await businessMoney(sql, b.id);
    expect(m.income).toBe(5000);
    expect(m.expense).toBe(1200);
    expect(m.api).toBeGreaterThan(0);
    expect(m.profit).toBeCloseTo(5000 - 1200 - m.api, 6);
  });

  it("月ごとの一覧は、記録がない月も0円で並ぶ", async () => {
    const sql = await getDb();
    const rows = await monthlyMoney(sql, 6);
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)!.month).toBe(today.slice(0, 7));
  });
});

describe("外部への操作の説明", () => {
  it("メール以外も「アプリは実行しない」という固定の説明になる", async () => {
    const sql = await getDb();
    const id = await createApproval(sql, {
      requestedByEmployeeId: "creative",
      actionType: "sns_post",
      title: `SNS投稿 ${uniq()}`,
      content: "投稿文",
      reason: "",
      destination: "X",
      estimatedCostJpy: 0,
      risks: "",
      afterEffect: "承認するとすぐに投稿されます",
    });
    expect((await getApproval(sql, id))!.after_effect).toBe(OWNER_DOES_AFTER_EFFECT);
  });
});

describe("プッシュ通知", () => {
  async function addSub(endpoint = `https://push.example.com/${uniq()}`) {
    const sql = await getDb();
    await savePushSubscription(sql, { endpoint, p256dh: "B".repeat(87), auth: "a".repeat(22), label: "iPhone" });
    return endpoint;
  }

  it("社員からの承認のお願いは通知に入り、経営者の再提出は通知しない", async () => {
    const sql = await getDb();
    const id = await createApproval(sql, {
      requestedByEmployeeId: "president",
      actionType: "send_message",
      title: `通知テスト ${uniq()}`,
      content: "本文",
      reason: "",
      destination: "",
      estimatedCostJpy: 0,
      risks: "",
      afterEffect: "",
    });
    const [n] = await sql<{ kind: string; url: string; status: string }[]>`
      select kind, url, status from notifications where dedupe_key = ${`approval:${id}`}`;
    expect(n).toMatchObject({ kind: "approval", url: `/approvals/${id}`, status: "pending" });
    const a = (await getApproval(sql, id))!;
    const newId = await resubmitApproval(
      sql,
      id,
      { title: a.title, content: "直した", destination: "", estimatedCostJpy: 0, reason: "", risks: "", afterEffect: "" },
      a.content_hash,
    );
    const rows = await sql`select 1 from notifications where dedupe_key = ${`approval:${newId}`}`;
    expect(rows).toHaveLength(0);
  });

  it("通知をオフにすると入らない。同じ通知は二重に入らない", async () => {
    const sql = await getDb();
    const key = `test:${uniq()}`;
    await sql`update company_settings set notify_budget = false`;
    await enqueueNotification(sql, { kind: "budget", title: "x", dedupeKey: key });
    expect(await sql`select 1 from notifications where dedupe_key = ${key}`).toHaveLength(0);
    await sql`update company_settings set notify_budget = true`;
    await enqueueNotification(sql, { kind: "budget", title: "x", dedupeKey: key });
    await enqueueNotification(sql, { kind: "budget", title: "x", dedupeKey: key });
    expect(await sql`select 1 from notifications where dedupe_key = ${key}`).toHaveLength(1);
  });

  it("受け取る端末がなければ送らない（skipped）", async () => {
    const sql = await getDb();
    const key = `test:${uniq()}`;
    await enqueueNotification(sql, { kind: "report", title: "x", dedupeKey: key });
    const sent: string[] = [];
    const r = await dispatchNotifications(sql, async (_s, p) => {
      sent.push(p);
      return { statusCode: 201 };
    });
    expect(sent).toHaveLength(0);
    expect(r.skipped).toBeGreaterThan(0);
    const [n] = await sql<{ status: string }[]>`select status from notifications where dedupe_key = ${key}`;
    expect(n.status).toBe("skipped");
  });

  it("全端末に送り、使えなくなった端末（410）は受け取り先から外す。同時に動いても二重に送らない", async () => {
    const sql = await getDb();
    const good = await addSub();
    const gone = await addSub();
    const key = `test:${uniq()}`;
    await enqueueNotification(sql, { kind: "approval", title: "承認のお願い", body: "内容", url: "/approvals", dedupeKey: key });
    const calls: { endpoint: string; payload: string }[] = [];
    const sender = async (s: { endpoint: string }, payload: string) => {
      calls.push({ endpoint: s.endpoint, payload });
      if (s.endpoint === gone) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201 };
    };
    const [r1, r2] = await Promise.all([dispatchNotifications(sql, sender), dispatchNotifications(sql, sender)]);
    expect(r1.sent + r2.sent).toBe(1);
    expect(calls.filter((c) => c.endpoint === good)).toHaveLength(1);
    expect(JSON.parse(calls[0].payload)).toMatchObject({ title: "承認のお願い", url: "/approvals" });
    const subs = await sql<{ endpoint: string }[]>`select endpoint from push_subscriptions`;
    expect(subs.map((s) => s.endpoint)).toEqual([good]);
  });

  it("通知を開く場所はアプリの中だけ", async () => {
    const sql = await getDb();
    const key = `test:${uniq()}`;
    await enqueueNotification(sql, { kind: "report", title: "x", url: "https://evil.example.com", dedupeKey: key });
    const [n] = await sql<{ url: string }[]>`select url from notifications where dedupe_key = ${key}`;
    expect(n.url).toBe("/");
  });

  it("受け取り先の登録は https だけ", async () => {
    const sql = await getDb();
    await expect(savePushSubscription(sql, { endpoint: "http://x.example.com/a", p256dh: "B".repeat(87), auth: "a".repeat(22), label: "" })).rejects.toThrow();
  });

  it("AIの利用料が今月の目標を超えたら、月に1回だけ通知する", async () => {
    const sql = await getDb();
    await sql`update budgets set monthly_target_jpy = 1`;
    const month = today.slice(0, 7);
    await sql`delete from notifications where dedupe_key = ${`budget:target:${month}`} or dedupe_key = ${`budget:hard:${month}`}`;
    for (let i = 0; i < 2; i++) {
      const r = await reserveApiCall(sql, { model: "gpt-5-mini", purpose: "test:budget", estInputTokens: 100, maxOutputTokens: 100 });
      await finalizeApiCall(sql, r, { input_tokens: 100, output_tokens: 100 });
    }
    const rows = await sql`select 1 from notifications where dedupe_key = ${`budget:target:${month}`}`;
    expect(rows).toHaveLength(1);
  });

  it("チームから質問が来たら通知する", async () => {
    const sql = await getDb();
    const t = await createTask(sql, { title: `質問テスト ${uniq()}`, description: "[mock:question]", source: "user", createdBy: { type: "user" } });
    if (!t.created) throw new Error("not created");
    await initWorkflow(sql, t.task.id, true);
    await runWorkflows(sql, { taskIds: [t.task.id], maxSteps: 3, deadlineMs: 30_000 });
    const rows = await sql`select 1 from notifications where kind = 'question' and url = ${`/tasks/${t.task.id}/room`}`;
    expect(rows).toHaveLength(1);
  });
});

describe("月報", () => {
  it("月報を作る（記録したお金も入る）", async () => {
    const sql = await getDb();
    const r = await generateCompanyReport(sql, "monthly", "manual");
    const [row] = await sql<{ report_type: string; title: string; content: string }[]>`
      select report_type, title, content from reports where id = ${r.reportId}`;
    expect(row.report_type).toBe("monthly");
    expect(row.title).toMatch(/^月報/);
    expect(row.content).toContain("直近30日");
    expect(row.content).toContain("あなたが記録したお金");
  });

  it("毎月1日に月報を作る（同じ日に2回は作らない）。自動の報告は通知する", async () => {
    const sql = await getDb();
    await sql`update company_settings set autorun_frequency = 'weekly'`;
    const firstOfMonth = new Date("2030-02-01T00:00:00Z"); // 金曜日
    const r1 = await runScheduledJobs(sql, firstOfMonth);
    expect(r1.ran).toEqual(["monthly_report"]);
    const r2 = await runScheduledJobs(sql, firstOfMonth);
    expect(r2.ran).toEqual([]);
    const reportId = r1.reports[0].reportId;
    expect(await sql`select 1 from notifications where dedupe_key = ${`report:${reportId}`}`).toHaveLength(1);
  });
});
