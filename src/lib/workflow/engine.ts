import "server-only";
import type { z } from "zod";
import type { Sql, Tx } from "@/lib/db";
import { begin } from "@/lib/db";
import { ACTIVE_WORKFLOW_PHASES, APPROVAL_ACTION_LABEL, DELIVERABLE_FORMAT_IDS, MEMBER_ROLE_LABEL, type WorkflowPhase } from "@/lib/constants";
import { AiUnavailableError, BudgetBlockedError, callStructured } from "@/lib/ai/client";
import { getSettings } from "@/lib/repo/settings";
import { listEmployees, type EmployeeWithStats } from "@/lib/repo/employees";
import { addTaskLog, getTask } from "@/lib/repo/tasks";
import { createApprovalTx } from "@/lib/repo/approvals";
import { createStepLogger } from "@/lib/log";
import { todayJst } from "@/lib/format";
import {
  acquireLease,
  addDeliverable,
  addRoomMessage,
  getDeliverable,
  listMembers,
  listRoomMessages,
  listRunnableTaskIds,
  releaseLease,
  setDeliverableStatus,
  setMember,
  setTaskStatusSystem,
  updateWorkflow,
  getWorkflow,
  type Member,
  type Workflow,
} from "./repo";
import { buildStepInstruction, buildTeamContext, type PromptContext } from "./prompts";
import {
  DiscussionSchema,
  DraftSchema,
  FinalReportSchema,
  KickoffSchema,
  ReviewSchema,
  type DiscussionOutput,
  type DraftOutput,
  type FinalReportOutput,
  type KickoffOutput,
  type ReviewOutput,
} from "./schemas";
import { mockDiscussion, mockDraft, mockFinal, mockKickoff, mockReview } from "./mock";

// ===== 安全のための上限 =====
/** 1つの業務でAIが成功した作業の最大回数（これを超えたら停止して経営者に知らせる） */
export const MAX_STEPS_PER_TASK = 30;
/** 監査による差し戻しの最大回数 */
export const MAX_REWORK = 2;
/** 同じ担当が続けて失敗したら担当を変える回数 */
export const FAILURES_BEFORE_REASSIGN = 2;
/** 続けて失敗したらチームを停止する回数 */
export const MAX_FAILURES = 4;
/** 議論で発言する人数の上限 */
const MAX_DISCUSSION_SPEAKERS = 3;

const STOPPED_TASK_STATUSES = ["on_hold", "rejected", "failed", "completed"];

export type StepResult =
  | { status: "stepped"; phase: WorkflowPhase; speakerId: string; costJpy: number }
  | { status: "transitioned"; phase: WorkflowPhase; to: WorkflowPhase }
  | { status: "busy" }
  | { status: "idle" }
  | { status: "blocked"; scope: "task" | "global"; code: string; message: string }
  | { status: "failed"; phase: WorkflowPhase; message: string }
  | { status: "stopped"; message: string };

/** 議論で発言する順番（リーダー → メンバー） */
export function discussionSpeakers(members: Member[]): string[] {
  const lead = members.filter((m) => m.role === "lead").map((m) => m.employee_id);
  const others = members.filter((m) => m.role === "member").map((m) => m.employee_id);
  return [...lead, ...others].slice(0, MAX_DISCUSSION_SPEAKERS);
}

/** 次に発言（作業）する社員 */
export function nextSpeakerId(wf: Workflow, members: Member[]): string | null {
  switch (wf.phase) {
    case "kickoff":
    case "final_report":
      return "president";
    case "discussion":
      return discussionSpeakers(members)[wf.discussion_index] ?? null;
    case "drafting":
    case "rework":
      return wf.lead_id;
    case "review":
      return wf.reviewer_id;
    default:
      return null;
  }
}

const PHASE_STATUS: Partial<Record<WorkflowPhase, "researching" | "producing" | "analyzing" | "ready">> = {
  discussion: "researching",
  drafting: "producing",
  rework: "producing",
  review: "analyzing",
  final_report: "ready",
};

