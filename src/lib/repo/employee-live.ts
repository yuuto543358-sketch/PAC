import "server-only";
import type { Db } from "@/lib/db";
import { listEmployees } from "./employees";
import { JOB_KIND_LABEL, listJobs } from "@/lib/mediaco/repo";
import { relativeTime } from "@/lib/format";
import type { EmployeeStatus } from "@/lib/avatar-videos";

// 社員の「いまの状態」（待機中・考え中・作業中）と、いまやっている仕事のひとこと。
// 画面を開いたままでも状態が切り替わるよう、画面から数秒ごとに読みにいく（/api/employees/status）。

export type EmployeeLiveState = {
  id: string;
  status: EmployeeStatus;
  /** 担当している業務の数（社員一覧に出す） */
  activeTasks: number;
  /** いまやっている仕事（なければ null） */
  running: string | null;
  /** いまの仕事・最後の仕事（ホームに出す。なければ null） */
  activity: string | null;
};

export async function employeeLiveStates(db: Db): Promise<EmployeeLiveState[]> {
  const [employees, jobs] = await Promise.all([listEmployees(db), listJobs(db, 8)]);
  const running = new Map(jobs.filter((j) => j.status === "running").map((j) => [j.employee_id, j]));
  const last = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) if (j.employee_id && !last.has(j.employee_id)) last.set(j.employee_id, j);
  return employees.map((e) => {
    const r = running.get(e.id);
    const l = last.get(e.id);
    return {
      id: e.id,
      status: e.status,
      activeTasks: e.active_tasks,
      running: r ? (JOB_KIND_LABEL[r.kind] ?? r.kind) : null,
      activity: r ? (JOB_KIND_LABEL[r.kind] ?? r.kind) : l ? `最後：${JOB_KIND_LABEL[l.kind] ?? l.kind}（${relativeTime(l.started_at)}）` : null,
    };
  });
}
