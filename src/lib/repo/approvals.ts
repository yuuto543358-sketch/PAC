import "server-only";
import { checkPostLength, platformOf } from "@/lib/sns/post";
import { enqueueNotification } from "@/lib/notify";
import { createHash } from "node:crypto";
import type postgres from "postgres";
type JSONValue = postgres.JSONValue;
import { begin, type Db, type Sql, type Tx } from "@/lib/db";
import {
  APPROVAL_ACTION_TYPES,
  OWNER_SENDS_ACTION_TYPES,
  OWNER_DOES_AFTER_EFFECT,
  OWNER_POSTS_AFTER_EFFECT,
  OWNER_SENDS_AFTER_EFFECT,
  SNS_PLATFORM_LABEL,
  type ApprovalActionType,
  type ApprovalStatus,
} from "@/lib/constants";
import { addTaskLog } from "./tasks";

export type Approval = {
  id: string;
  task_id: string | null;
  task_title: string | null;
  requested_by_employee_id: string | null;
  requester_name: string | null;
  action_type: ApprovalActionType;
  title: string;
  content: string;
  reason: string;
  destination: string;
  estimated_cost_jpy: number;
  risks: string;
  after_effect: string;
  payload: Record<string, unknown>;
  content_hash: string;
  status: ApprovalStatus;
  decision_note: string;
  supersedes_id: string | null;
  decided_at: Date | null;
  executed_at: Date | null;
  created_at: Date;
};

export type ApprovalEvent = {
  id: number;
  event: string;
  from_status: string | null;
  to_status: string | null;
  note: string;
  actor_type: string;
  created_at: Date;
};

export type ApprovalContent = {
  action_type: ApprovalActionType;
  title: string;
  content: string;
  destination: string;
  estimated_cost_jpy: number;
  payload: Record<string, unknown>;
};

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

/**
 * 承認の対象（操作の種類・内容・実行先・費用・詳細データ）から「指紋」を作ります。
 * 実行時にこの指紋を再計算して一致を確認するので、承認後に中身がすり替わると実行できません。
 */
export function computeContentHash(c: ApprovalContent): string {
  return createHash("sha256")
    .update(
      canonical({
        action_type: c.action_type,
        title: c.title,
        content: c.content,
        destination: c.destination,
        estimated_cost_jpy: Number(c.estimated_cost_jpy).toFixed(2),
        payload: c.payload,
      }),
    )
    .digest("hex");
}

const APPROVAL_SELECT = `
  select a.*, t.title as task_title, e.name as requester_name
  from approvals a
  left join tasks t on t.id = a.task_id
  left join employees e on e.id = a.requested_by_employee_id`;

export async function listApprovals(db: Db, view: "open" | "closed" | "all" = "open"): Promise<Approval[]> {
  const where =
    view === "open"
      ? `where a.status in ('pending','on_hold')`
      : view === "closed"
        ? `where a.status not in ('pending','on_hold')`
        : "";
  return db.unsafe<Approval[]>(
    `${APPROVAL_SELECT} ${where}
     order by case a.status when 'pending' then 0 when 'on_hold' then 1 else 2 end, a.created_at desc limit 200`,
    [],
    { simple: false },
  );
}

