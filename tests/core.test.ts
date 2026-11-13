import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { closeDb, getDb } from "@/lib/db";
import { BudgetBlockedError, failApiCall, finalizeApiCall, reserveApiCall } from "@/lib/budget";
import { createTask, changeTaskStatus, getTaskLogs } from "@/lib/repo/tasks";
import {
  computeContentHash,
  createApproval,
  decideApproval,
  executeApprovedAction,
  getApproval,
  resubmitApproval,
} from "@/lib/repo/approvals";
import { sendChatMessage } from "@/lib/ai/chat";
import { similarity } from "@/lib/dedupe";
import { estimateCostJpy, actualCostUsd } from "@/lib/pricing";
import { signSession, verifySession } from "@/lib/auth/session";

const url = process.env.DATABASE_URL!;

async function resetDatabase() {
  // テスト用DBを空にする（本番では絶対に実行しない）
  const admin = postgres(url.replace(/\/[^/]+$/, "/postgres"), { onnotice: () => {} });
  const dbName = url.split("/").pop()!;
  await admin.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${dbName}' and pid <> pg_backend_pid()`);
  await admin.unsafe(`drop database if exists ${dbName}`);
  await admin.unsafe(`create database ${dbName}`);
  await admin.end();
}

beforeAll(async () => {
  await closeDb();
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

describe("migrations & seed", () => {
  it("creates tables and seeds 6 employees idempotently", async () => {
    const sql = await getDb();
    const emps = await sql`select id from employees order by sort_order`;
    expect(emps.map((e) => e.id)).toEqual(["president", "bizdev", "research", "creative", "secretary", "finance"]);
    // 2回目の起動でも壊れない
    await closeDb();
    const sql2 = await getDb();
    const [{ n }] = await sql2`select count(*)::int as n from employees`;
    expect(n).toBe(6);
  });

  it("forbids deleting or editing logs", async () => {
    const sql = await getDb();
    const r = await createTask(sql, { title: "ログ保護テスト", source: "user", createdBy: { type: "user" } });
    expect(r.created).toBe(true);
    await expect(sql`delete from task_logs`).rejects.toThrow(/変更・削除できません/);
    await expect(sql`update task_logs set message = 'x'`).rejects.toThrow(/変更・削除できません/);
    await expect(sql`truncate task_logs cascade`).rejects.toThrow();
    await expect(sql`delete from audit_logs`).resolves.toBeDefined(); // 空なら対象0行で成功
  });
});

describe("budget guard", () => {
  beforeEach(async () => {
    const sql = await getDb();
    await sql`update budgets set monthly_limit_jpy = 2000, emergency_stop_jpy = 1800, daily_limit_jpy = 50,
      max_calls_per_day = 100, max_calls_per_minute = 60, per_task_limit_jpy = 30, max_calls_per_task = 8`;
    await sql`update company_settings set emergency_stop = false, advanced_model_allowed = false, usd_jpy_rate = 160`;
  });

  it("estimates worst-case cost and records actual cost", async () => {
    const est = estimateCostJpy("claude-haiku-5-5", 3000, 2500, 160)!;
    expect(est).toBeGreaterThan(0);
    expect(est).toBeLessThan(1); // 1円未満
    expect(actualCostUsd("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(0.1);

    const sql = await getDb();
    const res = await reserveApiCall(sql, {
      model: "claude-haiku-5-5",
      purpose: "test",
      estInputTokens: 3000,
      maxOutputTokens: 2500,
    });
    const fin = await finalizeApiCall(sql, res, { input_tokens: 2000, output_tokens: 300 }, "req_1");
    expect(fin.known).toBe(true);
    const [row] = await sql`select status, cost_jpy from api_usage where id = ${res.usageId}`;
    expect(row.status).toBe("completed");
    expect(row.cost_jpy).toBeCloseTo(((2000 * 0.1 + 300 * 0.5) / 1e6) * 160, 6);
    // 確定済みの記録は変更できない
    await expect(sql`update api_usage set cost_jpy = 0 where id = ${res.usageId}`).rejects.toThrow();
    await expect(sql`delete from api_usage where id = ${res.usageId}`).rejects.toThrow();
  });

  it("records estimated cost when usage is unknown (safe side)", async () => {
    const sql = await getDb();
    const res = await reserveApiCall(sql, { model: "claude-haiku-5-5", purpose: "t", estInputTokens: 100, maxOutputTokens: 100 });
    await finalizeApiCall(sql, res, null);
    const [row] = await sql`select status, cost_jpy, estimated_cost_jpy from api_usage where id = ${res.usageId}`;
    expect(row.status).toBe("unknown");
    expect(row.cost_jpy).toBe(row.estimated_cost_jpy);

    const res2 = await reserveApiCall(sql, { model: "claude-haiku-5-5", purpose: "t", estInputTokens: 100, maxOutputTokens: 100 });
    await failApiCall(sql, res2, "timeout", true);
    const [row2] = await sql`select status, cost_jpy from api_usage where id = ${res2.usageId}`;
    expect(row2.status).toBe("unknown");
    expect(row2.cost_jpy).toBeGreaterThan(0);
  });

  it("blocks unknown models, advanced models, emergency stop", async () => {
    const sql = await getDb();
    await expect(
      reserveApiCall(sql, { model: "gpt-x", purpose: "t", estInputTokens: 10, maxOutputTokens: 10 }),
    ).rejects.toMatchObject({ code: "unknown_pricing" });
    await expect(
      reserveApiCall(sql, { model: "claude-opus-5-5", purpose: "t", estInputTokens: 10, maxOutputTokens: 10 }),
    ).rejects.toMatchObject({ code: "advanced_model_not_allowed" });
    await sql`update company_settings set emergency_stop = true`;
    await expect(
      reserveApiCall(sql, { model: "claude-haiku-5-5", purpose: "t", estInputTokens: 10, maxOutputTokens: 10 }),
    ).rejects.toBeInstanceOf(BudgetBlockedError);
  });

  it("blocks when daily / monthly limits would be exceeded", async () => {
    const sql = await getDb();
    await sql`update budgets set daily_limit_jpy = 0.001`;
    await expect(
      reserveApiCall(sql, { model: "claude-haiku-5-5", purpose: "t", estInputTokens: 1000, maxOutputTokens: 1000 }),
    ).rejects.toMatchObject({ code: "daily_limit" });
    await sql`update budgets set daily_limit_jpy = 1000, emergency_stop_jpy = 0.001`;
    await expect(
      reserveApiCall(sql, { model: "claude-haiku-5-5", purpose: "t", estInputTokens: 1000, maxOutputTokens: 1000 }),
    ).rejects.toMatchObject({ code: "monthly_limit" });
  });

  it("limits calls per task and per minute (loop protection)", async () => {
    const sql = await getDb();
    const r = await createTask(sql, { title: "回数制限テスト用の業務", source: "user", createdBy: { type: "user" } });
    if (!r.created) throw new Error("not created");
    await sql`update budgets set max_calls_per_task = 2`;
    for (let i = 0; i < 2; i++) {
      const res = await reserveApiCall(sql, { model: "claude-haiku-5-5", purpose: "t", estInputTokens: 10, maxOutputTokens: 10, taskId: r.task.id });
      await finalizeApiCall(sql, res, { input_tokens: 10, output_tokens: 10 });
    }
    await expect(
      reserveApiCall(sql, { model: "claude-haiku-5-5", purpose: "t", estInputTokens: 10, maxOutputTokens: 10, taskId: r.task.id }),
    ).rejects.toMatchObject({ code: "task_calls" });

    const [{ n }] = await sql`select count(*)::int as n from api_usage where created_at > now() - interval '1 minute'`;
    await sql`update budgets set max_calls_per_minute = ${Math.max(1, n)}`;
    await expect(
      reserveApiCall(sql, { model: "claude-haiku-5-5", purpose: "t", estInputTokens: 10, maxOutputTokens: 10 }),
    ).rejects.toMatchObject({ code: "rate_limit" });
  });

  it("does not exceed limit under concurrent reservations", async () => {
    const sql = await getDb();
    const est = estimateCostJpy("claude-haiku-5-5", 1000, 1000, 160)!;
    await sql`update budgets set max_calls_per_minute = 60, max_calls_per_day = 2000, daily_limit_jpy = 100000`;
    const [{ spent }] = await sql`select coalesce(sum(coalesce(cost_jpy, estimated_cost_jpy)),0)::float8 as spent from api_usage`;
    // ちょうど3回分だけ余裕がある上限
    await sql`update budgets set emergency_stop_jpy = ${spent + est * 3.5}, monthly_limit_jpy = 100000`;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        reserveApiCall(sql, { model: "claude-haiku-5-5", purpose: "c", estInputTokens: 1000, maxOutputTokens: 1000 }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(3);
  });
});

describe("tasks", () => {
  it("detects duplicates", async () => {
    expect(similarity("デジタル商品の市場調査", "デジタル商品の市場調査をする")).toBeGreaterThan(0.8);
    expect(similarity("デジタル商品の市場調査", "週次報告書の作成")).toBeLessThan(0.3);
    const sql = await getDb();
    const a = await createTask(sql, { title: "デジタル商品の市場調査", source: "user", createdBy: { type: "user" } });
    const b = await createTask(sql, { title: "デジタル商品の 市場調査", source: "ai_discovered", createdBy: { type: "employee", employeeId: "bizdev" } });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
  });

  it("enforces status transitions and logs them", async () => {
    const sql = await getDb();
    const r = await createTask(sql, { title: "状態遷移テスト", source: "user", createdBy: { type: "user" } });
    if (!r.created) throw new Error();
    await changeTaskStatus(sql, r.task.id, "researching", { type: "user" });
    await expect(changeTaskStatus(sql, r.task.id, "approved", { type: "user" })).rejects.toThrow(/変更できません/);
    const logs = await getTaskLogs(sql, r.task.id);
    expect(logs.map((l) => l.action)).toEqual(["created", "status_changed"]);
  });
});

describe("approvals", () => {
  async function newApproval() {
    const sql = await getDb();
    const id = await createApproval(sql, {
      requestedByEmployeeId: "president",
      actionType: "send_message",
      title: "取引先へのメール送信",
      content: "こんにちは。",
      reason: "依頼のため",
      destination: "a@example.com",
      estimatedCostJpy: 0,
      risks: "誤送信",
      afterEffect: "送信される",
    });
    return { sql, id, approval: (await getApproval(sql, id))! };
  }

  it("cannot execute without approval", async () => {
    const { sql, id } = await newApproval();
    const ran: string[] = [];
    const exec = { send_message: async () => { ran.push(id); return { summary: "sent" }; } };
    const r = await executeApprovedAction(sql, id, exec);
    expect(r).toMatchObject({ ok: false, reason: "not_approved" });
    expect(ran).toHaveLength(0);
  });

  it("executes exactly once after approval, never twice", async () => {
    const { sql, id, approval } = await newApproval();
    await decideApproval(sql, id, "approve", "", approval.content_hash);
    let count = 0;
    const exec = { send_message: async () => { count++; return { summary: "sent" }; } };
    const [r1, r2] = await Promise.all([executeApprovedAction(sql, id, exec), executeApprovedAction(sql, id, exec)]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    expect(count).toBe(1);
    expect((await getApproval(sql, id))!.status).toBe("executed");
  });

  it("reports not implemented when no executor is registered (Phase 1)", async () => {
    const { sql, id, approval } = await newApproval();
    await decideApproval(sql, id, "approve", "", approval.content_hash);
    const r = await executeApprovedAction(sql, id);
    expect(r).toMatchObject({ ok: false, reason: "not_implemented" });
    expect((await getApproval(sql, id))!.status).toBe("approved");
  });

  it("content cannot be altered after creation; tampering is detected", async () => {
    const { sql, id, approval } = await newApproval();
    await expect(sql`update approvals set content = '別の内容' where id = ${id}`).rejects.toThrow(/変更できません/);
    await expect(sql`delete from approvals where id = ${id}`).rejects.toThrow();
    // 見ていた内容と違う指紋では承認できない
    await expect(decideApproval(sql, id, "approve", "", "wrong-hash")).rejects.toThrow(/内容が変わっています/);
    expect(approval.content_hash).toBe(
      computeContentHash({
        action_type: "send_message",
        title: approval.title,
        content: approval.content,
        destination: approval.destination,
        estimated_cost_jpy: approval.estimated_cost_jpy,
        payload: approval.payload,
      }),
    );
    // 承認済み→保留など、決められていない状態変更はDBが拒否
    await decideApproval(sql, id, "approve", "", approval.content_hash);
    await expect(sql`update approvals set status = 'pending' where id = ${id}`).rejects.toThrow();
  });

  it("resubmission supersedes old approval and requires new approval", async () => {
    const { sql, id, approval } = await newApproval();
    const newId = await resubmitApproval(
      sql,
      id,
      { title: approval.title, content: "修正後の本文", destination: approval.destination, estimatedCostJpy: 0, reason: "", risks: "", afterEffect: "" },
      approval.content_hash,
    );
    expect((await getApproval(sql, id))!.status).toBe("superseded");
    const n = (await getApproval(sql, newId))!;
    expect(n.status).toBe("pending");
    expect(n.supersedes_id).toBe(id);
    expect(n.content_hash).not.toBe(approval.content_hash);
    const r = await executeApprovedAction(sql, id, { send_message: async () => ({ summary: "x" }) });
    expect(r.ok).toBe(false);
  });
});

describe("chat (mock AI)", () => {
  beforeEach(async () => {
    const sql = await getDb();
    await sql`update budgets set daily_limit_jpy = 50, emergency_stop_jpy = 1800, monthly_limit_jpy = 2000, max_calls_per_minute = 60`;
    await sql`update company_settings set emergency_stop = false`;
  });

  it("president registers a task and approval from chat", async () => {
    const sql = await getDb();
    const r = await sendChatMessage(sql, "president", null, "競合サービスを調べる業務をお願い。結果を取引先に送信して", false);
    expect(r.ok).toBe(true);
    const msgs = await sql`select role, meta->>'kind' as kind from conversation_messages where conversation_id = ${r.conversationId} order by id`;
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "notice", "notice"]);
    expect(msgs.map((m) => m.kind)).toContain("approval_created");
    const [usage] = await sql`select status, employee_id, conversation_id from api_usage where conversation_id = ${r.conversationId}`;
    expect(usage.status).toBe("completed");
    expect(usage.employee_id).toBe("president");
  });

  it("stops chat when budget is exhausted and records notice", async () => {
    const sql = await getDb();
    await sql`update company_settings set emergency_stop = true`;
    const r = await sendChatMessage(sql, "secretary", null, "こんにちは", false);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/緊急停止/);
  });
});

describe("session signing", () => {
  it("verifies signature and expiry", async () => {
    const secret = "x".repeat(40);
    const now = Math.floor(Date.now() / 1000);
    const t = await signSession({ iat: now, exp: now + 60, v: 1 }, secret);
    expect(await verifySession(t, secret)).toMatchObject({ v: 1 });
    expect(await verifySession(t, "y".repeat(40))).toBeNull();
    expect(await verifySession(t.slice(0, -2) + "aa", secret)).toBeNull();
    const expired = await signSession({ iat: now - 100, exp: now - 1, v: 1 }, secret);
    expect(await verifySession(expired, secret)).toBeNull();
  });
});
