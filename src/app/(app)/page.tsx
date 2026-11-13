import Link from "next/link";
import { getDb } from "@/lib/db";
import { getBudget, getSettings } from "@/lib/repo/settings";
import { getSpendSummary } from "@/lib/budget";
import { countTasks, listTasks } from "@/lib/repo/tasks";
import { countPendingApprovals } from "@/lib/repo/approvals";
import { latestPresidentMessage } from "@/lib/repo/conversations";
import { listEmployees } from "@/lib/repo/employees";
import { isAiConfigured } from "@/lib/ai/client";
import { longDate, relativeTime, yen } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Alert, ChevronRight, Meter, Page, PhaseNotice, Section, Stat, TaskStatusBadge } from "@/components/ui";

export default async function HomePage() {
  const sql = await getDb();
  const [settings, budget, spend, counts, pending, lastMsg, employees, recentTasks] = await Promise.all([
    getSettings(sql),
    getBudget(sql),
    getSpendSummary(sql),
    countTasks(sql),
    countPendingApprovals(sql),
    latestPresidentMessage(sql),
    listEmployees(sql),
    listTasks(sql, { view: "active" }, 5),
  ]);
  const president = employees.find((e) => e.id === "president");
  const hardLimit = Math.min(budget.monthly_limit_jpy, budget.emergency_stop_jpy);

  const notices: { tone: "info" | "warn" | "error"; text: string; href?: string }[] = [];
  if (!isAiConfigured()) notices.push({ tone: "error", text: "AIのAPIキーが未設定です。社員との会話はまだできません（READMEの手順4）。" });
  if (settings.emergency_stop) notices.push({ tone: "error", text: "緊急停止中：AIの呼び出しをすべて止めています。", href: "/settings" });
  if (spend.monthJpy >= hardLimit) notices.push({ tone: "error", text: "今月のAPI利用額が緊急停止ラインに達しました。", href: "/finance" });
  else if (spend.monthJpy >= budget.monthly_target_jpy)
    notices.push({ tone: "warn", text: `今月のAPI利用額が目標（${yen(budget.monthly_target_jpy)}）を超えました。`, href: "/finance" });
  if (spend.todayJpy >= budget.daily_limit_jpy) notices.push({ tone: "warn", text: "今日のAPI利用額が1日の上限に達しました。", href: "/finance" });
  if (pending > 0) notices.push({ tone: "warn", text: `承認待ちの案件が ${pending} 件あります。`, href: "/approvals" });

  return (
    <>
      <header className="pt-safe bg-brand text-brand-fg">
        <div className="mx-auto max-w-2xl px-4 pt-5 pb-6">
          <p className="text-xs opacity-80">{longDate()}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-wide">{settings.company_name}</h1>
          <p className="mt-1 text-sm opacity-85">{settings.philosophy}</p>
        </div>
      </header>
      <Page>
        {notices.length > 0 && (
          <Section title="重要なお知らせ">
            <div className="space-y-2">
              {notices.map((n) =>
                n.href ? (
                  <Link key={n.text} href={n.href} className="block active:opacity-70">
                    <Alert tone={n.tone}>{n.text} ›</Alert>
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
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="稼働中の業務" value={`${counts.active}件`} href="/tasks" />
            <Stat label="承認待ち" value={`${pending}件`} href="/approvals" tone={pending > 0 ? "accent" : undefined} />
            <Stat label="今月完了した業務" value={`${counts.completed_month}件`} sub={`累計 ${counts.completed_total}件`} href="/tasks?view=closed" />
            <Stat label="今日のAPI利用料" value={yen(spend.todayJpy)} sub={`1日の上限 ${yen(budget.daily_limit_jpy)}`} href="/finance" />
          </div>
          <Link href="/finance" className="card mt-2.5 block p-3.5 active:opacity-70">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted">今月のAPI利用料</span>
              <span className="text-xs text-muted">上限 {yen(hardLimit)}</span>
            </div>
            <div className="mt-1 mb-2 text-[22px] font-bold">{yen(spend.monthJpy)}</div>
            <Meter value={spend.monthJpy} max={hardLimit} marks={[{ at: budget.monthly_target_jpy, label: "目標" }]} />
            <p className="mt-1.5 text-xs text-muted">目標 {yen(budget.monthly_target_jpy)} ／ 緊急停止 {yen(budget.emergency_stop_jpy)}</p>
          </Link>
          <div className="card mt-2.5 flex items-center justify-between p-3.5">
            <div>
              <div className="text-xs text-muted">今月の収益</div>
              <div className="mt-1 text-[22px] font-bold">0円</div>
            </div>
            <span className="text-xs text-muted">収益の記録は Phase 4 で実装予定</span>
          </div>
        </Section>

        <Section title="社長からの報告">
          {president && (
            <Link href="/employees/president/chat" className="card flex gap-3 p-4 active:opacity-70">
              <Avatar color={president.avatar_color} styleId={president.avatar_style} size={44} label={president.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{president.name}</span>
                  {lastMsg && <span className="text-xs text-muted">{relativeTime(lastMsg.created_at)}</span>}
                </div>
                <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap text-ink/90">
                  {lastMsg ? lastMsg.content : "まだ報告はありません。社長に話しかけて、最初の仕事を依頼してみましょう。"}
                </p>
                <span className="mt-2 inline-block text-sm font-semibold text-brand">社長と話す ›</span>
              </div>
            </Link>
          )}
          <div className="mt-2">
            <PhaseNotice phase="Phase 2〜3">社長が自動で作成する日次・週次の報告書</PhaseNotice>
          </div>
        </Section>

        <Section title="進行中の業務" action={<Link href="/tasks" className="font-semibold text-brand">すべて見る</Link>}>
          {recentTasks.length === 0 ? (
            <div className="card px-4 py-6 text-center text-sm text-muted">
              進行中の業務はありません。
              <Link href="/tasks/new" className="mt-2 block font-semibold text-brand">
                業務を登録する
              </Link>
            </div>
          ) : (
            <ul className="card divide-y divide-line">
              {recentTasks.map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{t.title}</div>
                      <div className="mt-0.5 text-xs text-muted">担当: {t.assignee_name ?? "未定"}</div>
                    </div>
                    <TaskStatusBadge status={t.status} />
                    <ChevronRight />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Page>
    </>
  );
}
