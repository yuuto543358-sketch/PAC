import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/repo/settings";
import { countPendingApprovals } from "@/lib/repo/approvals";
import { listEmployees } from "@/lib/repo/employees";
import { greeting, longDate, relativeTime, yen } from "@/lib/format";
import { dashboardNumbers, getActiveBrand, JOB_KIND_LABEL, listJobs } from "@/lib/mediaco/repo";
import { getBudgetTier, TIER_LABEL } from "@/lib/mediaco/budget";
import { EmployeeGrid } from "@/components/EmployeeGrid";
import { Icon } from "@/components/Icon";
import { Alert, ChevronRight, Meter, Page, Section } from "@/components/ui";
import { RunNowButton } from "./media/MediaForms";

// ホーム：AI Media Company のダッシュボード（数字はすべてデータベースの集計。売上は経営者が記録したもの）

const GOALS = [10_000, 30_000, 50_000];

// 「今すぐAI社員を動かす」のあと、裏で仕事を進める時間（最大5分）
export const maxDuration = 300;

export default async function HomePage() {
  const sql = await getDb();
  const [settings, n, budget, brand, pending, employees, jobs] = await Promise.all([
    getSettings(sql),
    dashboardNumbers(sql),
    getBudgetTier(sql),
    getActiveBrand(sql),
    countPendingApprovals(sql),
    listEmployees(sql),
    listJobs(sql, 8),
  ]);
  const goal = GOALS.find((g) => n.monthRevenue < g) ?? GOALS[GOALS.length - 1];
  const yourTurn = pending + n.articles.ready;
  const runningByEmployee = new Map(jobs.filter((j) => j.status === "running").map((j) => [j.employee_id, j]));
  const lastByEmployee = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) if (j.employee_id && !lastByEmployee.has(j.employee_id)) lastByEmployee.set(j.employee_id, j);

  return (
    <>
      <header className="pt-safe relative overflow-hidden bg-gradient-to-br from-brand-deep via-[#1d3a99] to-[#3157d0] text-white">
        <div className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative mx-auto max-w-2xl px-5 pt-4 pb-16">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-white/75">{longDate()}</p>
            <Link href="/settings" className="tap press flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-white/90" aria-label="設定">
              <Icon name="settings" size={20} />
            </Link>
          </div>
          <p className="mt-2 text-[15px] text-white/85">{greeting()}。AI社員がメディアを運営しています。</p>
          <h1 className="mt-0.5 text-[24px] leading-tight font-bold tracking-tight">{settings.company_name}</h1>
          <p className="mt-1 text-[13px] text-white/70">{brand ? `運営中：${brand.name}（${brand.genre}）` : "AIが市場を調べて、運営するジャンルを決めます"}</p>
        </div>
      </header>

      <Page className="-mt-12 relative" tight>
        {settings.emergency_stop && (
          <Link href="/settings" className="press block">
            <Alert tone="error">緊急停止中：AIの呼び出しをすべて止めています（AI社員は動きません）。設定で解除できます。</Alert>
          </Link>
        )}
        {/* ===== 今月の売上と目標 ===== */}
        <Link href="/media/management" className="card press block p-4 shadow-float">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-medium text-muted">今月の売上</span>
            <span className="text-[12px] text-muted">目標 {yen(goal)}</span>
          </div>
          <div className="tabular mt-0.5 text-[30px] leading-tight font-bold tracking-tight">{yen(n.monthRevenue)}</div>
          <div className="mt-2">
            <Meter value={Math.min(n.monthRevenue, goal)} max={goal} />
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x divide-separator text-center">
            <div className="px-1">
              <span className="block text-[11px] text-muted">今月の経費</span>
              <span className="tabular block text-[15px] font-semibold">{yen(Math.round(n.monthExpense))}</span>
            </div>
            <div className="px-1">
              <span className="block text-[11px] text-muted">利益（相当）</span>
              <span className={`tabular block text-[15px] font-semibold ${n.monthProfit < 0 ? "text-danger" : "text-success"}`}>{yen(Math.round(n.monthProfit))}</span>
            </div>
            <div className="px-1">
              <span className="block text-[11px] text-muted">累計の売上</span>
              <span className="tabular block text-[15px] font-semibold">{yen(n.totalRevenue)}</span>
            </div>
          </div>
        </Link>

        {/* ===== あなたの番 ===== */}
        <section aria-label="あなたの番" className="card overflow-hidden">
          <h2 className="px-4 pt-3 pb-1 text-[13px] font-semibold tracking-wide text-muted">{yourTurn ? `あなたの番（${yourTurn}件）` : "あなたの番"}</h2>
          {yourTurn === 0 ? (
            <p className="px-4 pb-3.5 text-[14px] text-muted">いまは、あなたの作業はありません。AI社員が進めています。</p>
          ) : (
            <ul className="divide-y divide-separator">
              {n.articles.ready > 0 && (
                <li>
                  <Link href="/media/articles?status=ready" className="press flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#0f766e]/12 text-[#0f766e]">
                      <Icon name="document" size={20} stroke={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">noteに公開する記事</span>
                      <span className="block text-[12px] text-muted">コピーして note に貼り、URLを記録</span>
                    </span>
                    <span className="rounded-full bg-[#0f766e] px-2.5 py-0.5 text-[13px] font-bold text-white">{n.articles.ready}本</span>
                    <ChevronRight />
                  </Link>
                </li>
              )}
              {pending > 0 && (
                <li>
                  <Link href="/approvals" className="press flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#c2410c]/12 text-[#c2410c]">
                      <Icon name="approve" size={20} stroke={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">承認待ち（Xの投稿案など）</span>
                      <span className="block text-[12px] text-muted">承認したら「Xで開く」で投稿</span>
                    </span>
                    <span className="rounded-full bg-danger px-2.5 py-0.5 text-[13px] font-bold text-white">{pending}件</span>
                    <ChevronRight />
                  </Link>
                </li>
              )}
            </ul>
          )}
        </section>

        {/* ===== 記事とAIの費用 ===== */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/media/articles" className="card press block p-3.5">
            <span className="block text-[12px] font-medium text-muted">記事</span>
            <span className="tabular block text-[22px] font-bold">{n.articles.total}本</span>
            <span className="block text-[12px] text-muted">公開 {n.articles.published}・作成中 {n.articles.in_progress}・販売 {n.articles.sales}件</span>
          </Link>
          <Link href="/media/management" className="card press block p-3.5">
            <span className="block text-[12px] font-medium text-muted">今月のAI利用料</span>
            <span className="tabular block text-[22px] font-bold">{yen(Math.round(budget.monthJpy))}</span>
            <span className="block text-[12px] text-muted">
              残り {yen(Math.max(0, Math.round(budget.limitJpy - budget.monthJpy)))}・{TIER_LABEL[budget.tier]}
            </span>
          </Link>
        </div>
        {budget.tier !== "normal" && (
          <Alert tone={budget.tier === "stopped" ? "error" : "warn"}>AIの予算が{Math.round(budget.ratio * 100)}%に達しています：{TIER_LABEL[budget.tier]}</Alert>
        )}

        {/* ===== 部署の稼働状況 ===== */}
        <Section title="部署の稼働状況" action={<Link href="/employees" className="font-medium text-brand">社員</Link>}>
          <EmployeeGrid
            label="部署の稼働状況"
            fit="screen"
            employees={employees.map((e) => {
              const running = runningByEmployee.get(e.id);
              const last = lastByEmployee.get(e.id);
              return {
                ...e,
                detail: running
                  ? JOB_KIND_LABEL[running.kind] ?? running.kind
                  : last
                    ? `最後：${JOB_KIND_LABEL[last.kind] ?? last.kind}（${relativeTime(last.started_at)}）`
                    : undefined,
              };
            })}
          />
        </Section>

        {/* ===== 直近の活動 ===== */}
        <Section title="直近の活動" action={<Link href="/media/management#jobs" className="font-medium text-brand">すべて見る</Link>}>
          {jobs.length === 0 ? (
            <div className="card space-y-3 p-4">
              <p className="text-[14px] text-muted">まだ活動はありません。AI社員は1日4回、自動で動きます。すぐに始めるときは、下のボタンを押してください。</p>
              <RunNowButton />
            </div>
          ) : (
            <ol className="card divide-y divide-separator">
              {jobs.slice(0, 3).map((j) => (
                <li key={j.id} className="flex gap-3 px-4 py-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${j.status === "done" ? "bg-success" : j.status === "failed" ? "bg-danger" : "bg-accent"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-snug">
                      <span className="font-semibold">{j.department}</span>：{j.summary || JOB_KIND_LABEL[j.kind] || j.kind}
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {j.status === "failed" ? `失敗：${j.error}` : relativeTime(j.started_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <nav aria-label="メディア事業" className="grid grid-cols-3 gap-2">
          {[
            { href: "/media/research", label: "市場調査", icon: "search" as const, color: "#1d4ed8" },
            { href: "/media/brand", label: "メディア", icon: "star" as const, color: "#7c3aed" },
            { href: "/media/sns", label: "X運営", icon: "send" as const, color: "#0ea5e9" },
          ].map((q) => (
            <Link key={q.href} href={q.href} className="press flex flex-col items-center gap-1.5 py-1">
              <span className="flex h-12 w-12 items-center justify-center rounded-[16px] text-white shadow-card" style={{ background: q.color }}>
                <Icon name={q.icon} size={24} stroke={2} />
              </span>
              <span className="text-[12px] font-medium text-ink/85">{q.label}</span>
            </Link>
          ))}
        </nav>
      </Page>
    </>
  );
}
