import { getDb } from "@/lib/db";
import { listGenres, listResearchRuns } from "@/lib/mediaco/repo";
import { SCORE_ITEMS } from "@/lib/mediaco/schemas";
import { dateTime } from "@/lib/format";
import { Empty, Page, PageHeader, Section } from "@/components/ui";
import { SourceList } from "@/components/SourceList";
import { RunNowButton } from "../MediaForms";

const RUN_KIND: Record<string, string> = { initial: "はじめの市場調査", weekly: "毎週の更新", rerun: "ジャンルの見直し" };
const RUN_STATUS: Record<string, string> = { screening: "調査中", deep: "深掘り中", selected: "ジャンル決定", done: "完了", failed: "失敗" };

// 「今すぐAI社員を動かす」のあと、裏で仕事を進める時間（最大5分）
export const maxDuration = 300;

export default async function ResearchPage() {
  const sql = await getDb();
  const runs = await listResearchRuns(sql, 10);
  const main = runs.find((r) => r.kind !== "weekly") ?? runs[0];
  const genres = main ? await listGenres(sql, main.id) : [];
  const deep = genres.filter((g) => g.stage === "deep");
  const screened = genres.filter((g) => g.stage === "screened");
  const weekly = runs.filter((r) => r.kind === "weekly");

  return (
    <>
      <PageHeader title="市場調査" back="/more" backLabel="メニュー" />
      <Page>
        <p className="px-1 text-[14px] leading-relaxed text-muted">
          市場調査部が複数のジャンルを調べ、100点満点（読者需要20・有料需要20・差別化15・テーマの豊富さ15・AI制作との相性10・集客10・運営コスト10）で評価します。上位3つを深く調べ、点数がいちばん高い1つを選びます。
        </p>
        {!main ? (
          <div className="card space-y-3 p-4">
            <Empty icon="search">まだ調査していません。</Empty>
            <RunNowButton label="市場調査を始める" />
          </div>
        ) : (
          <>
            <div className="card p-4">
              <p className="text-[13px] text-muted">
                {RUN_KIND[main.kind] ?? main.kind}・{RUN_STATUS[main.status] ?? main.status}・{dateTime(main.started_at)}
              </p>
              {main.summary && <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap">{main.summary}</p>}
            </div>

            {deep.length > 0 && (
              <Section title="深掘りした上位3ジャンル">
                <div className="space-y-3">
                  {deep.map((g) => (
                    <article key={g.id} className={`card p-4 ${g.selected ? "ring-2 ring-brand" : ""}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <h2 className="text-[17px] font-bold">
                          {g.name}
                          {g.selected && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-brand-fg">選定</span>}
                        </h2>
                        <span className="tabular text-[22px] font-bold">{g.total}点</span>
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                        {SCORE_ITEMS.map((it) => (
                          <div key={it.key} className="flex justify-between">
                            <dt className="text-muted">{it.label}</dt>
                            <dd className="tabular font-semibold">
                              {g.scores?.[it.key] ?? 0}/{it.max}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {g.reason && <p className="mt-2 text-[14px] leading-relaxed">{g.reason}</p>}
                      <details className="mt-1">
                        <summary className="cursor-pointer py-3 text-[14px] font-semibold text-brand">調査の根拠・競合を見る</summary>
                        <div className="space-y-2 text-[13px] leading-relaxed">
                          {[
                            ["需要の根拠", g.demand_evidence],
                            ["読者の悩み", g.reader_pains],
                            ["競合", g.competitors],
                            ["有料の需要", g.paid_demand],
                            ["収益化の方法", g.monetization],
                            ["確認できた事実", g.facts],
                            ["推測", g.guesses],
                          ].map(([k, v]) => (v ? <p key={k}><b>{k}：</b>{v}</p> : null))}
                          <p className="text-muted">調査日：{g.researched_on}</p>
                          {g.sources?.length > 0 && <SourceList sources={g.sources} />}
                        </div>
                      </details>
                    </article>
                  ))}
                </div>
              </Section>
            )}

            {screened.length > 0 && (
              <Section title={`調べたジャンル（${screened.length}）`}>
                <ul className="card divide-y divide-separator">
                  {screened.map((g, i) => (
                    <li key={g.id} className="flex items-center justify-between gap-2 px-4 py-3">
                      <span className="min-w-0 truncate text-[15px]">
                        <span className="tabular mr-2 text-muted">{i + 1}.</span>
                        {g.name}
                      </span>
                      <span className="tabular shrink-0 font-semibold">{g.total}点</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}

        {weekly.length > 0 && (
          <Section title="毎週の市場調査の更新">
            <ul className="card divide-y divide-separator">
              {weekly.map((r) => (
                <li key={r.id} className="px-4 py-3 text-[14px]">
                  <span className="block text-[12px] text-muted">{dateTime(r.started_at)}</span>
                  {r.summary || RUN_STATUS[r.status]}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Page>
    </>
  );
}
