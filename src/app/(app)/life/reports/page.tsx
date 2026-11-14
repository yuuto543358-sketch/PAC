import Link from "next/link";
import { getDb } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { Empty, Page, PageHeader, SegmentedLinks } from "@/components/ui";
import { RunAnalysisButton } from "../LifeForms";

export const metadata = { title: "分析レポート" };
export const maxDuration = 300;

const TABS = [
  { key: "1", label: "月次" },
  { key: "3", label: "3か月" },
  { key: "6", label: "6か月" },
  { key: "12", label: "年次" },
];

export default async function LifeReportsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const m = TABS.some((t) => t.key === sp.m) ? Number(sp.m) : 1;
  const sql = await getDb();
  const reports = await sql<{ id: string; ai_summary: string; ai_used: boolean; created_at: Date; period_start: string; period_end: string }[]>`
    select id, ai_summary, ai_used, created_at, to_char(period_start, 'YYYY-MM-DD') as period_start, to_char(period_end, 'YYYY-MM-DD') as period_end
    from life_reports where period_months = ${m} order by created_at desc limit 30`;
  return (
    <>
      <PageHeader title="分析レポート" back="/life" backLabel="ライフ" />
      <Page>
        <SegmentedLinks items={TABS.map((t) => ({ ...t, href: `/life/reports?m=${t.key}` }))} active={String(m)} />
        <div className="card space-y-2 p-4">
          <p className="text-[14px] leading-relaxed">
            森野が、直近{m}か月の生活情報を分析します。数字はプログラムが計算した事実で、森野はそれを読んでコメントと改善提案を書きます。
          </p>
          <RunAnalysisButton months={m} />
          <p className="text-xs text-muted">自動の分析は、毎月1日（3か月・6か月・年次は、それぞれの区切りの月）に行います。記録がないときはAIを使いません。</p>
        </div>
        {reports.length === 0 ? (
          <Empty icon="report">まだこの期間のレポートはありません。</Empty>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/life/reports/${r.id}`} className="card press block p-4">
                  <p className="text-[12px] font-semibold text-brand">
                    {r.period_start} 〜 {r.period_end}・{dateTime(r.created_at)}
                    {!r.ai_used && <span className="ml-1 text-muted">（数字のみ）</span>}
                  </p>
                  <p className="mt-1 line-clamp-3 text-[14px] leading-relaxed whitespace-pre-wrap">{r.ai_summary}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </>
  );
}
