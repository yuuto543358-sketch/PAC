import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { dateTime, yen } from "@/lib/format";
import { LIFE_PRIORITY_LABEL } from "@/lib/constants";
import type { LifeStats } from "@/lib/life/stats";
import { Page, PageHeader, Section } from "@/components/ui";
import { LifeChart } from "@/components/LifeChart";

export const metadata = { title: "分析レポート" };

export default async function LifeReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = await getDb();
  const [r] = await sql<{ id: string; period_months: number; stats: LifeStats; ai_summary: string; ai_used: boolean; created_at: Date }[]>`
    select id, period_months, stats, ai_summary, ai_used, created_at from life_reports where id = ${id}`;
  if (!r) notFound();
  const s = r.stats;
  const suggestions = await sql<{ id: string; title: string; priority: string }[]>`
    select id, title, priority from life_suggestions where report_id = ${id} order by created_at`;
  return (
    <>
      <PageHeader title={`直近${r.period_months}か月の分析`} subtitle={`${s.periodStart} 〜 ${s.periodEnd}`} back={`/life/reports?m=${r.period_months}`} backLabel="レポート" />
      <Page>
        <Section title={r.ai_used ? "森野のコメント" : "まとめ"}>
          <div className="card p-4 text-[15px] leading-relaxed whitespace-pre-wrap">{r.ai_summary}</div>
          <p className="mt-1.5 px-1 text-[11px] text-faint">
            {dateTime(r.created_at)} 作成。{r.ai_used ? "コメントはAIが書いたものです。数字は下の集計（事実）を見てください。" : "AIは使っていません。"}
          </p>
        </Section>

        <Section title="固定費（いまの値）">
          <div className="card p-4 text-[14px]">
            {s.fixedCosts.items.length === 0 ? (
              <p className="text-muted">固定費の情報がまだないため、計算できません。</p>
            ) : (
              <>
                {s.fixedCosts.items.map((i) => (
                  <div key={i.fieldId} className="flex justify-between py-0.5">
                    <span className="text-muted">{i.label}</span>
                    <span>{yen(i.value)}</span>
                  </div>
                ))}
                <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-bold">
                  <span>合計（分かっている分）</span>
                  <span>{yen(s.fixedCosts.total)}/月</span>
                </div>
              </>
            )}
            {s.fixedCosts.missing.length > 0 && <p className="mt-2 text-xs text-accent">まだ分からない：{s.fixedCosts.missing.join("・")}</p>}
          </div>
        </Section>

        {s.monthly.length > 0 && (
          <Section title="月ごとの推移">
            <div className="space-y-3">
              {s.monthly.map((m) => (
                <div key={m.fieldId} className="card p-4">
                  {m.series.length >= 2 ? (
                    <LifeChart
                      points={m.series.map((p) => ({ label: `${Number(p.month.slice(5))}月`, value: p.value }))}
                      kind="bar"
                      unit={m.unit}
                      title={m.label}
                    />
                  ) : (
                    <p className="text-[13px] font-semibold text-muted">{m.label}</p>
                  )}
                  <p className="mt-1.5 text-[13px] text-muted">
                    平均 {m.avg?.toLocaleString("ja-JP")}
                    {m.unit}
                    {m.changePct != null && `・最初の月から ${m.changePct > 0 ? "+" : ""}${m.changePct}%`}
                    {m.series.length < 2 && "・記録が1か月分だけなので、変化はまだ分かりません"}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {s.stateChanges.length > 0 && (
          <Section title="この期間に変わったこと">
            <ul className="card divide-y divide-separator text-[14px]">
              {s.stateChanges.map((c, i) => (
                <li key={i} className="px-4 py-2.5">
                  <span className="font-medium">{c.label}</span>：{c.from} → {c.to}
                  <span className="ml-1 text-[12px] text-muted">（{c.changedOn}）</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {s.exercise && (
          <Section title="運動（週ごとの回答）">
            <div className="card p-4 text-[14px]">
              <p>
                回答した週：{s.exercise.weeks}週・「ほぼしていない」の割合：{s.exercise.lowShare}%
              </p>
              <ul className="mt-1.5 text-[13px] text-muted">
                {Object.entries(s.exercise.counts).map(([k, v]) => (
                  <li key={k}>
                    {k}：{v}週
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}

        <Section title="足りない情報">
          {s.gaps.length === 0 ? (
            <p className="card p-4 text-[14px] text-muted">大事な情報はそろっています。</p>
          ) : (
            <div className="card p-4 text-[14px]">
              <p>{s.gaps.join("・")}</p>
              <p className="mt-1.5 text-xs text-muted">これらが分からないため、分析できない部分があります。森野が少しずつ質問します。</p>
            </div>
          )}
        </Section>

        {suggestions.length > 0 && (
          <Section title="このレポートから出た改善提案">
            <ul className="card divide-y divide-separator">
              {suggestions.map((x) => (
                <li key={x.id}>
                  <Link href={`/life/suggestions/${x.id}`} className="flex items-center justify-between gap-2 px-4 py-3">
                    <span className="truncate text-[15px] text-brand">{x.title}</span>
                    <span className="shrink-0 text-[12px] text-muted">優先度 {LIFE_PRIORITY_LABEL[x.priority]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Page>
    </>
  );
}
