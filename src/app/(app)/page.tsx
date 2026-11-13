import Link from "next/link";
import { getDb } from "@/lib/db";
import { getBudget, getSettings } from "@/lib/repo/settings";
import { getSpendSummary } from "@/lib/budget";
import { countTasks, listRecentActivity, listTasks } from "@/lib/repo/tasks";
import { countPendingApprovals } from "@/lib/repo/approvals";
import { latestPresidentMessage } from "@/lib/repo/conversations";
import { listEmployees } from "@/lib/repo/employees";
import { listActiveTeams } from "@/lib/workflow/repo";
import { ACTIVE_WORKFLOW_PHASES, WORKFLOW_PHASE_LABEL } from "@/lib/constants";
import { isAiConfigured } from "@/lib/ai/client";
import { greeting, longDate, relativeTime, yen } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Icon, type IconName } from "@/components/Icon";
import { Alert, ChevronRight, List, ListRow, Page, PhaseNotice, Ring, Section, Stat, TaskStatusBadge } from "@/components/ui";

export default async function HomePage() {
  const sql = await getDb();
  const [settings, budget, spend, counts, pending, lastMsg, employees, recentTasks, activity, teams] = await Promise.all([
    getSettings(sql),
    getBudget(sql),
    getSpendSummary(sql),
    countTasks(sql),
    countPendingApprovals(sql),
    latestPresidentMessage(sql),
    listEmployees(sql),
    listTasks(sql, { view: "active" }, 5),
    listRecentActivity(sql, 6),
    listActiveTeams(sql, 5),
  ]);
  const president = employees.find((e) => e.id === "president");
  const hardLimit = Math.min(budget.monthly_limit_jpy, budget.emergency_stop_jpy);
  const usedPct = hardLimit > 0 ? Math.round((spend.monthJpy / hardLimit) * 100) : 0;

  const notices: { tone: "info" | "warn" | "error"; text: string; href?: string }[] = [];
  if (!isAiConfigured()) notices.push({ tone: "error", text: "OpenAI の APIキー（OPENAI_API_KEY）が未設定です。社員との会話はまだできません（README の「環境変数」参照）。" });
  if (settings.emergency_stop) notices.push({ tone: "error", text: "緊急停止中：AIの呼び出しをすべて止めています。", href: "/settings" });
  if (spend.monthJpy >= hardLimit) notices.push({ tone: "error", text: "今月のAPI利用額が緊急停止ラインに達しました。", href: "/finance" });
  else if (spend.monthJpy >= budget.monthly_target_jpy)
    notices.push({ tone: "warn", text: `今月のAPI利用額が目標（${yen(budget.monthly_target_jpy)}）を超えました。`, href: "/finance" });
  if (spend.todayJpy >= budget.daily_limit_jpy) notices.push({ tone: "warn", text: "今日のAPI利用額が1日の上限に達しました。", href: "/finance" });
  if (pending > 0) notices.push({ tone: "warn", text: `承認待ちの案件が ${pending} 件あります。`, href: "/approvals" });

  const quick: { href: string; label: string; icon: IconName; color: string; badge?: number }[] = [
    { href: "/employees/president/chat", label: "社長に相談", icon: "chat", color: "#2348b8" },
    { href: "/tasks/new", label: "業務を登録", icon: "plus", color: "#0f766e" },
    { href: "/approvals", label: "承認する", icon: "approve", color: "#c2410c", badge: pending },
    { href: "/finance", label: "財務を見る", icon: "wallet", color: "#15803d" },
  ];

  return (
    <>
      <header className="pt-safe relative overflow-hidden bg-gradient-to-br from-brand-deep via-[#1d3a99] to-[#3157d0] text-white">
        <div className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-sky-300/10 blur-2xl" aria-hidden />
        <div className="relative mx-auto max-w-2xl px-5 pt-5 pb-20">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-white/75">{longDate()}</p>
            <Link href="/settings" className="press flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-white/90" aria-label="設定">
              <Icon name="settings" size={20} />
            </Link>
          </div>
          <p className="mt-3 text-[15px] text-white/85">{greeting()}、社長からの報告をお届けします。</p>
          <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-tight">{settings.company_name}</h1>
          <p className="mt-1 text-[13px] text-white/70">{settings.philosophy}</p>
        </div>
      </header>

      <Page className="-mt-14 relative">
        <Link href="/finance" className="card press flex items-center gap-4 p-4 shadow-float">
          <Ring value={spend.monthJpy} max={hardLimit} size={86}>
            <span className="tabular text-[18px] leading-none font-bold">{usedPct}%</span>
            <span className="mt-0.5 text-[10px] text-muted">使用</span>
          </Ring>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-muted">今月のAPI利用料</div>
            <div className="tabular mt-0.5 text-[26px] leading-tight font-bold tracking-tight">{yen(spend.monthJpy)}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-muted">
              上限 {yen(hardLimit)} ・ 目標 {yen(budget.monthly_target_jpy)}
              <br />
              今日 {yen(spend.todayJpy)} ／ 1日の上限 {yen(budget.daily_limit_jpy)}
            </div>
          </div>
          <ChevronRight />
        </Link>

        <nav aria-label="よく使う操作" className="grid grid-cols-4 gap-2">
          {quick.map((q) => (
            <Link key={q.href} href={q.href} className="press flex flex-col items-center gap-1.5 rounded-[18px] py-2">
              <span className="relative flex h-14 w-14 items-center justify-center rounded-[18px] text-white shadow-card" style={{ background: q.color }}>
                <Icon name={q.icon} size={26} stroke={2} />
                {q.badge ? (
                  <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-danger px-1 text-center text-[11px] leading-5 font-bold text-white ring-2 ring-bg">
                    {q.badge}
                  </span>
                ) : null}
              </span>
              <span className="text-[12px] font-medium text-ink/85">{q.label}</span>
            </Link>
          ))}
        </nav>

        {notices.length > 0 && (
          <Section title="重要なお知らせ">
            <div className="space-y-2">
              {notices.map((n) =>
                n.href ? (
                  <Link key={n.text} href={n.href} className="press block">
                    <Alert tone={n.tone}>{n.text}</Alert>
                  </Link>
                ) : (
                  <Alert key={n.text} tone={n.tone}>
                    {n.text}
                  </Alert>
                ),
              )}
            </div>
          </Section>
        )}

        <Section title="本日の会社の状況">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="稼働中の業務" value={`${counts.active}件`} href="/tasks" icon="tasks" />
            <Stat label="承認待ち" value={`${pending}件`} href="/approvals" icon="approve" tone={pending > 0 ? "accent" : undefined} />
            <Stat label="今月完了した業務" value={`${counts.completed_month}件`} sub={`累計 ${counts.completed_total}件`} href="/tasks?view=closed" icon="check" />
            <Stat label="今月の収益" value="0円" sub="記録は Phase 4 で実装予定" icon="trend" />
          </div>
        </Section>

        <Section title="チームの進行状況" action={<Link href="/tasks" className="font-medium text-brand">業務一覧</Link>}>
          {teams.length === 0 ? (
            <div className="card px-4 py-5 text-center text-[14px] text-muted">
              進行中のチームはありません。社長に仕事を頼むと、チームを編成して自動で進めます。
            </div>
          ) : (
            <ul className="space-y-2.5">
              {teams.map((t) => {
                const running = t.autopilot && ACTIVE_WORKFLOW_PHASES.includes(t.phase);
                const waiting = t.phase === "waiting_human";
                return (
                  <li key={t.task_id}>
                    <Link href={`/tasks/${t.task_id}/room`} className="card press flex items-center gap-3 p-3.5">
                      <div className="flex shrink-0 -space-x-2">
                        {t.members.slice(0, 3).map((m) => (
                          <span key={m.employee_id} className="rounded-full ring-2 ring-[var(--surface)]">
                            <Avatar color={m.avatar_color} styleId={m.avatar_style} size={30} label={m.name} />
                          </span>
                        ))}
                        {t.members.length === 0 && (
                          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-surface-2 text-faint">
                            <Icon name="users" size={16} />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold">{t.title}</div>
                        <div className={`mt-0.5 flex items-center gap-1.5 text-[12px] font-medium ${waiting ? "text-accent" : running ? "text-success" : "text-muted"}`}>
                          {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />}
                          {waiting
                            ? t.waiting_reason === "acceptance"
                              ? "成果物の承認待ち"
                              : t.waiting_reason === "question"
                                ? "チームから質問があります"
                                : "一時停止中（指示待ち）"
                            : `${WORKFLOW_PHASE_LABEL[t.phase]}${!t.autopilot ? "（一時停止）" : ""}`}
                        </div>
                      </div>
                      <ChevronRight />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="社長からの報告">
          {president && (
            <Link href="/employees/president/chat" className="card press block p-4">
              <div className="flex items-center gap-3">
                <Avatar color={president.avatar_color} styleId={president.avatar_style} size={44} status={president.status} label={president.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">{president.name}</div>
                  <div className="text-[12px] text-muted">{president.role_title}</div>
                </div>
                {lastMsg && <span className="text-[12px] text-muted">{relativeTime(lastMsg.created_at)}</span>}
              </div>
              <p className="mt-3 line-clamp-3 rounded-[14px] bg-surface-2 px-3.5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-ink/90">
                {lastMsg ? lastMsg.content : "まだ報告はありません。社長に話しかけて、最初の仕事を依頼してみましょう。"}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-[15px] font-semibold text-brand">
                <Icon name="chat" size={18} stroke={2} />
                社長と話す
              </span>
            </Link>
          )}
          <div className="mt-3">
            <PhaseNotice phase="Phase 2〜3">社長が自動で作成する日次・週次の報告書</PhaseNotice>
          </div>
        </Section>

        <Section title="社員の様子" action={<Link href="/employees" className="font-medium text-brand">すべて</Link>}>
          <div className="-mx-4 overflow-x-auto px-4 pb-1">
            <ul className="flex gap-3">
              {employees.map((e) => (
                <li key={e.id} className="shrink-0">
                  <Link href={`/employees/${e.id}`} className="card press flex w-[104px] flex-col items-center px-2 py-3 text-center">
                    <Avatar color={e.avatar_color} styleId={e.avatar_style} size={52} status={e.status} label={e.name} />
                    <span className="mt-2 w-full truncate text-[13px] font-semibold">{e.name}</span>
                    <span className="w-full truncate text-[11px] text-muted">{e.role_title}</span>
                    <span className="mt-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">担当 {e.active_tasks}件</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section title="進行中の業務" action={<Link href="/tasks" className="font-medium text-brand">すべて</Link>}>
          {recentTasks.length === 0 ? (
            <div className="card px-4 py-6 text-center text-[15px] text-muted">
              進行中の業務はありません。
              <Link href="/tasks/new" className="mt-2 block font-semibold text-brand">
                業務を登録する
              </Link>
            </div>
          ) : (
            <List>
              {recentTasks.map((t) => (
                <ListRow
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  title={<span className="font-medium">{t.title}</span>}
                  subtitle={`担当: ${t.assignee_name ?? "未定"}`}
                  trailing={<TaskStatusBadge status={t.status} />}
                />
              ))}
            </List>
          )}
        </Section>

        {activity.length > 0 && (
          <Section title="最近の動き">
            <ol className="card space-y-0 px-4 py-3">
              {activity.map((a, i) => (
                <li key={a.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < activity.length - 1 && <span className="absolute top-8 left-[15px] h-[calc(100%-24px)] w-px bg-separator" aria-hidden />}
                  {a.actor_type === "employee" && a.avatar_color ? (
                    <Avatar color={a.avatar_color} styleId={a.avatar_style ?? "short"} size={30} label={a.actor_name ?? "社員"} />
                  ) : (
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <Icon name={a.actor_type === "user" ? "briefcase" : "settings"} size={16} />
                    </span>
                  )}
                  <Link href={`/tasks/${a.task_id}`} className="min-w-0 flex-1 active:opacity-70">
                    <div className="text-[14px] leading-snug">
                      <span className="font-semibold">{a.actor_type === "user" ? "あなた" : a.actor_type === "employee" ? a.actor_name : "システム"}</span>
                      <span className="text-ink/80">：{a.message}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted">
                      {a.task_title} ・ {relativeTime(a.created_at)}
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </Page>
    </>
  );
}
