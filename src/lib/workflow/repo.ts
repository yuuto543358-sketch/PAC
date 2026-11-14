import "server-only";
import type postgres from "postgres";
import type { Db, Sql } from "@/lib/db";
import { ACTIVE_WORKFLOW_PHASES, TASK_STATUS_LABEL, type TaskStatus, type WorkflowPhase } from "@/lib/constants";
import { addTaskLog, type Actor } from "@/lib/repo/tasks";

type JSONValue = postgres.JSONValue;

export type WorkflowPlan = {
  goal?: string;
  steps?: string[];
  output_format?: string;
  deliverable_title?: string;
  done_criteria?: string;
};

export type Workflow = {
  task_id: string;
  phase: WorkflowPhase;
  resume_phase: WorkflowPhase | null;
  waiting_reason: string;
  autopilot: boolean;
  plan: WorkflowPlan;
  lead_id: string | null;
  reviewer_id: string | null;
  discussion_index: number;
  rework_count: number;
  steps: number;
  failures: number;
  lease_until: Date | null;
  lease_owner: string | null;
  last_step_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type Member = {
  task_id: string;
  employee_id: string;
  role: "lead" | "member" | "reviewer" | "ceo";
  name: string;
  role_title: string;
  role_key: string;
  avatar_color: string;
  avatar_style: string;
};

export type RoomMessage = {
  id: number;
  task_id: string;
  author_type: "employee" | "owner" | "system";
  employee_id: string | null;
  employee_name: string | null;
  role_title: string | null;
  avatar_color: string | null;
  avatar_style: string | null;
  kind: string;
  content: string;
  meta: {
    deliverableVersion?: number;
    costJpy?: number;
    verdict?: string;
    href?: string;
    tone?: string;
    /** Web検索で参照したページ */
    sources?: { url: string; title: string }[];
  };
  created_at: Date;
};

export type Deliverable = {
  id: string;
  task_id: string;
  version: number;
  title: string;
  format: string;
  content: string;
  author_employee_id: string | null;
  author_name: string | null;
  status: string;
  review_note: string;
  created_at: Date;
};

/** 業務の自動進行を始められる状態にする（チームの部屋を作る） */
export async function initWorkflow(db: Db, taskId: string, autopilot = true) {
  await db`
    insert into task_workflows (task_id, autopilot) values (${taskId}, ${autopilot})
    on conflict (task_id) do nothing`;
  await db`
    insert into task_members (task_id, employee_id, role) values (${taskId}, 'president', 'ceo')
    on conflict do nothing`;
}

export async function getWorkflow(db: Db, taskId: string): Promise<Workflow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return null;
  const [row] = await db<Workflow[]>`select * from task_workflows where task_id = ${taskId}`;
  return row ?? null;
}

export async function updateWorkflow(db: Db, taskId: string, fields: Partial<Omit<Workflow, "task_id" | "created_at">>) {
  const allowed = [
    "phase",
    "resume_phase",
    "waiting_reason",
    "autopilot",
    "plan",
    "lead_id",
    "reviewer_id",
    "discussion_index",
    "rework_count",
    "steps",
    "failures",
    "last_step_at",
  ] as const;
  const data: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in fields) data[k] = k === "plan" ? db.json((fields.plan ?? {}) as JSONValue) : (fields as Record<string, unknown>)[k];
  }
  if (Object.keys(data).length === 0) return;
  await db`update task_workflows set ${db(data as Record<string, never>)}, updated_at = now() where task_id = ${taskId}`;
}

export async function listMembers(db: Db, taskId: string): Promise<Member[]> {
  return db<Member[]>`
    select m.task_id, m.employee_id, m.role, e.name, e.role_title, e.role_key, e.avatar_color, e.avatar_style
    from task_members m join employees e on e.id = m.employee_id
    where m.task_id = ${taskId}
    order by case m.role when 'ceo' then 0 when 'lead' then 1 when 'member' then 2 else 3 end, e.sort_order`;
}

export async function setMember(db: Db, taskId: string, employeeId: string, role: Member["role"]) {
  await db`
    insert into task_members (task_id, employee_id, role) values (${taskId}, ${employeeId}, ${role})
    on conflict (task_id, employee_id) do update set role = excluded.role`;
}

export async function listRoomMessages(db: Db, taskId: string, limit = 200): Promise<RoomMessage[]> {
  return db<RoomMessage[]>`
    select * from (
      select m.*, e.name as employee_name, e.role_title, e.avatar_color, e.avatar_style
      from task_messages m left join employees e on e.id = m.employee_id
      where m.task_id = ${taskId} order by m.id desc limit ${limit}
    ) x order by id`;
}

export async function addRoomMessage(
  db: Db,
  msg: {
    taskId: string;
    authorType: RoomMessage["author_type"];
    employeeId?: string | null;
    kind: string;
    content: string;
    meta?: RoomMessage["meta"];
    apiUsageId?: string | null;
  },
) {
  await db`
    insert into task_messages (task_id, author_type, employee_id, kind, content, meta, api_usage_id)
    values (${msg.taskId}, ${msg.authorType}, ${msg.employeeId ?? null}, ${msg.kind}, ${msg.content.slice(0, 20000)},
      ${db.json((msg.meta ?? {}) as JSONValue)}, ${msg.apiUsageId ?? null})`;
}