async function moveTo(tx: Tx, wf: Workflow, to: WorkflowPhase, extra: Partial<Workflow> = {}) {
  await updateWorkflow(tx, wf.task_id, { ...extra, phase: to });
  const status = PHASE_STATUS[to];
  if (status) await setTaskStatusSystem(tx, wf.task_id, status, { type: "system" }, `チームの作業：${to}`);
}

async function systemMessage(db: Sql | Tx, taskId: string, content: string, tone: "info" | "warn" | "error" = "info") {
  await addRoomMessage(db, { taskId, authorType: "system", kind: "system", content, meta: { tone } });
}

// ===== 1回分の作業 =====

type CallConfig<T extends z.ZodType> = {
  schema: T;
  schemaName: string;
  maxTokens: number;
  effort: "low" | "medium";
  mock: (ctx: PromptContext) => z.infer<T>;
};

const CONFIG = {
  kickoff: { schema: KickoffSchema, schemaName: "team_kickoff", maxTokens: 3000, effort: "low", mock: mockKickoff },
  discussion: { schema: DiscussionSchema, schemaName: "team_discussion", maxTokens: 2000, effort: "low", mock: mockDiscussion },
  drafting: { schema: DraftSchema, schemaName: "team_draft", maxTokens: 9000, effort: "medium", mock: mockDraft },
  rework: { schema: DraftSchema, schemaName: "team_rework", maxTokens: 9000, effort: "medium", mock: mockDraft },
  review: { schema: ReviewSchema, schemaName: "team_review", maxTokens: 2500, effort: "low", mock: mockReview },
  final_report: { schema: FinalReportSchema, schemaName: "team_final_report", maxTokens: 3500, effort: "low", mock: mockFinal },
} satisfies Record<string, CallConfig<z.ZodType>>;

/**
 * 1つの業務を1段階だけ進めます。同時に2か所で同じ業務を進めないよう、ロック（リース）を取ってから行います。
 */
export async function runWorkflowStep(sql: Sql, taskId: string, owner: string): Promise<StepResult> {
  const wf = await acquireLease(sql, taskId, owner);
  if (!wf) return { status: "busy" };
  try {
    return await doStep(sql, wf);
  } finally {
    await releaseLease(sql, taskId, owner);
  }
}

