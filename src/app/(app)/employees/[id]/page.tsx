import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getEmployee, listRatings } from "@/lib/repo/employees";
import { listTasks } from "@/lib/repo/tasks";
import { EMPLOYEE_STATUS_LABEL } from "@/lib/constants";
import { dateTime, relativeTime } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Empty, List, ListRow, Page, PageHeader, PhaseNotice, Section, SegmentedLinks, TaskStatusBadge } from "@/components/ui";
import { DirectInstructionForm, RatingForm } from "./forms";

// AIの返事を待つ時間（秒）。AI呼び出し自体は90秒で打ち切ります。
export const maxDuration = 120;

type Tab = "profile" | "tasks" | "ratings";

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = sp.tab === "tasks" || sp.tab === "ratings" ? sp.tab : "profile";
  const sql = await getDb();
  const e = await getEmployee(sql, id);
  if (!e) notFound();
  const [tasks, ratings] = await Promise.all([listTasks(sql, { assignee: id, view: "all" }, 30), listRatings(sql, id)]);
  const firstName = e.name.split(" ")[1] ?? e.name;
  const base = `/employees/${e.id}`;

  return (
    <>
      <PageHeader title={e.name} back="/employees" backLabel="社員" large={false} />
      <Page>
        <div className="card overflow-hidden">
          <div className="relative h-20" style={{ background: `linear-gradient(135deg, ${e.avatar_color}, ${e.avatar_color}99)` }} aria-hidden>
            <div className="absolute -right-6 -bottom-10 h-28 w-28 rounded-full bg-white/15" />
          </div>
          <div className="-mt-10 px-5 pb-5">
            <div className="flex items-end justify-between">
              <span className="rounded-full bg-surface p-1 shadow-card">
                <Avatar color={e.avatar_color} styleId={e.avatar_style} size={80} status={e.status} label={e.name} />
              </span>
              <Link
                href={`/settings/employees/${e.id}`}
                className="press mb-1 inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-muted"
              >
                <Icon name="edit" size={15} stroke={2} />
                編集
              </Link>
            </div>
            <div className="mt-3 text-[12px] text-muted">{e.name_kana}</div>
            <h2 className="text-[24px] leading-tight font-bold tracking-tight">{e.name}</h2>
            <div className="mt-0.5 text-[14px] font-semibold" style={{ color: e.avatar_color }}>
              {e.role_title}・{e.department_name}
            </div>
            <div className="mt-1 text-[12px] text-muted">
              {EMPLOYEE_STATUS_LABEL[e.status]} ／ 最近の活動 {relativeTime(e.last_activity_at)}
            </div>
            <div className="mt-4 grid grid-cols-3 divide-x divide-separator rounded-[14px] bg-surface-2 py-2.5 text-center">
              <div>
                <div className="tabular text-[20px] font-bold">{e.active_tasks}</div>
                <div className="text-[11px] text-muted">担当中</div>
              </div>
              <div>
                <div className="tabular text-[20px] font-bold">{e.completed_tasks}</div>
                <div className="text-[11px] text-muted">完了実績</div>
              </div>
              <div>
                <div className="tabular text-[20px] font-bold">{e.avg_rating ? e.avg_rating.toFixed(1) : "—"}</div>
                <div className="text-[11px] text-muted">評価（{e.rating_count}件）</div>
              </div>
            </div>
            <Link href={`${base}/chat`} className="btn-primary mt-4 w-full">
              <Icon name="chat" size={20} stroke={2} />
              {firstName}さんとチャットする
            </Link>
          </div>
        </div>

        <SegmentedLinks
          active={tab}
          items={[
            { key: "profile", label: "プロフィール", href: base },
            { key: "tasks", label: `業務履歴（${tasks.length}）`, href: `${base}?tab=tasks` },
            { key: "ratings", label: "評価", href: `${base}?tab=ratings` },
          ]}
        />

        {tab === "profile" && (
          <>
            <Section title="直接指示を出す">
              <div className="card p-4">
                <DirectInstructionForm employeeId={e.id} />
              </div>
            </Section>

            <Section title="プロフィール" footer={<>プロフィールは「編集」から変更できます。役割と権限は変更できません。</>}>
              <dl className="card divide-y divide-separator text-[15px]">
                {[
                  ["性格", e.personality],
                  ["話し方", e.speaking_style],
                  ["判断基準", e.judgment_criteria],
                ].map(([k, v]) => (
                  <div key={k} className="px-4 py-3.5">
                    <dt className="text-[12px] font-semibold text-muted">{k}</dt>
                    <dd className="mt-1 leading-relaxed whitespace-pre-wrap">{v}</dd>
                  </div>
                ))}
                <div className="px-4 py-3.5">
                  <dt className="text-[12px] font-semibold text-muted">専門分野・能力</dt>
                  <dd className="mt-2 flex flex-wrap gap-1.5">
                    {e.expertise.map((x) => (
                      <span key={x} className="rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand">
                        {x}
                      </span>
                    ))}
                  </dd>
                </div>
                <div className="px-4 py-3.5">
                  <dt className="text-[12px] font-semibold text-muted">得意な業務</dt>
                  <dd className="mt-1">{e.strengths.join("、") || "—"}</dd>
                </div>
                <div className="px-4 py-3.5">
                  <dt className="text-[12px] font-semibold text-muted">苦手な業務</dt>
                  <dd className="mt-1">{e.weaknesses.join("、") || "—"}</dd>
                </div>
                <div className="px-4 py-3.5">
                  <dt className="text-[12px] font-semibold text-muted">累積経験</dt>
                  <dd className="mt-1">{e.experience_points} ポイント（会話・業務のたびに増えます）</dd>
                </div>
              </dl>
            </Section>
            <PhaseNotice phase="Phase 2">業務経験・評価・修正指示を記憶として蓄積し、次の仕事に活かす機能</PhaseNotice>
          </>
        )}

        {tab === "tasks" && (
          <Section title="業務履歴">
            {tasks.length === 0 ? (
              <Empty icon="tasks">まだ担当した業務はありません。</Empty>
            ) : (
              <List>
                {tasks.map((t) => (
                  <ListRow
                    key={t.id}
                    href={`/tasks/${t.id}`}
                    title={<span className="font-medium">{t.title}</span>}
                    subtitle={`${dateTime(t.created_at)} 登録`}
                    trailing={<TaskStatusBadge status={t.status} />}
                  />
                ))}
              </List>
            )}
          </Section>
        )}

        {tab === "ratings" && (
          <Section title="経営者からの評価">
            <div className="card p-4">
              <RatingForm employeeId={e.id} />
            </div>
            {ratings.length > 0 && (
              <ul className="card mt-3 divide-y divide-separator">
                {ratings.map((r) => (
                  <li key={r.id} className="px-4 py-3 text-[15px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[17px] tracking-wider text-accent" aria-label={`${r.rating}点`}>
                        {"★".repeat(r.rating)}
                        <span className="text-surface-3">{"★".repeat(5 - r.rating)}</span>
                      </span>
                      <span className="text-[12px] text-muted">{dateTime(r.created_at)}</span>
                    </div>
                    {r.comment && <p className="mt-1 leading-relaxed whitespace-pre-wrap">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </Page>
    </>
  );
}