export async function getApproval(db: Db, id: string): Promise<Approval | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.unsafe<Approval[]>(`${APPROVAL_SELECT} where a.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getApprovalEvents(db: Db, id: string): Promise<ApprovalEvent[]> {
  return db<ApprovalEvent[]>`select * from approval_events where approval_id = ${id} order by id`;
}

export async function countPendingApprovals(db: Db): Promise<number> {
  const [row] = await db<{ n: number }[]>`select count(*)::int as n from approvals where status = 'pending'`;
  return row.n;
}

export type CreateApprovalInput = {
  taskId?: string | null;
  requestedByEmployeeId?: string | null;
  actionType: string;
  title: string;
  content: string;
  reason: string;
  destination: string;
  estimatedCostJpy: number;
  risks: string;
  afterEffect: string;
  payload?: Record<string, unknown>;
  supersedesId?: string | null;
};

async function insertEvent(
  tx: Db,
  approvalId: string,
  event: string,
  from: string | null,
  to: string | null,
  note = "",
  actorType = "user",
) {
  await tx`
    insert into approval_events (approval_id, event, from_status, to_status, note, actor_type)
    values (${approvalId}, ${event}, ${from}, ${to}, ${note}, ${actorType})`;
}

function validateInput(input: CreateApprovalInput): ApprovalContent {
  const actionType = (APPROVAL_ACTION_TYPES as readonly string[]).includes(input.actionType)
    ? (input.actionType as ApprovalActionType)
    : "other";
  const title = input.title.trim().slice(0, 200);
  const content = input.content.trim().slice(0, 20000);
  if (!title || !content) throw new Error("承認依頼には件名と内容が必要です");
  const cost = Number(input.estimatedCostJpy);
  if (!Number.isFinite(cost) || cost < 0 || cost > 10_000_000) throw new Error("費用の値が正しくありません");
  return {
    action_type: actionType,
    title,
    content,
    destination: input.destination.trim().slice(0, 500),
    estimated_cost_jpy: Math.round(cost * 100) / 100,
    payload: input.payload ?? {},
  };
}

export async function createApprovalTx(tx: Tx, rawInput: CreateApprovalInput, actorType = "employee") {
  // アプリには外部で自動実行する機能がない（メールは経営者の方針で自分で送る）。
  // AIが何と書いても「承認後に何が起こるか」は、事実どおりの固定の説明にする
  let input: CreateApprovalInput =
    rawInput.actionType === "accept_deliverable"
      ? rawInput
      : {
          ...rawInput,
          afterEffect: rawInput.actionType === "send_message" ? OWNER_SENDS_AFTER_EFFECT : OWNER_DOES_AFTER_EFFECT,
        };
  if (rawInput.actionType === "sns_post") {
    // SNSへの投稿：どのSNS向けかを記録する。投稿は経営者が自分で行うので、アプリ側の費用はかからない
    const platform = platformOf({ payload: (rawInput.payload ?? null) as Record<string, unknown> | null, destination: rawInput.destination });
    const tooLong = platform ? checkPostLength(platform, rawInput.content) : null;
    input = {
      ...input,
      destination: platform ? SNS_PLATFORM_LABEL[platform] : rawInput.destination,
      payload: { ...(rawInput.payload ?? {}), ...(platform ? { platform } : {}) },
      estimatedCostJpy: 0,
      risks: tooLong ? `【注意】${tooLong}。「内容を修正して再提出」で短くしてください。\n${rawInput.risks}` : rawInput.risks,
      afterEffect: OWNER_POSTS_AFTER_EFFECT,
    };
  }
  const c = validateInput(input);
  const hash = computeContentHash(c);
  const [row] = await tx<{ id: string }[]>`
    insert into approvals (task_id, requested_by_employee_id, action_type, title, content, reason, destination,
      estimated_cost_jpy, risks, after_effect, payload, content_hash, supersedes_id)
    values (${input.taskId ?? null}, ${input.requestedByEmployeeId ?? null}, ${c.action_type}, ${c.title},
      ${c.content}, ${input.reason.slice(0, 2000)}, ${c.destination}, ${c.estimated_cost_jpy},
      ${input.risks.slice(0, 2000)}, ${input.afterEffect.slice(0, 2000)}, ${tx.json(c.payload as JSONValue)},
      ${hash}, ${input.supersedesId ?? null})
    returning id`;
  await insertEvent(tx, row.id, input.supersedesId ? "resubmitted" : "created", null, "pending", "", actorType);
  // 経営者が自分で出した（修正して再提出した）ものは、通知しない
  if (actorType !== "user") {
    await enqueueNotification(tx, {
      kind: "approval",
      title: c.action_type === "accept_deliverable" ? "成果物の確認をお願いします" : "承認のお願いが届きました",
      body: c.title,
      url: `/approvals/${row.id}`,
      dedupeKey: `approval:${row.id}`,
    });
  }
  if (input.taskId) {
    const [t] = await tx<{ status: string }[]>`select status from tasks where id = ${input.taskId} for update`;
    if (t && t.status !== "awaiting_approval") {
      await tx`update tasks set status = 'awaiting_approval', updated_at = now() where id = ${input.taskId}`;
      await addTaskLog(
        tx,
        input.taskId,
        input.requestedByEmployeeId ? { type: "employee", employeeId: input.requestedByEmployeeId } : { type: "system" },
        "approval_requested",
        `承認を依頼しました：${c.title}`,
        t.status,
        "awaiting_approval",
      );
    }
  }
  return row.id;
}

export async function createApproval(sql: Sql, input: CreateApprovalInput, actorType = "employee") {
  return begin(sql, (tx) => createApprovalTx(tx, input, actorType));
}

/** 経営者の判断（承認・却下・保留）を記録します。 */
export async function decideApproval(
  sql: Sql,
  approvalId: string,
  decision: "approve" | "reject" | "hold",
  note: string,
  expectedHash: string,
) {
  await begin(sql, async (tx) => {
    const [a] = await tx<
      { status: ApprovalStatus; task_id: string | null; content_hash: string; title: string; action_type: string; payload: Record<string, unknown> }[]
    >`select status, task_id, content_hash, title, action_type, payload from approvals where id = ${approvalId} for update`;
    if (!a) throw new Error("承認依頼が見つかりません");
    // 画面を開いた後に中身が変わっていないか確認（見た内容と違うものを承認しないため）
    if (a.content_hash !== expectedHash) {
      throw new Error("承認依頼の内容が変わっています。画面を再読み込みして確認し直してください。");
    }
    if (a.status !== "pending" && a.status !== "on_hold") {
      throw new Error("この承認依頼はすでに処理済みです");
    }
    const to: ApprovalStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "on_hold";
    if (to === a.status) return;
    await tx`
      update approvals set status = ${to}, decision_note = ${note.slice(0, 2000)},
        decided_at = ${to === "on_hold" ? null : tx`now()`}
      where id = ${approvalId}`;
    await insertEvent(tx, approvalId, decision, a.status, to, note.slice(0, 2000));
    if (a.task_id && a.action_type === "accept_deliverable") {
      await onDeliverableDecision(tx, a.task_id, decision, note, Number(a.payload?.deliverableVersion) || null);
      return;
    }
    if (a.task_id) {
      const [t] = await tx<{ status: string }[]>`select status from tasks where id = ${a.task_id} for update`;
      const taskTo = decision === "approve" ? "approved" : decision === "reject" ? "on_hold" : null;
      if (t && taskTo && t.status === "awaiting_approval") {
        await tx`update tasks set status = ${taskTo}, updated_at = now() where id = ${a.task_id}`;
        await addTaskLog(
          tx,
          a.task_id,
          { type: "user" },
          decision === "approve" ? "approval_approved" : "approval_rejected",
          decision === "approve" ? `承認されました：${a.title}` : `承認が却下されました：${a.title}${note ? `（${note}）` : ""}`,
          t.status,
          taskTo,
        );
      }
    }
  });
}

/**
 * 成果物の最終確認（チームの成果物の受け取り）の判断。
 * 承認 → 業務を完了にする。差し戻し → コメントを修正指示としてチームに伝え、修正版を作らせる。
 */
async function onDeliverableDecision(
  tx: Tx,
  taskId: string,
  decision: "approve" | "reject" | "hold",
  note: string,
  version: number | null,
) {
  if (decision === "hold") return;
  const [t] = await tx<{ status: string }[]>`select status from tasks where id = ${taskId} for update`;
  if (!t) return;
  if (decision === "approve") {
    if (version) await tx`update deliverables set status = 'accepted' where task_id = ${taskId} and version = ${version}`;
    if (t.status !== "completed") {
      await tx`update tasks set status = 'completed', completed_at = now(), updated_at = now() where id = ${taskId}`;
      await addTaskLog(tx, taskId, { type: "user" }, "approval_approved", "経営者が成果物を承認しました（業務完了）", t.status, "completed");
    }
    await tx`update task_workflows set phase = 'done', waiting_reason = '', updated_at = now() where task_id = ${taskId}`;
    await tx`insert into task_messages (task_id, author_type, kind, content, meta)
      values (${taskId}, 'system', 'system', '経営者が成果物を承認しました。業務完了です。お疲れさまでした。', ${tx.json({ tone: "info" })})`;
    await tx`update employees set experience_points = experience_points + 3
      where id in (select employee_id from task_members where task_id = ${taskId})`;
    return;
  }
  // 差し戻し
  if (version) await tx`update deliverables set status = 'rejected', review_note = ${note.slice(0, 4000)} where task_id = ${taskId} and version = ${version}`;
  const instruction = note.trim() || "成果物を見直して、もう一度提出してください。";
  await tx`insert into task_messages (task_id, author_type, kind, content) values (${taskId}, 'owner', 'instruction', ${`【差し戻し】${instruction}`})`;
  await tx`update tasks set status = 'producing', updated_at = now() where id = ${taskId}`;
  await addTaskLog(tx, taskId, { type: "user" }, "approval_rejected", `成果物を差し戻しました：${instruction.slice(0, 200)}`, t.status, "producing");
  await tx`update task_workflows set phase = 'rework', waiting_reason = '', rework_count = 0, failures = 0, autopilot = true, updated_at = now()
    where task_id = ${taskId}`;
}

/** 内容を修正して再提出：新しい承認依頼を作り、元の依頼は「置き換え」にします（再承認が必要）。 */
export async function resubmitApproval(
  sql: Sql,
  approvalId: string,
  edits: { title: string; content: string; destination: string; estimatedCostJpy: number; reason: string; risks: string; afterEffect: string },
  expectedHash: string,
): Promise<string> {
  return begin(sql, async (tx) => {
    const [a] = await tx<Approval[]>`select * from approvals where id = ${approvalId} for update`;
    if (!a) throw new Error("承認依頼が見つかりません");
    if (a.content_hash !== expectedHash) throw new Error("承認依頼の内容が変わっています。再読み込みしてください。");
    if (a.status !== "pending" && a.status !== "on_hold") throw new Error("この承認依頼はすでに処理済みです");
    await tx`update approvals set status = 'superseded', decided_at = now() where id = ${approvalId}`;
    await insertEvent(tx, approvalId, "superseded", a.status, "superseded", "経営者が内容を修正して再提出");
    return createApprovalTx(
      tx,
      {
        taskId: a.task_id,
        requestedByEmployeeId: a.requested_by_employee_id,
        actionType: a.action_type,
        title: edits.title,
        content: edits.content,
        reason: edits.reason,
        destination: edits.destination,
        estimatedCostJpy: edits.estimatedCostJpy,
        risks: edits.risks,
        afterEffect: edits.afterEffect,
        payload: a.payload,
        supersedesId: a.id,
      },
      "user",
    );
  });
}

// ===== 実行（Phase 4で実際の実行機能を登録） =====

export type ApprovedAction = Readonly<Approval>;
export type ActionExecutor = (action: ApprovedAction) => Promise<{ summary: string }>;

// いまアプリには、外部で自動的に実行する仕組みはありません（executors を渡したときだけ実行します）。
// メール・メッセージとSNSへの投稿は、経営者が自分で行う方針のため、渡されても実行しません（下で拒否します）。

export type ExecuteResult =
  | { ok: true; summary: string }
  | { ok: false; reason: "not_approved" | "hash_mismatch" | "not_implemented" | "failed" | "not_found"; message: string };

/**
 * 承認済みの操作を実行する唯一の入口。サーバー側で以下をすべて確認します。
 *  1. 承認状態が「承認済み」であること
 *  2. 保存されている内容から指紋を再計算し、承認時の指紋と一致すること
 *  3. 実行機能が登録されていること
 *  4. 二重実行を防ぐため、実行前に状態を「実行中」に変えること
 */
export async function executeApprovedAction(
  sql: Sql,
  approvalId: string,
  executors?: Partial<Record<ApprovalActionType, ActionExecutor>>,
): Promise<ExecuteResult> {
  const prepared = await begin(sql, async (tx) => {
    const [a] = await tx<Approval[]>`select * from approvals where id = ${approvalId} for update`;
    if (!a) return { ok: false as const, reason: "not_found" as const, message: "承認依頼が見つかりません" };
    if (a.status !== "approved") {
      return { ok: false as const, reason: "not_approved" as const, message: "承認されていない操作は実行できません" };
    }
    const recomputed = computeContentHash({
      action_type: a.action_type,
      title: a.title,
      content: a.content,
      destination: a.destination,
      estimated_cost_jpy: Number(a.estimated_cost_jpy),
      payload: a.payload,
    });
    if (recomputed !== a.content_hash) {
      return {
        ok: false as const,
        reason: "hash_mismatch" as const,
        message: "承認後に内容が変わっているため実行できません。再承認が必要です。",
      };
    }
    if (OWNER_SENDS_ACTION_TYPES.includes(a.action_type)) {
      return {
        ok: false as const,
        reason: "not_implemented" as const,
        message: a.action_type === "sns_post"
          ? "SNSへの投稿は、経営者がご自身で行います（アプリは投稿しません）"
          : "メール・メッセージは、経営者がご自身で送ります（アプリは自動で送りません）",
      };
    }
    const executor = executors?.[a.action_type];
    if (!executor) {
      return {
        ok: false as const,
        reason: "not_implemented" as const,
        message: "この種類の操作をアプリが実行する機能はありません。必要なら、経営者がご自身で行います。承認内容は記録済みです。",
      };
    }
    await tx`update approvals set status = 'executing' where id = ${approvalId}`;
    await insertEvent(tx, approvalId, "execution_started", "approved", "executing", "", "system");
    return { ok: true as const, approval: a, executor };
  });
  if (!prepared.ok) return prepared;

  try {
    const result = await prepared.executor(Object.freeze({ ...prepared.approval }));
    await begin(sql, async (tx) => {
      await tx`update approvals set status = 'executed', executed_at = now() where id = ${approvalId}`;
      await insertEvent(tx, approvalId, "executed", "executing", "executed", result.summary.slice(0, 2000), "system");
    });
    return { ok: true, summary: result.summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await begin(sql, async (tx) => {
      await tx`update approvals set status = 'execution_failed' where id = ${approvalId}`;
      await insertEvent(tx, approvalId, "execution_failed", "executing", "execution_failed", msg.slice(0, 2000), "system");
    });
    return { ok: false, reason: "failed", message: `実行に失敗しました：${msg}` };
  }
}
