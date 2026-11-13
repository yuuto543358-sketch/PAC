import "server-only";
import type { Db } from "@/lib/db";

const MONTH_START = `date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'`;

export type UsageRow = {
  id: string;
  created_at: Date;
  employee_id: string | null;
  employee_name: string | null;
  task_id: string | null;
  task_title: string | null;
  purpose: string;
  model: string;
  status: "reserved" | "completed" | "failed" | "unknown";
  estimated_cost_jpy: number;
  cost_jpy: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
};

export async function listUsage(db: Db, limit = 50): Promise<UsageRow[]> {
  return db<UsageRow[]>`
    select u.id, u.created_at, u.employee_id, e.name as employee_name, u.task_id, t.title as task_title,
      u.purpose, u.model, u.status, u.estimated_cost_jpy, u.cost_jpy, u.input_tokens, u.output_tokens, u.error
    from api_usage u
    left join employees e on e.id = u.employee_id
    left join tasks t on t.id = u.task_id
    order by u.created_at desc limit ${limit}`;
}

export async function usageByEmployeeThisMonth(db: Db) {
  return db.unsafe<{ employee_id: string | null; name: string | null; avatar_color: string | null; jpy: number; calls: number }[]>(`
    select u.employee_id, e.name, e.avatar_color,
      sum(coalesce(u.cost_jpy, u.estimated_cost_jpy))::float8 as jpy, count(*)::int as calls
    from api_usage u left join employees e on e.id = u.employee_id
    where u.created_at >= ${MONTH_START}
    group by u.employee_id, e.name, e.avatar_color order by jpy desc`, [], { simple: false });
}

export async function usageByTaskThisMonth(db: Db) {
  return db.unsafe<{ task_id: string | null; title: string | null; jpy: number; calls: number }[]>(`
    select u.task_id, t.title, sum(coalesce(u.cost_jpy, u.estimated_cost_jpy))::float8 as jpy, count(*)::int as calls
    from api_usage u left join tasks t on t.id = u.task_id
    where u.created_at >= ${MONTH_START}
    group by u.task_id, t.title order by jpy desc limit 20`, [], { simple: false });
}

export async function dailyUsageThisMonth(db: Db) {
  return db.unsafe<{ day: string; jpy: number }[]>(`
    select to_char(created_at at time zone 'Asia/Tokyo', 'MM/DD') as day,
      sum(coalesce(cost_jpy, estimated_cost_jpy))::float8 as jpy
    from api_usage where created_at >= ${MONTH_START}
    group by 1 order by 1`, [], { simple: false });
}