async function doStep(sql: Sql, wf: Workflow): Promise<StepResult> {
  const log = createStepLogger("team");
  const task = await getTask(sql, wf.task_id);
  if (!task) return { status: "idle" };
  if (!wf.autopilot || !ACTIVE_WORKFLOW_PHASES.includes(wf.phase) || STOPPED_TASK_STATUSES.includes(task.status)) {
    return { status: "idle" };
  }

  if (wf.steps >= MAX_STEPS_PER_TASK) {
    const message = `作業の回数が上限（${MAX_STEPS_PER_TASK}回）に達したため、チームを停止しました。内容を確認して、指示を出すか「再開」してください。`;
    await begin(sql, async (tx) => {
      await updateWorkflow(tx, wf.task_id, { phase: "stopped", resume_phase: wf.phase });
      await systemMessage(tx, wf.task_id, message, "warn");
    });
    return { status: "stopped", message };
  }

  const [roster, members, messages, deliverable, settings] = await Promise.all([
    listEmployees(sql),
    listMembers(sql, wf.task_id),
    listRoomMessages(sql, wf.task_id, 60),
    getDeliverable(sql, wf.task_id),
    getSettings(sql),
  ]);

  // AIを使わずに次の段階へ進めるだけの場合
  if (wf.phase === "discussion" && wf.discussion_index >= discussionSpeakers(members).length) {
    await begin(sql, (tx) => moveTo(tx, wf, "drafting"));
    return { status: "transitioned", phase: wf.phase, to: "drafting" };
  }
  if (wf.phase === "review" && !wf.reviewer_id) {
    await begin(sql, (tx) => moveTo(tx, wf, "final_report"));
    return { status: "transitioned", phase: wf.phase, to: "final_report" };
  }
  if ((wf.phase === "drafting" || wf.phase === "rework") && !wf.lead_id) {
    await begin(sql, (tx) => moveTo(tx, wf, "kickoff"));
    return { status: "transitioned", phase: wf.phase, to: "kickoff" };
  }

  const speakerId = nextSpeakerId(wf, members);
  const speaker = roster.find((e) => e.id === speakerId);
  if (!speaker) {
    const message = "担当する社員が見つからないため、チームを停止しました。";
    await begin(sql, async (tx) => {
      await updateWorkflow(tx, wf.task_id, { phase: "stopped", resume_phase: wf.phase });
      await systemMessage(tx, wf.task_id, message, "error");
    });
    return { status: "stopped", message };
  }

  const knowledge = await sql<{ title: string; content: string }[]>`
    select title, content from knowledge where employee_id = ${speaker.id} order by created_at desc limit 5`;
  const ctx: PromptContext = {
    settings,
    task,
    workflow: wf,
    speaker,
    roster,
    members,
    messages,
    deliverable,
    knowledge,
    todayJst: todayJst(),
  };
  const phase = wf.phase as keyof typeof CONFIG;
  const cfg = CONFIG[phase];
  log.step("call", { task: wf.task_id, phase, speaker: speaker.id });

  await sql`update employees set status = 'working' where id = ${speaker.id}`;
  let result;
  try {
    result = await callStructured(sql, {
      model: settings.model_standard,
      effort: cfg.effort,
      maxTokens: cfg.maxTokens,
      system: buildTeamContext(ctx),
      messages: [{ role: "user", content: buildStepInstruction(wf.phase, ctx) }],
      schema: cfg.schema as z.ZodType,
      schemaName: cfg.schemaName,
      purpose: `team:${phase}`,
      employeeId: speaker.id,
      taskId: wf.task_id,
      mock: () => (cfg.mock as (c: PromptContext) => unknown)(ctx),
    });
  } catch (err) {
    if (err instanceof BudgetBlockedError) return handleBudgetBlock(sql, wf, err);
    const message = err instanceof AiUnavailableError ? err.message : "予期しないエラーが発生しました";
    if (!(err instanceof AiUnavailableError)) log.fail("step", err);
    return handleFailure(sql, wf, members, speaker, message);
  } finally {
    await sql`update employees set status = 'idle' where id = ${speaker.id}`;
  }
  if (!result.ok) return handleFailure(sql, wf, members, speaker, result.message);

  const meta = { costJpy: result.costJpy };
  await begin(sql, async (tx) => {
    switch (wf.phase) {
      case "kickoff":
        await applyKickoff(tx, wf, roster, task.assignee_id, result.data as KickoffOutput, result.usageId, meta);
        break;
      case "discussion":
        await applyDiscussion(tx, wf, speaker, result.data as DiscussionOutput, result.usageId, meta);
        break;
      case "drafting":
      case "rework":
        await applyDraft(tx, wf, speaker, result.data as DraftOutput, result.usageId, meta);
        break;
      case "review":
        await applyReview(tx, wf, speaker, result.data as ReviewOutput, result.usageId, meta);
        break;
      case "final_report":
        await applyFinal(tx, wf, task.title, roster, members, result.data as FinalReportOutput, result.usageId, meta);
        break;
    }
    await tx`
      update task_workflows set steps = steps + 1, failures = 0, last_step_at = now(), updated_at = now()
      where task_id = ${wf.task_id}`;
  });
  log.step("done", { task: wf.task_id, phase, costJpy: result.costJpy });
  return { status: "stepped", phase: wf.phase, speakerId: speaker.id, costJpy: result.costJpy };
}

// ===== 段階ごとの反映 =====

type Meta = { costJpy: number };

async function askOwner(tx: Tx, wf: Workflow, speakerId: string, question: string, resume: WorkflowPhase) {
  await addRoomMessage(tx, { taskId: wf.task_id, authorType: "employee", employeeId: speakerId, kind: "question_to_owner", content: question });
  await updateWorkflow(tx, wf.task_id, { phase: "waiting_human", waiting_reason: "question", resume_phase: resume });
}

