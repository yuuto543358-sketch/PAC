import Link from "next/link";
import { getDb } from "@/lib/db";
import { getBudget, getSettings } from "@/lib/repo/settings";
import { getSpendSummary } from "@/lib/budget";
import { countTasks, listRecentActivity } from "@/lib/repo/tasks";
import { countPendingApprovals } from "@/lib/repo/approvals";
import { latestPresidentMessage } from "@/lib/repo/conversations";
import { listEmployees } from "@/lib/repo/employees";
import { listActiveTeams } from "@/lib/workflow/repo";
import { listBusinessProjects } from "@/lib/repo/business";
import { ledgerTotals } from "@/lib/repo/ledger";
import { getCheckin, qolScore } from "@/lib/life/checkins";
import { habitProgressList } from "@/lib/life/habits";
import { listEvents } from "@/lib/life/events";
import { listGoals } from "@/lib/life/goals";
import { jstDateParts } from "@/lib/format";
import { CheckinForm, DismissNudgeButton, HabitCheck } from "./life/QolForms";
import { activeNudges } from "@/lib/life/nudges";
import { GoalBar } from "@/components/GoalBar";
import { ACTIVE_WORKFLOW_PHASES, BUSINESS_STATUS_LABEL, BUSINESS_STATUS_TONE, REPORT_TYPE_LABEL, WORKFLOW_PHASE_LABEL } from "@/lib/constants";
import { isAiConfigured } from "@/lib/ai/client";
import { greeting, longDate, relativeTime, yen } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Icon, type IconName } from "@/components/Icon";
import { Alert, ChevronRight, List, ListRow, Page, Ring, Section } from "@/components/ui";

