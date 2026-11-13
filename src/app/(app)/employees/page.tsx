import Link from "next/link";
import { getDb } from "@/lib/db";
import { listEmployees } from "@/lib/repo/employees";
import { EMPLOYEE_STATUS_LABEL } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { ChevronRight, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "社員一覧" };

export default async function EmployeesPage() {
  const sql = await getDb();
  const employees = await listEmployees(sql);
  return (
    <>
      <PageHeader title="社員一覧" subtitle={`${employees.length}名が在籍しています`} />
      <Page>
        <ul className="space-y-2.5">
          {employees.map((e) => (
            <li key={e.id}>
              <Link href={`/employees/${e.id}`} className="card block p-4 active:opacity-70">
                <div className="flex items-center gap-3">
                  <Avatar color={e.avatar_color} styleId={e.avatar_style} size={56} status={e.status} label={e.name} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold" style={{ color: e.avatar_color }}>
                      {e.role_title}・{e.department_name}
                    </div>
                    <div className="text-[17px] font-bold">{e.name}</div>
                    <div className="text-xs text-muted">
                      {EMPLOYEE_STATUS_LABEL[e.status]} ／ 担当中 {e.active_tasks}件 ／ 最近の活動 {relativeTime(e.last_activity_at)}
                    </div>
                  </div>
                  <ChevronRight />
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-ink/85">{e.personality}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Page>
    </>
  );
}