async function applyKickoff(
  tx: Tx,
  wf: Workflow,
  roster: EmployeeWithStats[],
  currentAssignee: string | null,
  out: KickoffOutput,
  usageId: string,
  meta: Meta,
) {
  const valid = new Set(roster.filter((e) => e.role_key !== "president").map((e) => e.id));
  const lead = valid.has(out.lead_id)
    ? out.lead_id
    : currentAssignee && valid.has(currentAssignee)
      ? currentAssignee
      : (roster.find((e) => e.role_key === "secretary")?.id ?? [...valid][0]);
  const financeId = roster.find((e) => e.role_key === "finance")?.id ?? null;
  const memberIds = [...new Set(out.member_ids)].filter((id) => valid.has(id) && id !== lead && id !== financeId).slice(0, 2);
  const reviewer = financeId && financeId !== lead ? financeId : (memberIds[0] ?? "president");

  await setMember(tx, wf.task_id, lead, "lead");
  for (const id of memberIds) await setMember(tx, wf.task_id, id, "member");
  if (reviewer !== "president") await setMember(tx, wf.task_id, reviewer, "reviewer");
  await tx`update tasks set assignee_id = ${lead}, updated_at = now() where id = ${wf.task_id}`;
  const name = (id: string) => roster.find((e) => e.id === id)?.name ?? id;
  await addTaskLog(tx, wf.task_id, { type: "employee", employeeId: "president" }, "assigned", `チーム編成：リーダー ${name(lead)}`);

  const format = DELIVERABLE_FORMAT_IDS.includes(out.plan.output_format) ? out.plan.output_format : "markdown_report";
  const plan = {
    goal: out.plan.goal.slice(0, 500),
    steps: out.plan.steps.slice(0, 6).map((s) => s.slice(0, 200)),
    output_format: format,
    deliverable_title: out.plan.deliverable_title.slice(0, 200),
    done_criteria: out.plan.done_criteria.slice(0, 500),
  };
  await addRoomMessage(tx, { taskId: wf.task_id, authorType: "employee", employeeId: "president", kind: "plan", content: out.message, meta, apiUsageId: usageId });
  await systemMessage(
    tx,
    wf.task_id,
    `チームを編成しました：${MEMBER_ROLE_LABEL.lead} ${name(lead)}${memberIds.length ? `／${MEMBER_ROLE_LABEL.member} ${memberIds.map(name).join("・")}` : ""}／${MEMBER_ROLE_LABEL.reviewer} ${name(reviewer)}`,
  );
  await updateWorkflow(tx, wf.task_id, { plan, lead_id: lead, reviewer_id: reviewer, discussion_index: 0 });
  if (out.question_to_owner) {
    await askOwner(tx, wf, "president", out.question_to_owner, "discussion");
    await setTaskStatusSystem(tx, wf.task_id, "researching", { type: "system" }, "チーム編成");
  } else {
    await moveTo(tx, wf, "discussion");
  }
}

async function applyDiscussion(tx: Tx, wf: Workflow, speaker: EmployeeWithStats, out: DiscussionOutput, usageId: string, meta: Meta) {
  await addRoomMessage(tx, { taskId: wf.task_id, authorType: "employee", employeeId: speaker.id, kind: out.kind, content: out.message, meta, apiUsageId: usageId });
  await updateWorkflow(tx, wf.task_id, { discussion_index: wf.discussion_index + 1 });
  if (out.question_to_owner) await askOwner(tx, wf, speaker.id, out.question_to_owner, "discussion");
}

async function applyDraft(tx: Tx, wf: Workflow, speaker: EmployeeWithStats, out: DraftOutput, usageId: string, meta: Meta) {
  const format = DELIVERABLE_FORMAT_IDS.includes(out.deliverable.format) ? out.deliverable.format : "markdown_report";
  const version = await addDeliverable(tx, {
    taskId: wf.task_id,
    title: out.deliverable.title || wf.plan.deliverable_title || "成果物",
    format,
    content: out.deliverable.content,
    authorEmployeeId: speaker.id,
  });
  await addRoomMessage(tx, {
    taskId: wf.task_id,
    authorType: "employee",
    employeeId: speaker.id,
    kind: "deliverable",
    content: out.message,
    meta: { ...meta, deliverableVersion: version },
    apiUsageId: usageId,
  });
  await tx`update tasks set deliverable = ${out.deliverable.content.slice(0, 20000)} where id = ${wf.task_id}`;
  await addTaskLog(tx, wf.task_id, { type: "employee", employeeId: speaker.id }, "deliverable_updated", `成果物 第${version}版を作成しました`);
  const proposed = out.external_actions.slice(0, 2);
  await updateWorkflow(tx, wf.task_id, { plan: { ...wf.plan, proposed_actions: proposed } as Workflow["plan"] });
  if (out.question_to_owner) {
    await askOwner(tx, wf, speaker.id, out.question_to_owner, "review");
  } else {
    await moveTo(tx, wf, "review");
  }
}

