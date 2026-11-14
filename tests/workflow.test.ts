// Phase 2：チームでの自動進行のテスト（AI_MOCK=1 のテスト用応答で動かす）
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { createTask } from "@/lib/repo/tasks";
import { decideApproval, getApproval } from "@/lib/repo/approvals";
import { mockHooks } from "@/lib/ai/client";
import { acquireLease, getWorkflow, initWorkflow, listDeliverables, listMembers, listRoomMessages, releaseLease } from "@/lib/workflow/repo";
import { runWorkflowStep, runWorkflows } from "@/lib/workflow/engine";
import { postInstruction, resumeTeam } from "@/lib/workflow/human";

async function newTeamTask(title: string, description = "") {
  const sql = await getDb();
  const r = await createTask(sql, {
    // 「似た業務の重複防止」に掛からないよう、毎回まったく違う文字列を付ける
    title: `${title}（テスト${crypto.randomUUID()}${crypto.randomUUID()}）`,
    description,
    source: "user",
    createdBy: { type: "user" },
  });
  if (!r.created) throw new Error("not created");
  await initWorkflow(sql, r.task.id, true);
  return { sql, taskId: r.task.id };
}

async function runAll(taskId: string, maxSteps = 25) {
  const sql = await getDb();
  return runWorkflows(sql, { taskIds: [taskId], maxSteps, deadlineMs: 60_000 });
}

async function pendingApprovals(taskId: string) {
  const sql = await getDb();
  return sql<{ id: string; action_type: string; status: string; content_hash: string }[]>`
    select id, action_type, status, content_hash from approvals where task_id = ${taskId} order by created_at`;
}

beforeAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  const sql = await getDb();
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, daily_limit_jpy = 100000,
    max_calls_per_day = 2000, max_calls_per_minute = 60, max_calls_per_task = 20, per_task_limit_jpy = 30`;
  await sql`update company_settings set emergency_stop = false`;
  mockHooks.failNext = 0;
  // テストは短時間に多数のAI呼び出しを行うため、「1分あたりの回数制限」に掛からないよう、
  // それまでの利用記録を2分前のものとして扱う（テスト用DBでのみ行う操作）
  await sql.begin(async (tx) => {
    await tx`alter table api_usage disable trigger api_usage_guard`;
    await tx`update api_usage set created_at = created_at - interval '2 minutes' where created_at > now() - interval '2 minutes'`;
    await tx`alter table api_usage enable trigger api_usage_guard`;
  });
});
afterAll(async () => {
  await closeDb();
});

describe("チームでの自動進行", () => {
  it("社長がチームを編成 → 議論 → 成果物 → 監査 → 社長の報告 → 経営者の承認待ち まで自動で進む", async () => {
    const { sql, taskId } = await newTeamTask("競合サービスの市場調査");
    const run = await runAll(taskId);
    const wf = (await getWorkflow(sql, taskId))!;
    expect(wf.phase).toBe("waiting_human");
    expect(wf.waiting_reason).toBe("acceptance");

    const members = await listMembers(sql, taskId);
    const roles = Object.fromEntries(members.map((m) => [m.employee_id, m.role]));
    expect(roles.president).toBe("ceo");
    expect(roles.research).toBe("lead");
    expect(roles.bizdev).toBe("member");
    expect(roles.finance).toBe("reviewer");

    const msgs = await listRoomMessages(sql, taskId);
    const kinds = msgs.filter((m) => m.author_type === "employee").map((m) => `${m.employee_id}:${m.kind}`);
    expect(kinds).toEqual([
      "president:plan",
      "research:findings", // 調査担当は Web検索して「調べた結果」を発言する
      "bizdev:opinion",
      "research:deliverable",
      "finance:review",
      "president:report",
    ]);

    const dels = await listDeliverables(sql, taskId);
    expect(dels).toHaveLength(1);
    expect(dels[0].status).toBe("passed");
    expect(dels[0].author_employee_id).toBe("research");

    const [task] = await sql`select status, assignee_id, ai_call_count from tasks where id = ${taskId}`;
    expect(task.status).toBe("awaiting_approval");
    expect(task.assignee_id).toBe("research");
    expect(task.ai_call_count).toBe(6);
    expect(run.steps).toBeGreaterThanOrEqual(6);

    const [report] = await sql`select report_type, content from reports where task_id = ${taskId}`;
    expect(report.report_type).toBe("task");
    const lessons = await sql`select employee_id from knowledge where source_task_id = ${taskId}`;
    expect(lessons.length).toBeGreaterThanOrEqual(2);

    // 経営者が承認 → 完了
    const approvals = await pendingApprovals(taskId);
    expect(approvals.map((a) => a.action_type)).toEqual(["accept_deliverable"]);
    await decideApproval(sql, approvals[0].id, "approve", "", approvals[0].content_hash);
    const [done] = await sql`select status, completed_at from tasks where id = ${taskId}`;
    expect(done.status).toBe("completed");
    expect(done.completed_at).not.toBeNull();
    expect((await getWorkflow(sql, taskId))!.phase).toBe("done");
    expect((await listDeliverables(sql, taskId))[0].status).toBe("accepted");
  });

  it("監査で差し戻されると、リーダーが修正版を作って再監査する", async () => {
    const { sql, taskId } = await newTeamTask("新商品の企画書を作成", "[mock:revise]");
    await runAll(taskId);
    const wf = (await getWorkflow(sql, taskId))!;
    expect(wf.phase).toBe("waiting_human");
    expect(wf.rework_count).toBe(1);
    const dels = await listDeliverables(sql, taskId);
    expect(dels.map((d) => `${d.version}:${d.status}`)).toEqual(["2:passed", "1:revise"]);
    const reviews = (await listRoomMessages(sql, taskId)).filter((m) => m.kind === "review");
    expect(reviews.map((r) => r.meta.verdict)).toEqual(["revise", "approve"]);
  });

  it("経営者が差し戻すと、コメントが修正指示になり、修正版で承認依頼が出し直される", async () => {
    const { sql, taskId } = await newTeamTask("副業アイデアの整理");
    await runAll(taskId);
    const [first] = await pendingApprovals(taskId);
    await decideApproval(sql, first.id, "reject", "対象を30代会社員に絞ってください", first.content_hash);
    let wf = (await getWorkflow(sql, taskId))!;
    expect(wf.phase).toBe("rework");
    const owner = (await listRoomMessages(sql, taskId)).filter((m) => m.author_type === "owner");
    expect(owner.at(-1)?.content).toContain("30代会社員");

    await runAll(taskId);
    wf = (await getWorkflow(sql, taskId))!;
    expect(wf.phase).toBe("waiting_human");
    expect((await listDeliverables(sql, taskId)).map((d) => d.status)).toEqual(["passed", "rejected"]);
    const approvals = await pendingApprovals(taskId);
    expect(approvals.map((a) => a.status)).toEqual(["rejected", "pending"]);
  });

  it("経営者への質問で一時停止し、指示を受けると再開する", async () => {
    const { sql, taskId } = await newTeamTask("顧客向けサービスの検討", "[mock:question]");
    await runAll(taskId);
    let wf = (await getWorkflow(sql, taskId))!;
    expect(wf.phase).toBe("waiting_human");
    expect(wf.waiting_reason).toBe("question");
    expect((await listRoomMessages(sql, taskId)).some((m) => m.kind === "question_to_owner")).toBe(true);

    const r = await postInstruction(sql, taskId, { type: "owner" }, "個人向けでお願いします");
    expect(r.resumed).toBe(true);
    await runAll(taskId);
    wf = (await getWorkflow(sql, taskId))!;
    expect(wf.waiting_reason).toBe("acceptance");
  });

  it("同じ担当が2回続けて失敗すると、社長がリーダーを交代する", async () => {
    const { sql, taskId } = await newTeamTask("競合価格の調査");
    for (let i = 0; i < 6; i++) {
      const wf = (await getWorkflow(sql, taskId))!;
      if (wf.phase === "drafting") break;
      await runWorkflowStep(sql, taskId, "t");
    }
    expect((await getWorkflow(sql, taskId))!.phase).toBe("drafting");
    mockHooks.failNext = 2;
    await runWorkflowStep(sql, taskId, "t");
    await runWorkflowStep(sql, taskId, "t");
    const wf = (await getWorkflow(sql, taskId))!;
    expect(wf.lead_id).toBe("bizdev");
    expect(wf.failures).toBe(0);
    const decision = (await listRoomMessages(sql, taskId)).filter((m) => m.kind === "decision");
    expect(decision.at(-1)?.content).toContain("交代");
    await runAll(taskId);
    expect((await listDeliverables(sql, taskId))[0].author_employee_id).toBe("bizdev");
  });

  it("失敗が続くとチームを停止して業務を「失敗」にし、再開すると続きから進む", async () => {
    const { sql, taskId } = await newTeamTask("週次の振り返り");
    mockHooks.failNext = 4;
    await runAll(taskId);
    let wf = (await getWorkflow(sql, taskId))!;
    expect(wf.phase).toBe("stopped");
    const [t] = await sql`select status from tasks where id = ${taskId}`;
    expect(t.status).toBe("failed");

    await resumeTeam(sql, taskId);
    await runAll(taskId);
    wf = (await getWorkflow(sql, taskId))!;
    expect(wf.waiting_reason).toBe("acceptance");
  });

  it("同じ業務を同時に2か所で進めない（ロック）", async () => {
    const { sql, taskId } = await newTeamTask("同時実行テスト");
    const held = await acquireLease(sql, taskId, "other");
    expect(held).not.toBeNull();
    const r = await runWorkflowStep(sql, taskId, "me");
    expect(r.status).toBe("busy");
    await releaseLease(sql, taskId, "other");
    const r2 = await runWorkflowStep(sql, taskId, "me");
    expect(r2.status).toBe("stepped");
  });

  it("業務の予算を超えそうなときは止まって経営者に知らせ、会社全体の停止時は待機する", async () => {
    const { sql, taskId } = await newTeamTask("予算テスト");
    await sql`update tasks set budget_limit_jpy = 0.0001 where id = ${taskId}`;
    const r = await runWorkflowStep(sql, taskId, "t");
    expect(r).toMatchObject({ status: "blocked", scope: "task" });
    const wf = (await getWorkflow(sql, taskId))!;
    expect(wf.waiting_reason).toBe("budget");

    const t2 = await newTeamTask("緊急停止テスト");
    await sql`update company_settings set emergency_stop = true`;
    const s1 = await runWorkflows(sql, { taskIds: [t2.taskId], maxSteps: 5, deadlineMs: 10_000 });
    const s2 = await runWorkflows(sql, { taskIds: [t2.taskId], maxSteps: 5, deadlineMs: 10_000 });
    expect(s1.stoppedReason).toBe("emergency_stop");
    expect(s2.stoppedReason).toBe("emergency_stop");
    const notices = (await listRoomMessages(sql, t2.taskId)).filter((m) => m.author_type === "system" && m.content.includes("待機"));
    expect(notices).toHaveLength(1);
    expect((await getWorkflow(sql, t2.taskId))!.phase).toBe("kickoff");
  });

  it("外部への操作が必要な成果物は、成果物の確認とは別に承認依頼が出る（実行はされない）", async () => {
    const { taskId } = await newTeamTask("提案書の作成", "完成したら取引先にメールで送信する");
    await runAll(taskId);
    const approvals = await pendingApprovals(taskId);
    expect(approvals.map((a) => a.action_type).sort()).toEqual(["accept_deliverable", "send_message"]);
    expect(approvals.every((a) => a.status === "pending")).toBe(true);
  });

  it("完了後に経営者が追加の指示を出すと、業務を再開して修正版を作る", async () => {
    const { sql, taskId } = await newTeamTask("資料の作成");
    await runAll(taskId);
    const [a] = await pendingApprovals(taskId);
    await decideApproval(sql, a.id, "approve", "", a.content_hash);
    await postInstruction(sql, taskId, { type: "owner" }, "図表を1つ追加してください");
    const [t] = await sql`select status, completed_at from tasks where id = ${taskId}`;
    expect(t.status).toBe("producing");
    expect(t.completed_at).toBeNull();
    await runAll(taskId);
    expect((await listDeliverables(sql, taskId)).length).toBe(2);
    expect((await getApproval(sql, (await pendingApprovals(taskId)).at(-1)!.id))!.status).toBe("pending");
  });

  it("記録（グループチャット・成果物の本文）は変更・削除できない", async () => {
    const { sql, taskId } = await newTeamTask("記録保護テスト");
    await runAll(taskId);
    await expect(sql`update task_messages set content = 'x' where task_id = ${taskId}`).rejects.toThrow();
    await expect(sql`delete from task_messages where task_id = ${taskId}`).rejects.toThrow();
    await expect(sql`update deliverables set content = 'x' where task_id = ${taskId}`).rejects.toThrow(/変更できません/);
    await expect(sql`delete from deliverables where task_id = ${taskId}`).rejects.toThrow();
  });
});