export async function listDeliverables(db: Db, taskId: string): Promise<Deliverable[]> {
  return db<Deliverable[]>`
    select d.*, e.name as author_name from deliverables d left join employees e on e.id = d.author_employee_id
    where d.task_id = ${taskId} order by d.version desc`;
}

export async function getDeliverable(db: Db, taskId: string, version?: number): Promise<Deliverable | null> {
  const rows = version
    ? await db<Deliverable[]>`
        select d.*, e.name as author_name from deliverables d left join employees e on e.id = d.author_employee_id
        where d.task_id = ${taskId} and d.version = ${version}`
    : await db<Deliverable[]>`
        select d.*, e.name as author_name from deliverables d left join employees e on e.id = d.author_employee_id
        where d.task_id = ${taskId} order by d.version desc limit 1`;
  return rows[0] ?? null;
}

export async function addDeliverable(
  db: Db,
  d: { taskId: string; title: string; format: string; content: string; authorEmployeeId: string | null },
): Promise<number> {
  const [row] = await db<{ version: number }[]>`
    insert into deliverables (task_id, version, title, format, content, author_employee_id, status)
    values (${d.taskId},
      (select coalesce(max(version), 0) + 1 from deliverables where task_id = ${d.taskId}),
      ${d.title.slice(0, 200)}, ${d.format}, ${d.content.slice(0, 60000)}, ${d.authorEmployeeId}, 'in_review')
    returning version`;
  return row.version;
}

export async function setDeliverableStatus(db: Db, taskId: string, version: number, status: string, note = "") {
  await db`
    update deliverables set status = ${status}, review_note = ${note.slice(0, 4000)}
    where task_id = ${taskId} and version = ${version}`;
}

/** システム（自動進行）による業務ステータスの変更。履歴に残す。 */
export async function setTaskStatusSystem(db: Db, taskId: string, to: TaskStatus, actor: Actor, note = "") {
  const [t] = await db<{ status: TaskStatus }[]>`select status from tasks where id = ${taskId}`;
  if (!t || t.status === to) return;
  await db`
    update tasks set status = ${to}, updated_at = now(),
      completed_at = ${to === "completed" ? db`now()` : t.status === "completed" ? db`null` : db`completed_at`}
    where id = ${taskId}`;
  await addTaskLog(
    db,
    taskId,
    actor,
    "status_changed",
    `${TASK_STATUS_LABEL[t.status]} → ${TASK_STATUS_LABEL[to]}${note ? `（${note}）` : ""}`,
    t.status,
    to,
  );
}

// ===== 同時実行の防止（1つの業務を同時に2か所で進めない） =====

export async function acquireLease(sql: Sql, taskId: string, owner: string, seconds = 150): Promise<Workflow | null> {
  const [row] = await sql<Workflow[]>`
    update task_workflows set lease_until = now() + make_interval(secs => ${seconds}), lease_owner = ${owner}
    where task_id = ${taskId} and (lease_until is null or lease_until < now())
    returning *`;
  return row ?? null;
}

export async function releaseLease(sql: Sql, taskId: string, owner: string) {
  await sql`update task_workflows set lease_until = null, lease_owner = null where task_id = ${taskId} and lease_owner = ${owner}`;
}

/** 自動で進められる業務（一時停止・保留・完了などを除く） */
export async function listRunnableTaskIds(sql: Sql, limit = 10): Promise<string[]> {
  const rows = await sql<{ task_id: string }[]>`
    select w.task_id from task_workflows w join tasks t on t.id = w.task_id
    where w.autopilot and w.phase in ${sql(ACTIVE_WORKFLOW_PHASES)}
      and t.status not in ('on_hold','rejected','failed','completed')
      and (w.lease_until is null or w.lease_until < now())
    order by w.last_step_at nulls first, w.created_at
    limit ${limit}`;
  return rows.map((r) => r.task_id);
}

export type ActiveTeam = {
  task_id: string;
  title: string;
  phase: WorkflowPhase;
  autopilot: boolean;
  waiting_reason: string;
  last_step_at: Date | null;
  members: { employee_id: string; name: string; avatar_color: string; avatar_style: string; role: string }[];
};

/** 進行中のチーム（ホーム画面用） */
export async function listActiveTeams(db: Db, limit = 5): Promise<ActiveTeam[]> {
  return db<ActiveTeam[]>`
    select w.task_id, t.title, w.phase, w.autopilot, w.waiting_reason, w.last_step_at,
      coalesce((
        select json_agg(json_build_object('employee_id', e.id, 'name', e.name, 'avatar_color', e.avatar_color,
          'avatar_style', e.avatar_style, 'role', m.role) order by case m.role when 'lead' then 0 when 'member' then 1 when 'reviewer' then 2 else 3 end)
        from task_members m join employees e on e.id = m.employee_id where m.task_id = w.task_id and m.role <> 'ceo'
      ), '[]'::json) as members
    from task_workflows w join tasks t on t.id = w.task_id
    where w.phase not in ('done') and t.status not in ('completed','rejected')
    order by coalesce(w.last_step_at, w.created_at) desc
    limit ${limit}`;
}