async function applyReview(tx: Tx, wf: Workflow, speaker: EmployeeWithStats, out: ReviewOutput, usageId: string, meta: Meta) {
  const latest = await getDeliverable(tx, wf.task_id);
  const points = out.points.slice(0, 8);
  const risks = out.risks.slice(0, 8);
  await addRoomMessage(tx, {
    taskId: wf.task_id,
    authorType: "employee",
    employeeId: speaker.id,
    kind: "review",
    content: `${out.message}${points.length && out.verdict === "revise" ? `\n\n修正してほしい点:\n${points.map((p) => `・${p}`).join("\n")}` : ""}`,
    meta: { ...meta, verdict: out.verdict, deliverableVersion: latest?.version },
    apiUsageId: usageId,
  });
  const plan = { ...wf.plan, review_risks: risks } as Workflow["plan"];
  if (out.verdict === "approve") {
    if (latest) await setDeliverableStatus(tx, wf.task_id, latest.version, "passed", risks.join("\n"));
    await moveTo(tx, wf, "final_report", { plan });
    return;
  }
  if (latest) await setDeliverableStatus(tx, wf.task_id, latest.version, "revise", points.join("\n"));
  if (wf.rework_count < MAX_REWORK) {
    await moveTo(tx, wf, "rework", { plan, rework_count: wf.rework_count + 1 });
  } else {
    await systemMessage(tx, wf.task_id, `修正の回数が上限（${MAX_REWORK}回）に達したため、残った指摘も含めて社長が報告します。`, "warn");
    await moveTo(tx, wf, "final_report", { plan: { ...plan, review_risks: [...risks, ...points.map((p) => `未対応の指摘：${p}`)] } as Workflow["plan"] });
  }
}

