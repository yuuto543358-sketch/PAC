import "server-only";
import type { Db } from "@/lib/db";

export type Employee = {
  id: string;
  role_key: string;
  name: string;
  name_kana: string;
  role_title: string;
  department_id: string;
  department_name: string;
  personality: string;
  speaking_style: string;
  expertise: string[];
  strengths: string[];
  weaknesses: string[];
  judgment_criteria: string;
  avatar_color: string;
  avatar_style: string;
  status: "idle" | "working" | "offline";
  experience_points: number;
  is_active: boolean;
  sort_order: number;
};

export type EmployeeWithStats = Employee & {
  active_tasks: number;
  completed_tasks: number;
  avg_rating: number | null;
  rating_count: number;
  last_activity_at: Date | null;
};

export async function listEmployees(db: Db): Promise<EmployeeWithStats[]> {
  return db<EmployeeWithStats[]>`
    select e.*, d.name as department_name,
      (select count(*) from tasks t where t.assignee_id = e.id
         and t.status in ('discovered','researching','analyzing','producing','ready','awaiting_approval','approved','executing'))::int as active_tasks,
      (select count(*) from tasks t where t.assignee_id = e.id and t.status = 'completed')::int as completed_tasks,
      (select avg(r.rating)::float8 from employee_ratings r where r.employee_id = e.id) as avg_rating,
      (select count(*) from employee_ratings r where r.employee_id = e.id)::int as rating_count,
      greatest(
        (select max(l.created_at) from task_logs l where l.actor_employee_id = e.id),
        (select max(c.updated_at) from conversations c where c.employee_id = e.id)
      ) as last_activity_at
    from employees e join departments d on d.id = e.department_id
    where e.is_active
    order by e.sort_order, e.id`;
}

export async function getEmployee(db: Db, id: string): Promise<EmployeeWithStats | null> {
  const rows = await listEmployees(db);
  return rows.find((e) => e.id === id) ?? null;
}

export type Rating = { id: number; rating: number; comment: string; created_at: Date; task_id: string | null };

export async function listRatings(db: Db, employeeId: string): Promise<Rating[]> {
  return db<Rating[]>`
    select id, rating, comment, created_at, task_id from employee_ratings
    where employee_id = ${employeeId} order by created_at desc limit 20`;
}

export type Department = { id: string; name: string; description: string };
export async function listDepartments(db: Db): Promise<Department[]> {
  return db<Department[]>`select id, name, description from departments order by sort_order`;
}
