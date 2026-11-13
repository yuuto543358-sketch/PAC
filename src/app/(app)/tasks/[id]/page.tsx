import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getTask, getTaskLogs } from "@/lib/repo/tasks";
import { listEmployees } from "@/lib/repo/employees";
import {
  ACTIVE_WORKFLOW_PHASES,
  DELIVERABLE_FORMATS,
  DELIVERABLE_STATUS_LABEL,
  MANUAL_STATUS_TRANSITIONS,
  MEMBER_ROLE_LABEL,
  TASK_SOURCE_LABEL,
  WORKFLOW_PHASE_LABEL,
  type ApprovalStatus,
} from "@/lib/constants";
import { getWorkflow, listDeliverables, listMembers } from "@/lib/workflow/repo";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import { PauseResumeButton, StartTeamButton } from "./team-forms";
import { dateTime, yen, yenPrecise } from "@/lib/format";
import { ApprovalStatusBadge, ChevronRight, Page, PageHeader, PriorityBadge, Section, TaskStatusBadge } from "@/components/ui";

// チームの作業（バックグラウンド）を待つ時間（秒）
export const maxDuration = 300;
import { CommentForm, DeliverableForm, EditTaskForm, StatusForm } from "./forms";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = await getDb();
  const task = await getTask(sql, id);
  if (!task) notFound();
  const [wf, members, deliverables] = await Promise.all([getWorkflow(sql, id), listMembers(sql, id), listDeliverables(sql, id)]);
  const [logs, employees, approvals, usage] = await Promise.all([
    getTaskLogs(sql, id),
    listEmployees(sql),
    sql<{ id: string; title: string; status: ApprovalStatus; created_at: Date }[]>`
      select id, title, status, created_at from approvals where task_id = ${id} order by created_at desc`,
    sql<{ id: string; created_at: Date; model: string; status: string; cost: number; employee_name: string | null }[]>`
      select u.id, u.created_at, u.model, u.status, coalesce(u.cost_jpy, u.estimated_cost_jpy)::float8 as cost, e.name as employee_name
      from api_usage u left join employees e on e.id = u.employee_id where u.task_id = ${id} order by u.created_at desc`,
  ]);
  const transitions = MANUAL_STATUS_TRANSITIONS[task.status];

  return (
    <>
      <PageHeader title="業務の詳細" back="/tasks" backLabel="業務" large={false} />
      <Page>
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] text-muted">{TASK_SOURCE_LABEL[task.source]}</span>
          </div>
          <h2 className="mt-2.5 text-[22px] leading-snug font-bold tracking-tight">{task.title}</h2>
          {task.description && <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-wrap text-ink/85">{task.description}</p>}
          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 rounded-[14px] bg-surface-2 p-3.5 text-[14px]">
            <div>
              <dt className="text-[11px] font-semibold text-muted">担当</dt>
              <dd className="font-medium">
                {task.assignee_id ? <Link href={`/employees/${task.assignee_id}`} className="text-brand">{task.assignee_name}</Link> : "未定"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold text-muted">部署</dt>
              <dd className="font-medium">{task.department_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold text-muted">登録者</dt>
              <dd className="font-medium">{task.creator_name ?? "経営者"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold text-muted">期限</dt>
              <dd className="font-medium">{task.due_date ?? "なし"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold text-muted">発生日</dt>
              <dd className="font-medium">{dateTime(task.created_at)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold text-muted">完了日</dt>
              <dd className="font-medium">{dateTime(task.completed_at)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[11px] font-semibold text-muted">API費用（使用額／業務予算）・AI呼び出し回数</dt>
              <dd className="font-medium">
                {yen(task.spent_jpy)} ／ {yen(task.budget_limit_jpy)} ・ {task.ai_call_count}回
              </dd>
            </div>
          </dl>
        </div>

        <Section title="チーム">
          {!wf ? (
            <div className="card p-4">
              <p className="text-[14px] leading-relaxed text-muted">
                社長がチームを編成し、グループチャットで議論しながら、成果物の作成・監査・報告まで自動で進めます。あなたは最後に承認するだけです。
              </p>
              <div className="mt-3">
                <StartTeamButton taskId={task.id} />
              </div>
            </div>
          ) : (
            <div className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold">
                  {WORKFLOW_PHASE_LABEL[wf.phase]}
                  {!wf.autopilot && wf.phase !== "done" && <span className="ml-1.5 text-[12px] font-medium text-accent">（一時停止中）</span>}
                </span>
                {wf.autopilot && ACTIVE_WORKFLOW_PHASES.includes(wf.phase) && (
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                    自動で進行中
                  </span>
                )}
              </div>
              <div className="mt-3">
                <WorkflowStepper phase={wf.phase} resumePhase={wf.resume_phase} />
              </div>
              {members.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {members.map((m) => (
                    <li key={m.employee_id}>
                      <Link
                        href={`/employees/${m.employee_id}`}
                        className="press inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-[13px]"
                      >
                        <Avatar color={m.avatar_color} styleId={m.avatar_style} size={26} label={m.name} />
                        <span className="font-medium">{m.name}</span>
                        <span className="text-[11px] text-muted">{MEMBER_ROLE_LABEL[m.role]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {wf.plan?.goal && (
                <div className="mt-4 rounded-[14px] bg-surface-2 p-3.5 text-[13px] leading-relaxed">
                  <div className="font-semibold">ゴール</div>
                  <p className="text-ink/80">{wf.plan.goal}</p>
                  {wf.plan.steps && wf.plan.steps.length > 0 && (
                    <>
                      <div className="mt-2 font-semibold">進め方</div>
                      <p className="text-ink/80">{wf.plan.steps.join(" → ")}</p>
                    </>
                  )}
                </div>
              )}
              {wf.phase === "waiting_human" && (
                <p className="mt-3 flex items-start gap-2 rounded-[12px] bg-accent-soft px-3 py-2.5 text-[13px] font-medium text-accent">
                  <Icon name="bell" size={16} stroke={2} className="mt-px shrink-0" />
                  {wf.waiting_reason === "acceptance"
                    ? "成果物が完成しました。承認センターで確認してください。"
                    : wf.waiting_reason === "question"
                      ? "チームから質問があります。グループチャットで答えてください。"
                      : "チームが一時停止しています。グループチャットで指示を送ると再開します。"}
                </p>
              )}
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Link href={`/tasks/${task.id}/room`} className="btn-primary w-full">
                  <Icon name="chat" size={20} stroke={2} />
                  グループチャットを開く
                </Link>
                {wf.phase !== "done" && <PauseResumeButton taskId={task.id} paused={!wf.autopilot || wf.phase === "stopped"} />}
              </div>
              <p className="mt-2 text-[11px] text-muted">
                作業回数 {wf.steps}回 ・ 監査による修正 {wf.rework_count}回
              </p>
            </div>
          )}
        </Section>

        {deliverables.length > 0 && (
          <Section title="成果物メモ（手動で記録）">
            <ul className="card divide-y divide-separator">
              {deliverables.map((d) => (
                <li key={d.version}>
                  <Link href={`/tasks/${task.id}/deliverables/${d.version}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-success-soft text-success">
                      <Icon name="document" size={20} stroke={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">
                        第{d.version}版：{d.title}
                      </span>
                      <span className="block text-[12px] text-muted">
                        {DELIVERABLE_FORMATS.find((f) => f.id === d.format)?.label ?? d.format} ・ {d.author_name ?? "—"} ・{" "}
                        {DELIVERABLE_STATUS_LABEL[d.status] ?? d.status}
                      </span>
                    </span>
                    <ChevronRight />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="進捗（ステータス変更）">
          <div className="card p-4">
            {transitions.length > 0 ? (
              <StatusForm taskId={task.id} options={transitions} />
            ) : (
              <p className="text-sm text-muted">この業務は完了しているため、ステータスは変更できません。</p>
            )}
            {task.status === "awaiting_approval" && (
              <p className="mt-2 text-xs text-muted">承認待ちの業務は、承認センターでの判断によって次の状態に進みます。</p>
            )}
          </div>
        </Section>

        {approvals.length > 0 && (
          <Section title="関連する承認依頼">
            <ul className="card divide-y divide-separator">
              {approvals.map((a) => (
                <li key={a.id}>
                  <Link href={`/approvals/${a.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.title}</span>
                    <ApprovalStatusBadge status={a.status} />
                    <ChevronRight />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="成果物">
          <div className="card p-4">
            <DeliverableForm taskId={task.id} initial={task.deliverable} />
          </div>
        </Section>

        <Section title="担当・優先度・期限・予算の変更">
          <div className="card p-4">
            <EditTaskForm
              taskId={task.id}
              employees={employees.map((e) => ({ id: e.id, name: e.name }))}
              initial={{ assignee: task.assignee_id ?? "", priority: task.priority, due: task.due_date ?? "", budget: task.budget_limit_jpy }}
            />
          </div>
        </Section>

        <Section title="API利用履歴">
          {usage.length === 0 ? (
            <p className="card px-4 py-4 text-sm text-muted">この業務ではまだAIを使っていません。</p>
          ) : (
            <ul className="card divide-y divide-separator text-sm">
              {usage.map((u) => (
                <li key={u.id} className="flex justify-between px-4 py-2.5">
                  <span>
                    {dateTime(u.created_at)} ・ {u.employee_name ?? "—"} ・ <span className="text-muted">{u.model}</span>
                  </span>
                  <span className="font-medium">{yenPrecise(u.cost)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="進行履歴（変更・削除できない記録）">
          <ol className="card space-y-0 p-4">
            {logs.map((l, i) => (
              <li key={l.id} className="relative pb-4 pl-6 last:pb-0">
                {i < logs.length - 1 && <span className="absolute top-3 left-[5.5px] h-full w-px bg-separator" />}
                <span className="absolute top-1.5 left-0 h-3 w-3 rounded-full border-[3px] border-brand bg-surface" />
                <div className="text-xs text-muted">
                  {dateTime(l.created_at)} ・ {l.actor_type === "user" ? "経営者" : l.actor_type === "employee" ? (l.actor_name ?? "社員") : "システム"}
                </div>
                <div className="text-sm whitespace-pre-wrap">{l.message}</div>
              </li>
            ))}
          </ol>
          <div className="card mt-2.5 p-4">
            <CommentForm taskId={task.id} />
          </div>
        </Section>
      </Page>
    </>
  );
}