export default async function HomePage() {
  const sql = await getDb();
  const { date: today } = jstDateParts(new Date());
  const [todayCheckin, habits, events, goals, [lastReview], nudges] = await Promise.all([
    getCheckin(sql, today),
    habitProgressList(sql, today),
    listEvents(sql, today),
    listGoals(sql, today),
    sql<{ id: string; ai_summary: string; week_start: string }[]>`
      select id, ai_summary, to_char(week_start, 'YYYY-MM-DD') as week_start from life_reviews where ai_used order by created_at desc limit 1`,
    activeNudges(sql),
  ]);
  const soon = events.filter((e) => e.daysLeft != null && (e.remindNow || e.daysLeft <= 14)).slice(0, 3);
  const [settings, budget, spend, counts, pending, lastMsg, employees, activity, teams, candidates, latestReport, money, lifeQuestions] = await Promise.all([
    getSettings(sql),
    getBudget(sql),
    getSpendSummary(sql),
    countTasks(sql),
    countPendingApprovals(sql),
    latestPresidentMessage(sql),
    listEmployees(sql),
    listRecentActivity(sql, 6),
    listActiveTeams(sql, 5),
    listBusinessProjects(sql, { limit: 3 }),
    sql<{ id: string; report_type: string; title: string; created_at: Date }[]>`
      select id, report_type, title, created_at from reports where report_type in ('daily','weekly','monthly')
      order by created_at desc limit 1`.then((r) => r[0] ?? null),
    ledgerTotals(sql),
    sql<{ n: number }[]>`
      select count(*)::int as n from life_questions
      where status = 'pending' or (status = 'later' and remind_after <= now())`.then((r) => r[0]?.n ?? 0),
  ]);
  const president = employees.find((e) => e.id === "president");
  const yourTurnCount = pending + lifeQuestions + nudges.length;
  const recentActivity = activity.slice(0, 3);
  const hardLimit = Math.min(budget.monthly_limit_jpy, budget.emergency_stop_jpy);
  const usedPct = hardLimit > 0 ? Math.round((spend.monthJpy / hardLimit) * 100) : 0;

  const notices: { tone: "info" | "warn" | "error"; text: string; href?: string }[] = [];
  if (!isAiConfigured()) notices.push({ tone: "error", text: "OpenAI の APIキー（OPENAI_API_KEY）が未設定です。社員との会話はまだできません（README の「環境変数」参照）。" });
  if (settings.emergency_stop) notices.push({ tone: "error", text: "緊急停止中：AIの呼び出しをすべて止めています。", href: "/settings" });
  if (spend.monthJpy >= hardLimit) notices.push({ tone: "error", text: "今月のAPI利用額が緊急停止ラインに達しました。", href: "/finance" });
  else if (spend.monthJpy >= budget.monthly_target_jpy)
    notices.push({ tone: "warn", text: `今月のAPI利用額が目標（${yen(budget.monthly_target_jpy)}）を超えました。`, href: "/finance" });
  if (spend.todayJpy >= budget.daily_limit_jpy) notices.push({ tone: "warn", text: "今日のAPI利用額が1日の上限に達しました。", href: "/finance" });

  const quick: { href: string; label: string; icon: IconName; color: string; badge?: number }[] = [
    { href: "/employees/president/chat", label: "社長に相談", icon: "chat", color: "#2348b8" },
    { href: "/employees/life/chat", label: "森野に相談", icon: "sparkles", color: "#0f766e" },
    { href: "/tasks/new", label: "業務を登録", icon: "plus", color: "#475569" },
  ];

  return (
    <>
      <header className="pt-safe relative overflow-hidden bg-gradient-to-br from-brand-deep via-[#1d3a99] to-[#3157d0] text-white">
        <div className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-sky-300/10 blur-2xl" aria-hidden />
        <div className="relative mx-auto max-w-2xl px-5 pt-4 pb-16">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-white/75">{longDate()}</p>
            <Link href="/settings" className="press flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-white/90" aria-label="設定">
              <Icon name="settings" size={20} />
            </Link>
          </div>
          <p className="mt-2 text-[15px] text-white/85">{greeting()}。今日の暮らしもサポートします。</p>
          <h1 className="mt-0.5 text-[24px] leading-tight font-bold tracking-tight">{settings.company_name}</h1>
          <p className="mt-1 text-[13px] text-white/70">{settings.philosophy}</p>
        </div>
      </header>

      <Page className="-mt-12 relative" tight>
        {/* ===== 今日のチェック（記録ずみなら、いちばん上に小さく） ===== */}
        {todayCheckin && (
          <Link href="/life/checkins" className="card press flex items-center gap-3.5 p-3.5 shadow-float">
            <Ring value={qolScore(todayCheckin)} max={5} size={60}>
              <span className="tabular text-[17px] leading-none font-bold">{qolScore(todayCheckin)}</span>
              <span className="text-[10px] text-muted">/ 5</span>
            </Ring>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-muted">今日のQOLスコア</div>
              <div className="mt-0.5 text-[13px] leading-snug">
                気分{todayCheckin.mood}・体調{todayCheckin.energy}・睡眠{todayCheckin.sleep}・ストレス{todayCheckin.stress}
              </div>
              <div className="mt-0.5 text-[12px] font-semibold text-brand">変化を見る・直す</div>
            </div>
            <ChevronRight />
          </Link>
        )}

        {/* ===== あなたの番（承認 → 質問 → ひとこと） ===== */}
        <section aria-label="あなたの番" className={`card overflow-hidden ${todayCheckin ? "" : "shadow-float"}`}>
          <h2 className="px-4 pt-3 pb-1 text-[13px] font-semibold tracking-wide text-muted">
            {yourTurnCount ? `あなたの番（${yourTurnCount}件）` : "あなたの番"}
          </h2>
          {yourTurnCount === 0 ? (
            <p className="px-4 pb-3.5 text-[14px] text-muted">いまは、あなたの判断が必要なことはありません。</p>
          ) : (
            <ul className="divide-y divide-separator">
              {pending > 0 && (
                <li>
                  <Link href="/approvals" className="press flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#c2410c]/12 text-[#c2410c]">
                      <Icon name="approve" size={20} stroke={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">承認待ち</span>
                      <span className="block text-[12px] text-muted">あなたの判断が必要です</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-danger px-2.5 py-0.5 text-[14px] font-bold text-white">{pending}件</span>
                    <ChevronRight />
                  </Link>
                </li>
              )}
              {lifeQuestions > 0 && (
                <li>
                  <Link href="/life" className="press flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#0f766e]/12 text-[#0f766e]">
                      <Icon name="chat" size={20} stroke={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">森野からの質問</span>
                      <span className="block text-[12px] text-muted">提案に役立ちます（スキップOK）</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-[#0f766e] px-2.5 py-0.5 text-[14px] font-bold text-white">{lifeQuestions}問</span>
                    <ChevronRight />
                  </Link>
                </li>
              )}
              {nudges.length > 0 && (
                <li className="px-4 pt-2.5 pb-1 text-[12px] font-semibold text-muted">森野からのひとこと（{nudges.length}件）</li>
              )}
              {nudges.map((n) => (
                <li key={n.id} className="flex items-start gap-2 py-1 pr-2 pl-4">
                  <Link href={n.url} className="min-w-0 flex-1 py-2">
                    <span className="block text-[15px] font-semibold">{n.title}</span>
                    <span className="block text-[13px] leading-relaxed text-muted">{n.body}</span>
                  </Link>
                  <DismissNudgeButton id={n.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ===== 今日のチェック（まだなら、あなたの番のあとに） ===== */}
        {!todayCheckin && (
          <div className="card p-4">
            <p className="mb-2 text-[15px] font-semibold">今日の調子は？（10秒）</p>
            <CheckinForm date={today} />
          </div>
        )}

        <Section
          title={habits.length ? `今日の習慣（${habits.filter((h) => h.doneToday).length}/${habits.length}）` : "今日の習慣"}
          action={<Link href="/life/habits" className="font-medium text-brand">{habits.length ? "すべて" : "始める"}</Link>}
        >
          {habits.length === 0 ? (
            <Link href="/life/habits" className="card press block p-4 text-[14px] text-muted">
              小さな習慣を1つ始めてみませんか？（例：寝る前にスマホを置く）
            </Link>
          ) : (
            <ul className="card divide-y divide-separator">
              {habits.map((h) => (
                <li key={h.id}>
                  <HabitCheck
                    id={h.id}
                    date={today}
                    done={h.doneToday}
                    title={h.title}
                    meta={h.frequency === "daily" ? `${h.streak}日続いています` : `今週 ${h.thisWeek} / ${h.target_per_week}回`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <nav aria-label="よく使う操作" className="grid grid-cols-3 gap-2">
          {quick.map((q) => (
            <Link key={q.href} href={q.href} className="press flex flex-col items-center gap-1.5 rounded-[18px] py-2">
              <span className="relative flex h-12 w-12 items-center justify-center rounded-[16px] text-white shadow-card" style={{ background: q.color }}>
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

        {(soon.length > 0 || goals.length > 0 || lastReview) && (
          <Section title="これからのこと" action={<Link href="/life" className="font-medium text-brand">ライフ</Link>}>
            <ul className="card divide-y divide-separator overflow-hidden">
              {soon.map((e) => (
                <li key={e.id}>
                  <Link href="/life/events" className="press flex min-h-[48px] items-center gap-3 px-4 py-2.5">
                    <Icon name="clock" size={18} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{e.title}</span>
                    <span className={`shrink-0 text-[13px] font-semibold ${e.remindNow ? "text-accent" : "text-muted"}`}>
                      {e.daysLeft! < 0 ? `${-e.daysLeft!}日過ぎ` : e.daysLeft === 0 ? "今日" : `あと${e.daysLeft}日`}
                      {e.amount_jpy != null && `・${yen(e.amount_jpy)}`}
                    </span>
                  </Link>
                </li>
              ))}
              {goals.slice(0, 3).map((g) => (
                <li key={g.id}>
                  <Link href={`/life/goals/${g.id}`} className="press flex min-h-[48px] items-center gap-3 px-4 py-2.5">
                    <Icon name="star" size={18} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-[15px]">{g.title}</span>
                        <span className={`shrink-0 text-[13px] font-semibold ${g.behind ? "text-accent" : "text-muted"}`}>
                          {g.pct != null ? `${g.pct}%` : "記録で管理"}
                        </span>
                      </span>
                      <GoalBar pct={g.pct} timePct={g.timePct} />
                    </span>
                  </Link>
                </li>
              ))}
              {lastReview && (
                <li>
                  <Link href={`/life/reviews/${lastReview.id}`} className="press flex min-h-[48px] items-center gap-3 px-4 py-2.5">
                    <Icon name="document" size={18} className="shrink-0 text-[#0f766e]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-[#0f766e]">森野の週のふりかえり（{lastReview.week_start}〜）</span>
                      <span className="block truncate text-[14px]">{lastReview.ai_summary}</span>
                    </span>
                  </Link>
                </li>
              )}
            </ul>
          </Section>
        )}

        <h2 className="px-1 pt-1 text-[20px] font-bold tracking-tight">あなたの会社の動き</h2>

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
          <div className="card overflow-hidden">
          <Link href="/finance" className="press block border-b border-separator px-4 py-2.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-muted">今月のAPI利用料</span>
              <span className="tabular text-[13px] text-muted">
                <span className="text-[17px] font-bold text-ink">{yen(spend.monthJpy)}</span> ／ 上限 {yen(hardLimit)}（{usedPct}%）
              </span>
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, usedPct)}%` }} />
            </span>
            <span className="mt-1 block text-[11px] text-muted">
              目標 {yen(budget.monthly_target_jpy)}・今日 {yen(spend.todayJpy)}／1日の上限 {yen(budget.daily_limit_jpy)}
            </span>
          </Link>
          <div className="grid grid-cols-3 divide-x divide-separator text-center">
            {[
              { href: "/tasks", label: "稼働中の業務", value: `${counts.active}件`, sub: "" },
              { href: "/tasks?view=closed", label: "今月完了", value: `${counts.completed_month}件`, sub: `累計 ${counts.completed_total}件` },
              { href: "/finance", label: "今月の収益", value: yen(money.month.income), sub: `出たお金 ${yen(money.month.expense)}` },
            ].map((x) => (
              <Link key={x.label} href={x.href} className="press block px-1.5 py-3">
                <span className="block text-[12px] font-medium text-muted">{x.label}</span>
                <span className="tabular mt-0.5 block truncate text-[19px] leading-tight font-bold">{x.value}</span>
                {x.sub && <span className="block truncate text-[11px] text-muted">{x.sub}</span>}
              </Link>
            ))}
          </div>
          </div>
        </Section>

        <Section title="チームの進行状況" action={<Link href="/tasks" className="font-medium text-brand">業務一覧</Link>}>
          {teams.length === 0 ? (
            <div className="card px-4 py-5 text-center text-[14px] text-muted">
              進行中のチームはありません。社長に仕事を頼むと、チームを編成して自動で進めます。
            </div>
          ) : (
            <ul className="card divide-y divide-separator overflow-hidden">
              {teams.map((t) => {
                const running = t.autopilot && ACTIVE_WORKFLOW_PHASES.includes(t.phase);
                const waiting = t.phase === "waiting_human";
                return (
                  <li key={t.task_id}>
                    <Link href={`/tasks/${t.task_id}/room`} className="press flex items-center gap-3 px-3.5 py-2.5">
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
          <div className="card divide-y divide-separator overflow-hidden">
          {president && (
            <Link href="/employees/president/chat" className="press block p-3.5">
              <div className="flex items-center gap-3">
                <Avatar color={president.avatar_color} styleId={president.avatar_style} size={30} status={president.status} label={president.name} />
                <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                  {president.name}<span className="ml-1.5 text-[12px] font-normal text-muted">{president.role_title}</span>
                </div>
                {lastMsg && <span className="text-[12px] text-muted">{relativeTime(lastMsg.created_at)}</span>}
              </div>
              <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed whitespace-pre-wrap text-ink/90">
                {lastMsg ? lastMsg.content : "まだ報告はありません。社長に話しかけて、最初の仕事を依頼してみましょう。"}
              </p>
            </Link>
          )}
          <Link href="/reports" className="press flex items-center gap-3 px-3.5 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#7c3aed]/12 text-[#7c3aed]">
              <Icon name="report" size={20} stroke={2} />
            </span>
            <span className="min-w-0 flex-1">
              {latestReport ? (
                <>
                  <span className="block text-[12px] font-semibold text-[#7c3aed]">
                    最新の{REPORT_TYPE_LABEL[latestReport.report_type] ?? "報告"}・{relativeTime(latestReport.created_at)}
                  </span>
                  <span className="block truncate text-[15px] font-semibold">{latestReport.title}</span>
                </>
              ) : (
                <>
                  <span className="block text-[15px] font-semibold">日報・週報</span>
                  <span className="block text-[12px] text-muted">まだありません。報告書の画面で作れます</span>
                </>
              )}
            </span>
            <ChevronRight />
          </Link>
          </div>
        </Section>

        <Section title="新しい事業の候補" action={<Link href="/business" className="font-medium text-brand">すべて</Link>}>
          {candidates.length === 0 ? (
            <Link href="/business" className="card press flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#c2410c]/12 text-[#c2410c]">
                <Icon name="briefcase" size={20} stroke={2} />
              </span>
              <span className="min-w-0 flex-1 text-[14px] text-muted">
                まだ候補はありません。「事業開発」の画面で、AI社員に仕事を探してもらえます。
              </span>
              <ChevronRight />
            </Link>
          ) : (
            <List>
              {candidates.map((b) => (
                <ListRow
                  key={b.id}
                  href={`/business/${b.id}`}
                  title={b.name}
                  subtitle={b.summary}
                  trailing={
                    <span className={`shrink-0 rounded-full px-2 py-px text-[11px] font-semibold ${BUSINESS_STATUS_TONE[b.status]}`}>
                      {BUSINESS_STATUS_LABEL[b.status]}
                    </span>
                  }
                />
              ))}
            </List>
          )}
        </Section>

        <Section title="社員の様子" action={<Link href="/employees" className="font-medium text-brand">すべて</Link>}>
          <div className="-mx-4 overflow-x-auto px-4 pb-1">
            <ul className="flex gap-3">
              {employees.map((e) => (
                <li key={e.id} className="shrink-0">
                  <Link href={`/employees/${e.id}`} className="card press flex w-[96px] flex-col items-center px-2 py-2.5 text-center">
                    <Avatar color={e.avatar_color} styleId={e.avatar_style} size={44} status={e.status} label={e.name} />
                    <span className="mt-1.5 w-full truncate text-[13px] font-semibold">{e.name}</span>
                    <span className="w-full truncate text-[11px] text-muted">{e.role_title}</span>
                    <span className="mt-0.5 rounded-full bg-surface-2 px-2 text-[11px] text-muted">担当 {e.active_tasks}件</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {activity.length > 0 && (
          <Section title="最近の動き" action={<Link href="/tasks" className="font-medium text-brand">すべて見る</Link>}>
            <ol className="card space-y-0 px-4 py-3">
              {recentActivity.map((a, i) => (
                <li key={a.id} className="relative flex gap-3 pb-2.5 last:pb-0">
                  {i < recentActivity.length - 1 && <span className="absolute top-8 left-[15px] h-[calc(100%-24px)] w-px bg-separator" aria-hidden />}
                  {a.actor_type === "employee" && a.avatar_color ? (
                    <Avatar color={a.avatar_color} styleId={a.avatar_style ?? "short"} size={30} label={a.actor_name ?? "社員"} />
                  ) : (
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <Icon name={a.actor_type === "user" ? "briefcase" : "settings"} size={16} />
                    </span>
                  )}
                  <Link href={`/tasks/${a.task_id}`} className="min-w-0 flex-1 active:opacity-70">
                    <div className="truncate text-[14px] leading-snug">
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