async function applyFinal(
  tx: Tx,
  wf: Workflow,
  taskTitle: string,
  roster: EmployeeWithStats[],
  members: Member[],
  out: FinalReportOutput,
  usageId: string,
  meta: Meta,
) {
  const latest = await getDeliverable(tx, wf.task_id);
  const nextSteps = out.next_steps.slice(0, 3);
  const reportBody = `${out.report}${nextSteps.length ? `\n\n今後の提案:\n${nextSteps.map((s) => `・${s}`).join("\n")}` : ""}`;
  await tx`
    insert into reports (report_type, title, content, employee_id, task_id, period_start, period_end)
    values ('task', ${`業務完了報告：${taskTitle}`.slice(0, 200)}, ${reportBody}, 'president', ${wf.task_id},
      (now() at time zone 'Asia/Tokyo')::date, (now() at time zone 'Asia/Tokyo')::date)`;
  await addRoomMessage(tx, { taskId: wf.task_id, authorType: "employee", employeeId: "president", kind: "report", content: reportBody, meta, apiUsageId: usageId });

  // 学びを社員の記憶として保存（次の仕事のときに参照される）
  const memberIds = new Set(members.map((m) => m.employee_id));
  for (const l of out.lessons.slice(0, 6)) {
    if (!memberIds.has(l.employee_id) || !l.lesson.trim()) continue;
    await tx`
      insert into knowledge (employee_id, category, title, content, source_task_id, created_by)
      values (${l.employee_id}, 'lesson', ${`「${taskTitle}」からの学び`.slice(0, 200)}, ${l.lesson.slice(0, 1000)}, ${wf.task_id}, 'employee')`;
  }
  await tx`update employees set experience_points = experience_points + 2 where id in ${tx([...memberIds])}`;

  const risks = (wf.plan as { review_risks?: string[] }).review_risks ?? [];
  if (latest) {
    await createApprovalTx(
      tx,
      {
        taskId: wf.task_id,
        requestedByEmployeeId: "president",
        actionType: "accept_deliverable",
        title: `成果物の確認：${latest.title}`,
        content: latest.content,
        reason: out.summary || "チームの成果物が完成しました",
        destination: "社内（成果物の受け取り）",
        estimatedCostJpy: 0,
        risks: risks.join("\n") || "特になし",
        afterEffect: "業務が「完了」になり、この版の成果物が確定します。外部への送信などは、別の承認依頼で確認します。",
        payload: { deliverableVersion: latest.version, format: latest.format },
      },
      "employee",
    );
  }
  type Proposed = { action_type: string; title: string; content: string; destination: string; reason: string; estimated_cost_jpy: number; risks: string; after_effect: string };
  const proposed = ((wf.plan as { proposed_actions?: Proposed[] }).proposed_actions ?? []).slice(0, 2);
  for (const a of proposed) {
    // 修正のたびに同じ承認依頼を重ねて出さない（同じ種類・件名で未判断のものがあれば出さない）
    const [dup] = await tx<{ id: string }[]>`
      select id from approvals where task_id = ${wf.task_id} and action_type = ${a.action_type} and title = ${a.title.trim().slice(0, 200)}
        and status in ('pending','on_hold') limit 1`;
    if (dup) continue;
    await createApprovalTx(
      tx,
      {
        taskId: wf.task_id,
        requestedByEmployeeId: wf.lead_id,
        actionType: a.action_type,
        title: a.title,
        content: a.content,
        reason: a.reason,
        destination: a.destination,
        estimatedCostJpy: Math.max(0, Number(a.estimated_cost_jpy) || 0),
        risks: a.risks,
        afterEffect: a.after_effect,
      },
      "employee",
    );
    await systemMessage(tx, wf.task_id, `外部への操作の承認依頼を提出しました：${a.title}（${APPROVAL_ACTION_LABEL[a.action_type as keyof typeof APPROVAL_ACTION_LABEL] ?? a.action_type}）`, "warn");
  }
  await updateWorkflow(tx, wf.task_id, { phase: "waiting_human", waiting_reason: "acceptance", resume_phase: null });
  await systemMessage(tx, wf.task_id, "成果物が完成しました。承認センターで内容を確認し、承認してください（差し戻すと、コメントが修正指示としてチームに伝わります）。", "warn");
  void roster;
}

// ===== 予算・失敗の扱い =====

async function handleBudgetBlock(sql: Sql, wf: Workflow, err: BudgetBlockedError): Promise<StepResult> {
  const taskScoped = ["task_calls", "task_budget", "prompt_too_long", "task_not_found"].includes(err.code);
  if (taskScoped) {
    await begin(sql, async (tx) => {
      await updateWorkflow(tx, wf.task_id, { phase: "waiting_human", waiting_reason: "budget", resume_phase: wf.phase });
      await systemMessage(
        tx,
        wf.task_id,
        `${err.message} チームの作業を一時停止しました。業務の予算を増やすか、指示を出すと再開します。`,
        "warn",
      );
    });
    return { status: "blocked", scope: "task", code: err.code, message: err.message };
  }
  // 会社全体の上限（今月・今日・緊急停止など）：同じお知らせを繰り返さない
  const [last] = await sql<{ content: string }[]>`
    select content from task_messages where task_id = ${wf.task_id} and author_type = 'system' order by id desc limit 1`;
  const text = `AIの呼び出しが止められているため、チームの作業を待機しています：${err.message}`;
  if (last?.content !== text) await systemMessage(sql, wf.task_id, text, "warn");
  return { status: "blocked", scope: "global", code: err.code, message: err.message };
}

