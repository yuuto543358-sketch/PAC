import "server-only";
import type postgres from "postgres";
import { begin, type Db, type Sql } from "@/lib/db";
import { BUSINESS_STATUSES, BUSINESS_STATUS_LABEL, type BusinessStatus } from "@/lib/constants";
import { audit } from "./audit";

type JSONValue = postgres.JSONValue;

export type BusinessProject = {
  id: string;
  name: string;
  summary: string;
  target_customer: string;
  customer_problem: string;
  competitors: string;
  price_jpy: number | null;
  initial_cost_jpy: number | null;
  running_cost_jpy: number | null;
  monetization: string;
  difficulty: string;
  risks: string;
  validation_method: string;
  status: BusinessStatus;
  owner_employee_id: string | null;
  discovered_by: string | null;
  discovered_by_name: string | null;
  validation_task_id: string | null;
  validation_task_title: string | null;
  validation_task_status: string | null;
  sources: { url: string; title: string }[];
  owner_note: string;
  stage: import("@/lib/constants").BusinessStage;
  auto_advance: boolean;
  stage_task_id: string | null;
  stage_task_title: string | null;
  stage_task_status: string | null;
  launch_approval_id: string | null;
  launch_approval_status: string | null;
  platform: string;
  listing_url: string;
  launched_at: Date | null;
  last_improve_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const SELECT = `
  select b.*, e.name as discovered_by_name, t.title as validation_task_title, t.status as validation_task_status,
    st.title as stage_task_title, st.status as stage_task_status, ap.status as launch_approval_status
  from business_projects b
  left join employees e on e.id = b.discovered_by
  left join tasks t on t.id = b.validation_task_id
  left join tasks st on st.id = b.stage_task_id
  left join approvals ap on ap.id = b.launch_approval_id`;

export async function listBusinessProjects(
  db: Db,
  opts: { status?: string; limit?: number } = {},
): Promise<BusinessProject[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  if (opts.status && (BUSINESS_STATUSES as readonly string[]).includes(opts.status)) {
    return db.unsafe<BusinessProject[]>(`${SELECT} where b.status = $1 order by b.created_at desc limit ${limit}`, [opts.status]);
  }
  return db.unsafe<BusinessProject[]>(`${SELECT} order by b.created_at desc limit ${limit}`, [], { simple: false });
}

export async function getBusinessProject(db: Db, id: string): Promise<BusinessProject | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.unsafe<BusinessProject[]>(`${SELECT} where b.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function countBusinessByStatus(db: Db): Promise<Record<string, number>> {
  const rows = await db<{ status: string; n: number }[]>`
    select status, count(*)::int as n from business_projects group by status`;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/** 重複チェックのため、これまでの事業候補の名前を取得（却下したものも含む） */
export async function listBusinessNames(db: Db): Promise<{ id: string; title: string; status: string }[]> {
  return db<{ id: string; title: string; status: string }[]>`
    select id, name as title, status from business_projects order by created_at desc limit 300`;
}

export type NewBusinessProject = {
  name: string;
  summary: string;
  target_customer: string;
  customer_problem: string;
  competitors: string;
  price_jpy: number | null;
  initial_cost_jpy: number | null;
  running_cost_jpy: number | null;
  monetization: string;
  difficulty: string;
  risks: string;
  validation_method: string;
  sources: { url: string; title: string }[];
  discoveredBy: string;
};

const money = (v: number | null) => (v === null || !Number.isFinite(v) || v < 0 ? null : Math.min(Math.round(v), 9_999_999_999));

export async function insertBusinessProject(db: Db, p: NewBusinessProject): Promise<{ id: string; name: string }> {
  const [row] = await db<{ id: string; name: string }[]>`
    insert into business_projects (name, summary, target_customer, customer_problem, competitors, price_jpy,
      initial_cost_jpy, running_cost_jpy, monetization, difficulty, risks, validation_method, status,
      owner_employee_id, discovered_by, sources)
    values (${p.name.trim().slice(0, 120)}, ${p.summary.slice(0, 2000)}, ${p.target_customer.slice(0, 1000)},
      ${p.customer_problem.slice(0, 1000)}, ${p.competitors.slice(0, 1500)}, ${money(p.price_jpy)},
      ${money(p.initial_cost_jpy)}, ${money(p.running_cost_jpy)}, ${p.monetization.slice(0, 1000)},
      ${p.difficulty.slice(0, 200)}, ${p.risks.slice(0, 1500)}, ${p.validation_method.slice(0, 1500)}, 'idea',
      ${p.discoveredBy}, ${p.discoveredBy}, ${db.json(p.sources.slice(0, 12) as unknown as JSONValue)})
    returning id, name`;
  return row;
}

export async function linkValidationTask(db: Db, id: string, taskId: string) {
  await db`
    update business_projects set validation_task_id = ${taskId}, status = 'validating',
      stage = case when stage = 'idea' then 'research' else stage end, updated_at = now()
    where id = ${id}`;
}

/** 経営者が事業候補の状態を変える（理由・メモつき）。操作履歴に残します。 */
export async function setBusinessStatus(sql: Sql, id: string, status: BusinessStatus, note: string) {
  if (!(BUSINESS_STATUSES as readonly string[]).includes(status)) throw new Error("状態の指定が正しくありません");
  await begin(sql, async (tx) => {
    const [b] = await tx<{ status: string; name: string }[]>`
      select status, name from business_projects where id = ${id} for update`;
    if (!b) throw new Error("事業候補が見つかりません");
    const trimmed = note.trim().slice(0, 1000);
    await tx`
      update business_projects set status = ${status},
        owner_note = ${trimmed || tx`owner_note`}, updated_at = now()
      where id = ${id}`;
    await audit(tx, "owner", "business_status_changed", "business_project", id, {
      name: b.name,
      from: b.status,
      to: status,
      label: BUSINESS_STATUS_LABEL[status],
      note: trimmed,
    });
  });
}
