import Link from "next/link";
import { getDb } from "@/lib/db";
import { listTasks, type TaskFilter } from "@/lib/repo/tasks";
import { listDepartments, listEmployees } from "@/lib/repo/employees";
import { PRIORITIES, PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from "@/lib/constants";
import { dateTime, yen } from "@/lib/format";
import { ChevronRight, Empty, Fab, Page, PageHeader, PriorityBadge, SegmentedLinks, TaskStatusBadge } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";

export const metadata = { title: "業務管理" };

type SP = Record<string, string | undefined>;

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = sp.view === "closed" || sp.view === "all" ? sp.view : "active";
  const filter: TaskFilter = {
    view,
    assignee: sp.assignee || undefined,
    department: sp.department || undefined,
    status: sp.status && (TASK_STATUSES as readonly string[]).includes(sp.status) ? sp.status : undefined,
    priority: sp.priority && (PRIORITIES as readonly string[]).includes(sp.priority) ? sp.priority : undefined,
    createdFrom: sp.cfrom || undefined,
    createdTo: sp.cto || undefined,
    completedFrom: sp.dfrom || undefined,
    completedTo: sp.dto || undefined,
  };
  const sql = await getDb();
  const [tasks, employees, departments] = await Promise.all([listTasks(sql, filter), listEmployees(sql), listDepartments(sql)]);
  const filtered = Boolean(filter.assignee || filter.department || filter.status || filter.priority || sp.cfrom || sp.cto || sp.dfrom || sp.dto);

  return (
    <>
      <PageHeader
        title="業務管理"
        subtitle={`${tasks.length}件を表示中`}
      />
      <Page>
        <SegmentedLinks
          active={view}
          items={[
            { key: "active", label: "進行中", href: "/tasks?view=active" },
            { key: "closed", label: "終了", href: "/tasks?view=closed" },
            { key: "all", label: "すべて", href: "/tasks?view=all" },
          ]}
        />

        <details className="card overflow-hidden" open={filtered}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[15px] font-semibold">
            <Icon name="filter" size={18} stroke={2} className="text-muted" />
            絞り込み
            {filtered && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] text-brand">適用中</span>}
            <Icon name="chevronRight" size={16} stroke={2.4} className="ml-auto text-faint" />
          </summary>
          <form className="grid grid-cols-2 gap-3 border-t border-separator p-4" method="get">
            <input type="hidden" name="view" value={view} />
            <label className="col-span-1">
              <span className="label">担当社員</span>
              <select name="assignee" defaultValue={filter.assignee ?? ""} className="field">
                <option value="">すべて</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-1">
              <span className="label">部署</span>
              <select name="department" defaultValue={filter.department ?? ""} className="field">
                <option value="">すべて</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">ステータス</span>
              <select name="status" defaultValue={filter.status ?? ""} className="field">
                <option value="">すべて</option>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">優先順位</span>
              <select name="priority" defaultValue={filter.priority ?? ""} className="field">
                <option value="">すべて</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">発生日（から）</span>
              <input type="date" name="cfrom" defaultValue={sp.cfrom} className="field" />
            </label>
            <label>
              <span className="label">発生日（まで）</span>
              <input type="date" name="cto" defaultValue={sp.cto} className="field" />
            </label>
            <label>
              <span className="label">完了日（から）</span>
              <input type="date" name="dfrom" defaultValue={sp.dfrom} className="field" />
            </label>
            <label>
              <span className="label">完了日（まで）</span>
              <input type="date" name="dto" defaultValue={sp.dto} className="field" />
            </label>
            <button type="submit" className="btn-primary col-span-1">
              絞り込む
            </button>
            <Link href={`/tasks?view=${view}`} className="btn-secondary col-span-1">
              解除
            </Link>
          </form>
        </details>

        {tasks.length === 0 ? (
          <Empty icon="tasks">
            該当する業務はありません。
            <Link href="/tasks/new" className="mt-2 block font-semibold text-brand">
              業務を登録する
            </Link>
          </Empty>
        ) : (
          <ul className="space-y-2.5">
            {tasks.map((t) => {
              const emp = employees.find((e) => e.id === t.assignee_id);
              return (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="card press flex items-center gap-3 p-4">
                    {emp ? (
                      <Avatar color={emp.avatar_color} styleId={emp.avatar_style} size={40} label={emp.name} />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-faint">
                        <Icon name="users" size={20} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-semibold">{t.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <TaskStatusBadge status={t.status} />
                        <PriorityBadge priority={t.priority} />
                      </div>
                      <div className="mt-1.5 truncate text-[12px] text-muted">
                        {t.assignee_name ?? "担当未定"} ・ {dateTime(t.created_at)} ・ API {yen(t.spent_jpy)}
                        {t.due_date && ` ・ 期限 ${t.due_date}`}
                      </div>
                    </div>
                    <ChevronRight />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Page>
      <Fab href="/tasks/new" label="業務を新しく登録" />
    </>
  );
}
