import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getEmployee, listRatings } from "@/lib/repo/employees";
import { listTasks } from "@/lib/repo/tasks";
import { EMPLOYEE_STATUS_LABEL } from "@/lib/constants";
import { dateTime, relativeTime } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { ChevronRight, Empty, Page, PageHeader, PhaseNotice, Section, TaskStatusBadge } from "@/components/ui";
import { DirectInstructionForm, RatingForm } from "./forms";

// AIの返事を待つ時間（秒）。AI呼び出し自体は90秒で打ち切ります。
export const maxDuration = 120;

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = await getDb();
  const e = await getEmployee(sql, id);
  if (!e) notFound();
  const [tasks, ratings] = await Promise.all([listTasks(sql, { assignee: id, view: "all" }, 30), listRatings(sql, id)]);

  return (
    <>
      <PageHeader title={e.name} subtitle={`${e.role_title}・${e.department_name}`} back="/employees" />
      <Page>
        <div className="card p-5">
          <div className="flex items-center gap-4">
            <Avatar color={e.avatar_color} styleId={e.avatar_style} size={76} status={e.status} label={e.name} />
            <div className="min-w-0">
              <div className="text-xs text-muted">{e.name_kana}</div>
              <div className="text-xl font-bold">{e.name}</div>
              <div className="text-sm font-semibold" style={{ color: e.avatar_color }}>
                {e.role_title}
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {EMPLOYEE_STATUS_LABEL[e.status]} ／ 最近の活動 {relativeTime(e.last_activity_at)}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-surface-2 py-2">
              <div className="text-lg font-bold">{e.active_tasks}</div>
              <div className="text-[11px] text-muted">担当中</div>
            </div>
            <div className="rounded-xl bg-surface-2 py-2">
              <div className="text-lg font-bold">{e.completed_tasks}</div>
              <div className="text-[11px] text-muted">完了実績</div>
            </div>
            <div className="rounded-xl bg-surface-2 py-2">
              <div className="text-lg font-bold">{e.avg_rating ? e.avg_rating.toFixed(1) : "—"}</div>
              <div className="text-[11px] text-muted">評価（{e.rating_count}件）</div>
            </div>
          </div>
          <Link href={`/employees/${e.id}/chat`} className="btn-primary mt-4 w-full">
            {e.name.split(" ")[1] ?? e.name}さんとチャットする
          </Link>
        </div>

        <Section title="直接指示を出す">
          <div className="card p-4">
            <DirectInstructionForm employeeId={e.id} />
          </div>
        </Section>

        <Section title="プロフィール">
          <dl className="card divide-y divide-line text-sm">
            {[
              ["性格", e.personality],
              ["話し方", e.speaking_style],
              ["判断基準", e.judgment_criteria],
            ].map(([k, v]) => (
              <div key={k} className="px-4 py-3">
                <dt className="text-xs font-semibold text-muted">{k}</dt>
                <dd className="mt-1 whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
            <div className="px-4 py-3">
              <dt className="text-xs font-semibold text-muted">専門分野・能力</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {e.expertise.map((x) => (
                  <span key={x} className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
                    {x}
                  </span>
                ))}
              </dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-xs font-semibold text-muted">得意な業務</dt>
              <dd className="mt-1">{e.strengths.join("、") || "—"}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-xs font-semibold text-muted">苦手な業務</dt>
              <dd className="mt-1">{e.weaknesses.join("、") || "—"}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-xs font-semibold text-muted">累積経験</dt>
              <dd className="mt-1">{e.experience_points} ポイント（会話・業務のたびに増えます）</dd>
            </div>
          </dl>
          <p className="mt-2 px-1 text-xs text-muted">
            プロフィールは <Link href={`/settings/employees/${e.id}`} className="text-brand underline">設定 → 社員情報</Link> から変更できます。
          </p>
        </Section>

        <Section title="業務履歴">
          {tasks.length === 0 ? (
            <Empty>まだ担当した業務はありません。</Empty>
          ) : (
            <ul className="card divide-y divide-line">
              {tasks.map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{t.title}</div>
                      <div className="text-xs text-muted">{dateTime(t.created_at)} 登録</div>
                    </div>
                    <TaskStatusBadge status={t.status} />
                    <ChevronRight />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="経営者からの評価">
          <div className="card p-4">
            <RatingForm employeeId={e.id} />
          </div>
          {ratings.length > 0 && (
            <ul className="card mt-2.5 divide-y divide-line">
              {ratings.map((r) => (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-accent" aria-label={`${r.rating}点`}>
                      {"★".repeat(r.rating)}
                      <span className="text-line">{"★".repeat(5 - r.rating)}</span>
                    </span>
                    <span className="text-xs text-muted">{dateTime(r.created_at)}</span>
                  </div>
                  {r.comment && <p className="mt-1 whitespace-pre-wrap">{r.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <PhaseNotice phase="Phase 2">業務経験・評価・修正指示を記憶として蓄積し、次の仕事に活かす機能</PhaseNotice>
      </Page>
    </>
  );
}
