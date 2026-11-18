import "server-only";
import type { Db } from "@/lib/db";
import { activityStatusFor } from "@/lib/employee-status";

// 自動の仕事の記録（実行状態・開始時刻・終了時刻・エラー）。
// dedupe_key があるときは、同じ仕事を二重に記録・実行しない（すでにあれば null を返す）。

export const DEPARTMENT_OF: Record<string, { department: string; employeeId: string }> = {
  research: { department: "市場調査部", employeeId: "research" },
  bizdev: { department: "事業開発部", employeeId: "bizdev" },
  editorial: { department: "編集制作部", employeeId: "creative" },
  marketing: { department: "マーケティング部", employeeId: "secretary" },
  analytics: { department: "経営分析部", employeeId: "life" },
  audit: { department: "監査・品質管理部", employeeId: "finance" },
  ceo: { department: "CEO室", employeeId: "president" },
};

export type JobRef = { id: string };

export async function startJob(
  db: Db,
  j: { kind: string; dept: keyof typeof DEPARTMENT_OF; dedupeKey?: string | null; refType?: string; refId?: string },
): Promise<JobRef | null> {
  const d = DEPARTMENT_OF[j.dept];
  const rows = await db<{ id: string }[]>`
    insert into media_jobs (kind, dedupe_key, department, employee_id, status, ref_type, ref_id)
    values (${j.kind}, ${j.dedupeKey ?? null}, ${d.department}, ${d.employeeId}, 'running', ${j.refType ?? ""}, ${j.refId ?? ""})
    on conflict (dedupe_key) do nothing
    returning id`;
  if (!rows[0]) return null;
  // 調べる・考える仕事は「考え中」、形にする仕事は「作業中」（アイコンの動画が切り替わる）
  await db`update employees set status = ${activityStatusFor(j.kind)} where id = ${d.employeeId}`;
  return rows[0];
}

export async function finishJob(
  db: Db,
  job: JobRef,
  r: { status: "done" | "failed" | "skipped"; summary?: string; error?: string; costJpy?: number },
) {
  const [row] = await db<{ employee_id: string | null }[]>`
    update media_jobs set status = ${r.status}, summary = ${(r.summary ?? "").slice(0, 500)}, error = ${(r.error ?? "").slice(0, 1000)},
      cost_jpy = ${r.costJpy ?? 0}, finished_at = now()
    where id = ${job.id}
    returning employee_id`;
  if (row?.employee_id) {
    await db`update employees set status = 'idle' where id = ${row.employee_id}
      and not exists (select 1 from media_jobs where employee_id = ${row.employee_id} and status = 'running')`;
  }
}

/** 途中で止まったまま（6分以上）の記録を「失敗」にする（次の実行に影響させない）。止まっていた記事のIDを返す */
export const STALE_JOB_MESSAGE = "途中で止まりました（サーバーの時間切れなど）。次の実行でやり直します";
export async function cleanupStaleJobs(db: Db): Promise<string[]> {
  const rows = await db<{ ref_type: string; ref_id: string; employee_id: string | null }[]>`
    update media_jobs set status = 'failed', error = ${STALE_JOB_MESSAGE}, finished_at = now()
    where status = 'running' and started_at < now() - interval '6 minutes'
    returning ref_type, ref_id, employee_id`;
  for (const r of rows) {
    if (r.employee_id) await db`update employees set status = 'idle' where id = ${r.employee_id}`;
  }
  return rows.filter((r) => r.ref_type === "article").map((r) => r.ref_id);
}
