import Link from "next/link";
import { getDb } from "@/lib/db";
import { listEmployees } from "@/lib/repo/employees";
import { EMPLOYEE_STATUS_LABEL } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Page, PageHeader } from "@/components/ui";

export const metadata = { title: "社員一覧" };

export default async function EmployeesPage() {
  const sql = await getDb();
  const employees = await listEmployees(sql);
  return (
    <>
      <PageHeader title="社員" subtitle={`${employees.length}名が在籍しています`} />
      <Page>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {employees.map((e) => (
            <li key={e.id}>
              <Link href={`/employees/${e.id}`} className="card press relative block overflow-hidden p-4">
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: e.avatar_color }} aria-hidden />
                <div className="flex items-center gap-3.5">
                  <Avatar color={e.avatar_color} styleId={e.avatar_style} size={60} status={e.status} label={e.name} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold" style={{ color: e.avatar_color }}>
                      {e.role_title}・{e.department_name}
                    </div>
                    <div className="text-[19px] leading-tight font-bold tracking-tight">{e.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
                      <span className="inline-flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${e.status === "working" ? "bg-success" : "bg-faint"}`} />
                        {EMPLOYEE_STATUS_LABEL[e.status]}
                      </span>
                      <span>担当中 {e.active_tasks}件</span>
                      <span>最近の活動 {relativeTime(e.last_activity_at)}</span>
                    </div>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden>
                    <Icon name="chat" size={18} stroke={2} />
                  </span>
                </div>
                <p className="mt-3 line-clamp-2 text-[14px] leading-relaxed text-ink/80">{e.personality}</p>
                {e.expertise.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {e.expertise.slice(0, 3).map((x) => (
                      <span key={x} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                        {x}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Page>
    </>
  );
}
