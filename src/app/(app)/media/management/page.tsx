import Link from "next/link";
import { getDb } from "@/lib/db";
import { getBudget, getSettings } from "@/lib/repo/settings";
import { dashboardNumbers, JOB_KIND_LABEL, listJobs } from "@/lib/mediaco/repo";
import { getBudgetTier, TIER_LABEL } from "@/lib/mediaco/budget";
import { dateTime, yen } from "@/lib/format";
import { Alert, Meter, Page, PageHeader, Section } from "@/components/ui";
import { MediaSettingsForm, RunNowButton } from "../MediaForms";

export default async function ManagementPage() {
  const sql = await getDb();
  const [settings, budget, n, tier, jobs, reports, byPurpose] = await Promise.all([
    getSettings(sql),
    getBudget(sql),
    dashboardNumbers(sql),
    getBudgetTier(sql),
    listJobs(sql, 40),
    sql<{ id: string; report_type: string; title: string; content: string; created_at: Date }[]>`
      select id, report_type, title, content, created_at from reports where report_type in ('media_weekly','media_monthly')
      order by created_at desc limit 6`,
    sql<{ purpose: string; jpy: number; calls: number }[]>`
      select purpose, coalesce(sum(coalesce(cost_jpy, estimated_cost_jpy)), 0)::float8 as jpy, count(*)::int as calls from api_usage
      where purpose like 'media:%' and created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'
      group by purpose order by jpy desc`,
  ]);
  const alloc = settings.budget_allocation ?? { ai: 2500, research: 1000, other: 500, reserve: 1000 };
  const totalUsed = Math.round(n.monthApi + n.monthLedgerExpense);
  return (
    <>
      <PageHeader title="経営管理" back="/more" backLabel="メニュー" />
      <Page>
        <Section title="今月のお金">
          <div className="card grid grid-cols-2 gap-px overflow-hidden bg-separator text-center">
            {[
              ["売上（記録）", yen(n.monthRevenue)],
              ["経費（AI＋記録）", yen(Math.round(n.monthExpense))],
              ["利益（相当）", yen(Math.round(n.monthProfit))],
              ["累計の売上", yen(n.totalRevenue)],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface px-2 py-3">
                <span className="block text-[12px] text-muted">{k}</span>
                <span className="tabular block text-[18px] font-bold">{v}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 px-1 text-xs text-muted">
            売上は、あなたが記録した数字だけです（記事の画面・お金の記録）。AIの利用料のうち {yen(Math.round(n.monthApiEstimated))} は、使用量が分からなかったため見積額（多め）で数えています。
            <Link href="/finance/ledger" className="tap ml-1 text-brand">お金の記録</Link>
          </p>
        </Section>

        <Section title="月の予算">
          <div className="card space-y-3 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-semibold">事業全体</span>
              <span className="tabular text-[14px]">
                {yen(totalUsed)} ／ {yen(settings.business_budget_jpy)}
              </span>
            </div>
            <Meter value={Math.min(totalUsed, settings.business_budget_jpy)} max={settings.business_budget_jpy} />
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-semibold">AIの利用料</span>
              <span className="tabular text-[14px]">
                {yen(Math.round(tier.monthJpy))} ／ {yen(tier.limitJpy)}（{Math.round(tier.ratio * 100)}%）
              </span>
            </div>
            <Meter value={Math.min(tier.monthJpy, tier.limitJpy)} max={tier.limitJpy} marks={[{ at: tier.limitJpy * 0.8, label: "80%" }, { at: tier.limitJpy * 0.95, label: "95%" }]} />
            <p className="text-[13px]">いまの状態：<b>{TIER_LABEL[tier.tier]}</b>（今日 {yen(Math.round(tier.todayJpy))}／1日の上限 {yen(budget.daily_limit_jpy)}）</p>
            <p className="text-xs text-muted">
              配分：AI {yen(alloc.ai)}・調査や追加サービス {yen(alloc.research)}・その他 {yen(alloc.other)}・予備 {yen(alloc.reserve)}。80%で安いモデル、95%で大事でない仕事（新しい記事の企画・Xの投稿案・市場調査の更新）を止め、100%でAIを止めます。
              <Link href="/settings#budget" className="tap ml-1 text-brand">上限を変える</Link>
            </p>
            {tier.tier !== "normal" && <Alert tone="warn">{TIER_LABEL[tier.tier]}</Alert>}
          </div>
        </Section>

        <Section title="AIの利用料（メディアの仕事別・今月）">
          {byPurpose.length === 0 ? (
            <p className="card px-4 py-3.5 text-[14px] text-muted">今月はまだ使っていません。</p>
          ) : (
            <ul className="card divide-y divide-separator text-[14px]">
              {byPurpose.map((p) => (
                <li key={p.purpose} className="flex justify-between gap-2 px-4 py-2.5">
                  <span className="min-w-0 truncate">{JOB_KIND_LABEL[p.purpose.replace(/^media:/, "")] ?? p.purpose.replace(/^media:/, "")}</span>
                  <span className="tabular shrink-0">{p.jpy.toFixed(1)}円（{p.calls}回）</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="経営レポート・改善提案">
          <div className="space-y-3">
            {settings.media_insights && (
              <div className="card p-4">
                <p className="text-[12px] font-semibold text-brand">経営分析部から、次の記事づくりへの改善点</p>
                <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap">{settings.media_insights}</p>
              </div>
            )}
            {reports.length === 0 ? (
              <p className="card px-4 py-3.5 text-[14px] text-muted">週の分析（月曜）と月の経営会議（毎月1日）の報告が、ここに並びます。</p>
            ) : (
              reports.map((r) => (
                <details key={r.id} className="card overflow-hidden">
                  <summary className="cursor-pointer px-4 py-3.5 text-[15px] font-semibold">
                    {r.title}
                    <span className="block text-[12px] font-normal text-muted">{dateTime(r.created_at)}</span>
                  </summary>
                  <p className="border-t border-separator px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap">{r.content}</p>
                </details>
              ))
            )}
          </div>
        </Section>

        <Section title="自動実行の設定">
          <div className="card space-y-3 p-4">
            <MediaSettingsForm initial={settings} />
            <RunNowButton />
          </div>
        </Section>

        <Section title="実行の記録">
          <ol id="jobs" className="card divide-y divide-separator">
            {jobs.length === 0 && <li className="px-4 py-3.5 text-[14px] text-muted">まだありません。</li>}
            {jobs.map((j) => (
              <li key={j.id} className="px-4 py-3 text-[14px]">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{JOB_KIND_LABEL[j.kind] ?? j.kind}</span>
                  <span className={`shrink-0 text-[12px] ${j.status === "failed" ? "text-danger" : j.status === "running" ? "text-accent" : "text-muted"}`}>
                    {j.status === "done" ? "完了" : j.status === "failed" ? "失敗" : j.status === "running" ? "実行中" : "見送り"}
                  </span>
                </span>
                <span className="block text-[13px] text-ink/80">{j.status === "failed" ? j.error : j.summary}</span>
                <span className="block text-[12px] text-muted">
                  {j.department}・{j.employee_name ?? ""}・開始 {dateTime(j.started_at)}
                  {j.finished_at && `・終了 ${dateTime(j.finished_at)}`}・{j.cost_jpy.toFixed(1)}円
                </span>
              </li>
            ))}
          </ol>
        </Section>
      </Page>
    </>
  );
}
