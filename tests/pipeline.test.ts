// 事業を「採用」したら、商品づくり → 出品パッケージ → 出品の承認 → 出品 → 販売中・運営 まで自動で進むテスト
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { insertBusinessProject, getBusinessProject, setBusinessStatus } from "@/lib/repo/business";
import { advanceAllBusinesses, advanceBusiness, markListed, retryStage } from "@/lib/business/pipeline";
import { runOpsReviews } from "@/lib/business/ops";
import { decideApproval, getApproval } from "@/lib/repo/approvals";
import { addLedgerEntry } from "@/lib/repo/ledger";
import { runWorkflows } from "@/lib/workflow/engine";
import { runScheduledJobs } from "@/lib/autonomy/scheduler";
import { buildStepInstruction } from "@/lib/workflow/prompts";
import { splitSections } from "@/app/(app)/tasks/[id]/deliverables/[version]/OutputButtons";
import { OWNER_DOES_AFTER_EFFECT } from "@/lib/constants";

async function reset() {
  const sql = await getDb();
  await sql`update tasks set status = 'completed', completed_at = now() where status not in ('completed','rejected','failed')`;
  await sql`update company_settings set emergency_stop = false, autorun_frequency = 'off', sns_plan_frequency = 'off',
    life_question_frequency = 'off', last_life_analysis_on = '2099-12-31', last_life_review_on = '2099-12-31',
    life_nudge_enabled = false, life_prep_enabled = false, life_research_enabled = false, last_ops_review_on = null`;
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, monthly_target_jpy = 100000,
    daily_limit_jpy = 100000, max_calls_per_day = 2000, max_calls_per_minute = 60, max_calls_per_task = 20`;
  await sql`update business_projects set status = 'rejected' where status = 'adopted'`;
  await sql.begin(async (tx) => {
    await tx`alter table api_usage disable trigger api_usage_guard`;
    await tx`update api_usage set created_at = created_at - interval '2 minutes' where created_at > now() - interval '2 minutes'`;
    await tx`alter table api_usage enable trigger api_usage_guard`;
  });
}

async function newBusiness() {
  const sql = await getDb();
  const b = await insertBusinessProject(sql, {
    name: `テスト商品 ${crypto.randomUUID()}`,
    summary: "副業の始め方の手引き",
    target_customer: "副業を始めたい人",
    customer_problem: "何から始めればいいか分からない",
    competitors: "",
    price_jpy: 500,
    initial_cost_jpy: 0,
    running_cost_jpy: 0,
    monetization: "noteで有料記事",
    difficulty: "やさしい",
    risks: "",
    validation_method: "",
    sources: [],
    discoveredBy: "bizdev",
  });
  return { sql, id: b.id };
}

/** チームを最後まで動かして、成果物を経営者として受け取る */
async function finishStageTask(taskId: string) {
  const sql = await getDb();
  await runWorkflows(sql, { taskIds: [taskId], maxSteps: 25, deadlineMs: 60_000 });
  const [a] = await sql<{ id: string; content_hash: string }[]>`
    select id, content_hash from approvals where task_id = ${taskId} and action_type = 'accept_deliverable' and status = 'pending'`;
  expect(a).toBeTruthy();
  await decideApproval(sql, a.id, "approve", "", a.content_hash);
}

beforeAll(async () => {
  await closeDb();
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await closeDb();
});

describe("販売までの自動の流れ", () => {
  it("採用 → 商品づくり → 出品の準備 → 出品の承認 → 出品 → 販売中", async () => {
    const { sql, id } = await newBusiness();
    // 採用していなければ進まない
    expect(await advanceBusiness(sql, id)).toHaveLength(0);
    await setBusinessStatus(sql, id, "adopted", "");
    const [productTask] = await advanceBusiness(sql, id);
    let b = (await getBusinessProject(sql, id))!;
    expect(b.stage).toBe("product");
    expect(b.stage_task_id).toBe(productTask);
    const [pt] = await sql<{ title: string; assignee_id: string; business_project_id: string }[]>`select title, assignee_id, business_project_id from tasks where id = ${productTask}`;
    expect(pt).toMatchObject({ assignee_id: "creative", business_project_id: id });
    expect(pt.title).toMatch(/^商品づくり：/);
    // 商品の成果物を受け取ると、出品の準備が始まる（前の成果物が説明に入る）
    await finishStageTask(productTask);
    const [listingTask] = await advanceBusiness(sql, id);
    b = (await getBusinessProject(sql, id))!;
    expect(b.stage).toBe("listing");
    const [lt] = await sql<{ title: string; description: string }[]>`select title, description from tasks where id = ${listingTask}`;
    expect(lt.title).toMatch(/^出品の準備：/);
    expect(lt.description).toContain("listing_package");
    expect(lt.description).toContain("できあがった商品");
    // 出品パッケージを受け取ると、出品の承認が届く（アプリは外部で実行しない）
    await finishStageTask(listingTask);
    expect(await advanceBusiness(sql, id)).toHaveLength(0);
    b = (await getBusinessProject(sql, id))!;
    expect(b.stage).toBe("launch");
    const ap = (await getApproval(sql, b.launch_approval_id!))!;
    expect(ap.action_type).toBe("publish_web");
    expect(ap.after_effect).toBe(OWNER_DOES_AFTER_EFFECT);
    expect(ap.payload.businessId).toBe(id);
    // 承認する前は「出品しました」を記録できない
    await expect(markListed(sql, id, "note", "https://note.com/x/n/abc")).rejects.toThrow(/出品の承認/);
    await decideApproval(sql, ap.id, "approve", "", ap.content_hash);
    await expect(markListed(sql, id, "note", "javascript:alert(1)")).rejects.toThrow(/URL/);
    await markListed(sql, id, "note", "https://note.com/x/n/abc");
    b = (await getBusinessProject(sql, id))!;
    expect(b).toMatchObject({ stage: "selling", platform: "note", listing_url: "https://note.com/x/n/abc" });
    expect(b.launched_at).not.toBeNull();
  });

  it("自動で進める設定を止めると進まない。定期実行の安全網でも進む", async () => {
    const { sql, id } = await newBusiness();
    await setBusinessStatus(sql, id, "adopted", "");
    await sql`update business_projects set auto_advance = false where id = ${id}`;
    expect(await advanceBusiness(sql, id)).toHaveLength(0);
    await sql`update business_projects set auto_advance = true where id = ${id}`;
    const started = await advanceAllBusinesses(sql);
    expect(started).toHaveLength(1);
    expect((await getBusinessProject(sql, id))!.stage).toBe("product");
  });

  it("業務が失敗で止まったら自動では進めず、「やり直す」で新しい業務を始める", async () => {
    const { sql, id } = await newBusiness();
    await setBusinessStatus(sql, id, "adopted", "");
    const [t1] = await advanceBusiness(sql, id);
    await sql`update tasks set status = 'failed' where id = ${t1}`;
    expect(await advanceBusiness(sql, id)).toHaveLength(0);
    const [t2] = await retryStage(sql, id);
    expect(t2).toBeTruthy();
    expect((await getBusinessProject(sql, id))!.stage_task_id).toBe(t2);
  });
});

describe("販売中の運営", () => {
  async function sellingBusiness() {
    const { sql, id } = await newBusiness();
    await sql`update business_projects set status = 'adopted', stage = 'selling', platform = 'note', launched_at = now() - interval '10 days' where id = ${id}`;
    return { sql, id };
  }

  it("売上の記録がなければ、運営レポートと改善の業務を作る（2週間に1回まで）", async () => {
    const { sql, id } = await sellingBusiness();
    const r = await runOpsReviews(sql, "manual");
    expect(r.reports).toBe(1);
    expect(r.tasks).toHaveLength(1);
    const [t] = await sql<{ title: string; business_project_id: string }[]>`select title, business_project_id from tasks where id = ${r.tasks[0]}`;
    expect(t.title).toMatch(/^運営の改善：/);
    expect(t.business_project_id).toBe(id);
    const [rep] = await sql<{ title: string; content: string }[]>`select title, content from reports where report_type = 'bizdev' order by created_at desc limit 1`;
    expect(rep.title).toMatch(/^運営レポート：/);
    expect(rep.content).toContain("直近7日の売上");
    await sql`update tasks set status = 'completed' where id = ${r.tasks[0]}`;
    const r2 = await runOpsReviews(sql, "manual");
    expect(r2.tasks).toHaveLength(0);
  });

  it("売上の記録があれば、数字をそのまま使う（改善の業務はモックでは作らない）", async () => {
    const { sql, id } = await sellingBusiness();
    await addLedgerEntry(sql, { kind: "income", amountJpy: 1500, occurredOn: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()), category: "売上", description: "", businessProjectId: id });
    const r = await runOpsReviews(sql, "manual");
    expect(r.tasks).toHaveLength(0);
    const [rep] = await sql<{ content: string }[]>`select content from reports where report_type = 'bizdev' order by created_at desc limit 1`;
    expect(rep.content).toContain("直近7日の売上：1,500");
  });

  it("金曜の定期実行で運営レポートを作る（同じ日に2回は作らない）", async () => {
    const { sql } = await sellingBusiness();
    const friday = new Date("2030-06-14T03:00:00Z");
    const r1 = await runScheduledJobs(sql, friday);
    expect(r1.ran).toContain("ops_review");
    const r2 = await runScheduledJobs(sql, friday);
    expect(r2.ran).not.toContain("ops_review");
  });
});

describe("出品パッケージと、成果物の作り方", () => {
  it("見出しごとに分けてコピーできる", () => {
    const md = "# x\n## 出品先\nnote（理由）\n\n## 商品名\n副業の始め方\n## 価格\n500円";
    expect(splitSections(md)).toEqual([
      { heading: "出品先", body: "note（理由）" },
      { heading: "商品名", body: "副業の始め方" },
      { heading: "価格", body: "500円" },
    ]);
  });

  it("チームは結論だけで終わらせず、すぐ使える形まで作る", () => {
    const ctx = { workflow: { plan: { output_format: "markdown_report" } }, roster: [] } as never;
    expect(buildStepInstruction("drafting", ctx)).toContain("結論や提案だけで終わらせない");
    expect(buildStepInstruction("final_report", ctx)).toContain("next_steps");
  });
});
