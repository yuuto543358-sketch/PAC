import "server-only";
import { begin, type Db, type Sql } from "@/lib/db";
import {
  ACTIVE_TASK_STATUSES,
  MANUAL_STATUS_TRANSITIONS,
  type Priority,
  type TaskSource,
  type TaskStatus,
  TASK_STATUS_LABEL,
} from "@/lib/constants";
import { findDuplicate, normalizeTitle } from "@/lib/dedupe";
import { getBudget } from "./settings";

export type Task = {
  id: string;
  title: string;
  description: string;
  source: TaskSource;
  status: TaskStatus;
  priority: Priority;
  assignee_id: string | null;
  assignee_name: string | null;
  department_id: string | null;
  department_name: string | null;
  created_by_employee_id: string | null;
  creator_name: string | null;
  due_date: string | null;
  budget_limit_jpy: number;
  ai_call_count: number;
  spent_jpy: number;
  deliverable: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

export type TaskLog = {
  id: number;
  actor_type: "user" | "employee" | "system";
  actor_employee_id: string | null;
  actor_name: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  message: string;
  created_at: Date;
};

export type Actor = { type: "user" } | { type: "employee"; employeeId: string } | { type: "system" };

function actorCols(actor: Actor) {
  return {
    actor_type: actor.type,
    actor_employee_id: actor.type === "employee" ? actor.employeeId : null,
  };
}

export async function addTaskLog(
  db: Db,
  taskId: string,
  actor: Actor,
  action: string,
  message: string,
  fromStatus: string | null = null,
  toStatus: string | null = null,
) {
  const a = actorCols(actor);
  await db`
    insert into task_logs (task_id, actor_type, actor_employee_id, action, from_status, to_status, message)
    values (${taskId}, ${a.actor_type}, ${a.actor_employee_id}, ${action}, ${fromStatus}, ${toStatus}, ${message})`;
}

const TASK_SELECT = `
  select t.*, e.name as assignee_name, e.department_id, d.name as department_name, c.name as creator_name,
    to_char(t.due_date, 'YYYY-MM-DD') as due_date,
    coalesce((select sum(coalesce(u.cost_jpy, u.estimated_cost_jpy)) from api_usage u where u.task_id = t.id), 0)::float8 as spent_jpy
  from tasks t
  left join employees e on e.id = t.assignee_id
  left join departments d on d.id = e.department_id
  left join employees c on c.id = t.created_by_employee_id`;

export type TaskFilter = {
  assignee?: string;
  department?: string;
  status?: string;
  priority?: string;
  createdFrom?: string;
  createdTo?: string;
  completedFrom?: string;
  completedTo?: string;
  view?: "active" | "closed" | "all";
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function listTasks(db: Db, f: TaskFilter = {}, limit = 200): Promise<Task[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const p = (v: string | number) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.assignee) where.push(`t.assignee_id = ${p(f.assignee)}`);
  if (f.department) where.push(`e.department_id = ${p(f.department)}`);
  if (f.status) where.push(`t.status = ${p(f.status)}`);
  if (f.priority) where.push(`t.priority = ${p(f.priority)}`);
  // 日付は日本時間で判定
  if (f.createdFrom && DATE_RE.test(f.createdFrom))
    where.push(`(t.created_at at time zone 'Asia/Tokyo')::date >= ${p(f.createdFrom)}::date`);
  if (f.createdTo && DATE_RE.test(f.createdTo))
    where.push(`(t.created_at at time zone 'Asia/Tokyo')::date <= ${p(f.createdTo)}::date`);
  if (f.completedFrom && DATE_RE.test(f.completedFrom))
    where.push(`(t.completed_at at time zone 'Asia/Tokyo')::date >= ${p(f.completedFrom)}::date`);
  if (f.completedTo && DATE_RE.test(f.completedTo))
    where.push(`(t.completed_at at time zone 'Asia/Tokyo')::date <= ${p(f.completedTo)}::date`);
  if (!f.status) {
    if (f.view === "active") where.push(`t.status not in ('completed','rejected','failed')`);
    if (f.view === "closed") where.push(`t.status in ('completed','rejected','failed')`);
  }
  const sqlText = `${TASK_SELECT}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by case t.priority when 'high' then 0 when 'medium' then 1 else 2 end, t.created_at desc
    limit ${Math.min(Math.max(limit, 1), 500)}`;
  return db.unsafe<Task[]>(sqlText, params);
}

export async function getTask(db: Db, id: string): Promise<Task | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.unsafe<Task[]>(`${TASK_SELECT} where t.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getTaskLogs(db: Db, id: string): Promise<TaskLog[]> {
  return db<TaskLog[]>`
    select l.*, e.name as actor_name from task_logs l left join employees e on e.id = l.actor_employee_id
    where l.task_id = ${id} order by l.id`;
}

export type CreateTaskInput = {
  title: string;
  description?: string;
  source: TaskSource;
  priority?: Priority;
  assigneeId?: string | null;
  dueDate?: string | null;
  budgetLimitJpy?: number | null;
  createdBy: Actor;
};

export type CreateTaskResult =
  | { created: true; task: { id: string; title: string } }
  | { created: false; duplicateOf: { id: string; title: string; status: TaskStatus } };

/**
 * 業務を登録します。終わっていない業務に似たものがあれば、登録せず既存の業務を返します（重複防止）。
 */
export async function createTask(sql: Sql, input: CreateTaskInput): Promise<CreateTaskResult> {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new Error("業務名を入力してください");
  return begin(sql, async (tx) => {
    // 同時に同じ業務が登録されないようロック
    await tx`select pg_advisory_xact_lock(hashtext('pac_task_create'))`;
    const open = await tx<{ id: string; title: string; status: TaskStatus }[]>`
      select id, title, status from tasks where status in ${tx(ACTIVE_TASK_STATUSES.concat(["on_hold"]))}`;
    const dup = findDuplicate(title, open);
    if (dup) return { created: false as const, duplicateOf: dup };

    const budget = await getBudget(tx);
    const limit =
      input.budgetLimitJpy != null && input.budgetLimitJpy >= 0 ? input.budgetLimitJpy : budget.per_task_limit_jpy;
    const dueDate = input.dueDate && DATE_RE.test(input.dueDate) ? input.dueDate : null;
    const [row] = await tx<{ id: string; title: string }[]>`
      insert into tasks (title, description, source, priority, assignee_id, created_by_employee_id, due_date,
        budget_limit_jpy, dedupe_key)
      values (${title}, ${(input.description ?? "").slice(0, 5000)}, ${input.source}, ${input.priority ?? "medium"},
        ${input.assigneeId ?? null}, ${input.createdBy.type === "employee" ? input.createdBy.employeeId : null},
        ${dueDate}, ${limit}, ${normalizeTitle(title)})
      returning id, title`;
    await addTaskLog(tx, row.id, input.createdBy, "created", `業務「${title}」を登録しました`, null, "discovered");
    if (input.assigneeId) {
      const [emp] = await tx<{ name: string }[]>`select name from employees where id = ${input.assigneeId}`;
      if (emp) await addTaskLog(tx, row.id, input.createdBy, "assigned", `担当: ${emp.name}`);
    }
    return { created: true as const, task: row };
  });
}

/** 手動でのステータス変更。決められた順序以外の変更は拒否します。 */
export async function changeTaskStatus(sql: Sql, taskId: string, to: TaskStatus, actor: Actor, note = "") {
  await begin(sql, async (tx) => {
    const [t] = await tx<{ status: TaskStatus }[]>`select status from tasks where id = ${taskId} for update`;
    if (!t) throw new Error("業務が見つかりません");
    if (!MANUAL_STATUS_TRANSITIONS[t.status].includes(to)) {
      throw new Error(`「${TASK_STATUS_LABEL[t.status]}」から「${TASK_STATUS_LABEL[to]}」へは変更できません`);
    }
    await tx`
      update tasks set status = ${to}, updated_at = now(),
        completed_at = ${to === "completed" ? tx`now()` : tx`completed_at`}
      where id = ${taskId}`;
    await addTaskLog(
      tx,
      taskId,
      actor,
      "status_changed",
      `${TASK_STATUS_LABEL[t.status]} → ${TASK_STATUS_LABEL[to]}${note ? `（${note}）` : ""}`,
      t.status,
      to,
    );
  });
}

export type UpdateTaskInput = {
  priority?: Priority;
  assigneeId?: string | null;
  dueDate?: string | null;
  deliverable?: string;
  budgetLimitJpy?: number;
};

export async function updateTask(sql: Sql, taskId: string, input: UpdateTaskInput, actor: Actor) {
  await begin(sql, async (tx) => {
    const [t] = await tx<{ priority: string; assignee_id: string | null; due_date: string | null; deliverable: string; budget_limit_jpy: number }[]>`
      select priority, assignee_id, to_char(due_date, 'YYYY-MM-DD') as due_date, deliverable, budget_limit_jpy
      from tasks where id = ${taskId} for update`;
    if (!t) throw new Error("業務が見つかりません");
    const changes: string[] = [];
    if (input.priority && input.priority !== t.priority) {
      await tx`update tasks set priority = ${input.priority} where id = ${taskId}`;
      changes.push(`優先度を変更`);
    }
    if (input.assigneeId !== undefined && input.assigneeId !== t.assignee_id) {
      await tx`update tasks set assignee_id = ${input.assigneeId} where id = ${taskId}`;
      const [emp] = input.assigneeId
        ? await tx<{ name: string }[]>`select name from employees where id = ${input.assigneeId}`
        : [];
      await addTaskLog(tx, taskId, actor, "assigned", `担当: ${emp?.name ?? "なし"}`);
    }
    if (input.dueDate !== undefined) {
      const d = input.dueDate && DATE_RE.test(input.dueDate) ? input.dueDate : null;
      if (d !== t.due_date) {
        await tx`update tasks set due_date = ${d} where id = ${taskId}`;
        changes.push(`期限を ${d ?? "なし"} に変更`);
      }
    }
    if (input.budgetLimitJpy !== undefined && input.budgetLimitJpy !== t.budget_limit_jpy) {
      if (!(input.budgetLimitJpy >= 0 && input.budgetLimitJpy <= 10000)) throw new Error("予算は0〜10000円で指定してください");
      await tx`update tasks set budget_limit_jpy = ${input.budgetLimitJpy} where id = ${taskId}`;
      changes.push(`業務予算を ${input.budgetLimitJpy}円 に変更`);
    }
    if (input.deliverable !== undefined && input.deliverable !== t.deliverable) {
      await tx`update tasks set deliverable = ${input.deliverable.slice(0, 20000)} where id = ${taskId}`;
      await addTaskLog(tx, taskId, actor, "deliverable_updated", "成果物を更新しました");
    }
    if (changes.length) await addTaskLog(tx, taskId, actor, "updated", changes.join(" / "));
    await tx`update tasks set updated_at = now() where id = ${taskId}`;
  });
}

export async function countTasks(db: Db) {
  const [row] = await db<{ active: number; completed_month: number; completed_total: number }[]>`
    select
      count(*) filter (where status not in ('completed','rejected','failed','on_hold'))::int as active,
      count(*) filter (where status = 'completed'
        and completed_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')::int as completed_month,
      count(*) filter (where status = 'completed')::int as completed_total
    from tasks`;
  return row;
}