async function handleFailure(sql: Sql, wf: Workflow, members: Member[], speaker: EmployeeWithStats, reason: string): Promise<StepResult> {
  const failures = wf.failures + 1;
  await begin(sql, async (tx) => {
    await updateWorkflow(tx, wf.task_id, { failures, last_step_at: new Date() });
    await systemMessage(tx, wf.task_id, `${speaker.name}の作業がうまくいきませんでした（${failures}回目）：${reason}`, "error");

    if (failures >= MAX_FAILURES) {
      await updateWorkflow(tx, wf.task_id, { phase: "stopped", resume_phase: wf.phase });
      await setTaskStatusSystem(tx, wf.task_id, "failed", { type: "system" }, "作業の失敗が続いたため");
      await addRoomMessage(tx, {
        taskId: wf.task_id,
        authorType: "employee",
        employeeId: "president",
        kind: "decision",
        content: "失敗が続いたため、いったんチームを止めます。業務画面の「再開」で、もう一度進められます。",
      });
      return;
    }
    if (failures < FAILURES_BEFORE_REASSIGN) return;

    // 同じ担当が続けて失敗した → 社長が担当を切り替える
    if (wf.phase === "discussion") {
      await updateWorkflow(tx, wf.task_id, { discussion_index: wf.discussion_index + 1, failures: 0 });
      await addRoomMessage(tx, {
        taskId: wf.task_id,
        authorType: "employee",
        employeeId: "president",
        kind: "decision",
        content: `${speaker.name}さんの発言は飛ばして、次に進めましょう。`,
      });
    } else if (wf.phase === "drafting" || wf.phase === "rework") {
      const alt = members.find((m) => m.role === "member" && m.employee_id !== wf.lead_id);
      if (alt && wf.lead_id) {
        await setMember(tx, wf.task_id, alt.employee_id, "lead");
        await setMember(tx, wf.task_id, wf.lead_id, "member");
        await updateWorkflow(tx, wf.task_id, { lead_id: alt.employee_id, failures: 0 });
        await tx`update tasks set assignee_id = ${alt.employee_id}, updated_at = now() where id = ${wf.task_id}`;
        await addTaskLog(tx, wf.task_id, { type: "employee", employeeId: "president" }, "assigned", `担当を ${speaker.name} から ${alt.name} に変更`);
        await addRoomMessage(tx, {
          taskId: wf.task_id,
          authorType: "employee",
          employeeId: "president",
          kind: "decision",
          content: `作業がうまく進まないため、リーダーを${speaker.name}さんから${alt.name}さんに交代します。`,
        });
      }
    } else if (wf.phase === "review" && wf.reviewer_id !== "president") {
      await updateWorkflow(tx, wf.task_id, { reviewer_id: "president", failures: 0 });
      await addRoomMessage(tx, {
        taskId: wf.task_id,
        authorType: "employee",
        employeeId: "president",
        kind: "decision",
        content: "監査は私（社長）が代わりに行います。",
      });
    }
  });
  return { status: "failed", phase: wf.phase, message: reason };
}

// ===== まとめて進める =====

export type RunSummary = { steps: number; results: StepResult[]; stoppedReason?: string };

/**
 * 進められる業務を、時間と回数の上限の中で少しずつ進めます（バックグラウンド・定期実行用）。
 */
export async function runWorkflows(
  sql: Sql,
  opts: { taskIds?: string[]; maxSteps?: number; deadlineMs?: number } = {},
): Promise<RunSummary> {
  const maxSteps = opts.maxSteps ?? 12;
  const deadline = Date.now() + (opts.deadlineMs ?? 200_000);
  const owner = `runner-${Math.random().toString(36).slice(2, 10)}`;
  const results: StepResult[] = [];
  let steps = 0;
  while (steps < maxSteps && Date.now() < deadline) {
    let ids = await listRunnableTaskIds(sql, 10);
    if (opts.taskIds) ids = ids.filter((id) => opts.taskIds!.includes(id));
    if (ids.length === 0) break;
    let progressed = false;
    for (const id of ids) {
      if (steps >= maxSteps || Date.now() >= deadline) break;
      const r = await runWorkflowStep(sql, id, owner);
      results.push(r);
      if (r.status === "busy" || r.status === "idle") continue;
      steps++;
      progressed = true;
      if (r.status === "blocked" && r.scope === "global") return { steps, results, stoppedReason: r.code };
    }
    if (!progressed) break;
  }
  return { steps, results };
}

export { getWorkflow };
