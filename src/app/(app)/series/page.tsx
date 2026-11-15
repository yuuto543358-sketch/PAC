import Link from "next/link";
import { getDb } from "@/lib/db";
import { listSeries } from "@/lib/series";
import { productByFormat } from "@/lib/workflow/product";
import { Page, PageHeader, Section } from "@/components/ui";
import { SeriesControls } from "./SeriesControls";

export default async function SeriesPage() {
  const sql = await getDb();
  const series = await listSeries(sql);
  const episodes = series.length
    ? await sql<{ series_id: string; id: string; title: string; series_episode: number | null; status: string; phase: string | null }[]>`
        select t.series_id, t.id, t.title, t.series_episode, t.status, w.phase from tasks t
        left join task_workflows w on w.task_id = t.id
        where t.series_id in ${sql(series.map((s) => s.id))}
        order by t.series_episode desc nulls last, t.created_at desc`
    : [];
  return (
    <>
      <PageHeader title="シリーズ" back="/more" backLabel="メニュー" />
      <Page>
        <p className="px-1 text-[14px] leading-relaxed text-muted">
          動画やnote記事を承認すると、そこで終わりにせず、チームが次の回を自動で作り続けます。作っている途中の回があるときや、承認待ちが2本たまったときは、次の回を待ちます。投稿・公開は、これまでどおりあなたが行います。
        </p>
        {series.length === 0 ? (
          <p className="card px-4 py-3.5 text-[14px] text-muted">
            まだシリーズはありません。社長に「〇〇の動画を作って」と頼み、できた動画を承認すると、ここに並びます。
          </p>
        ) : (
          series.map((s) => {
            const list = episodes.filter((e) => e.series_id === s.id);
            return (
              <Section key={s.id} title={`${productByFormat(s.product_format)?.label ?? s.product_format}のシリーズ`}>
                <div className="card space-y-3 p-4">
                  <div>
                    <h2 className="text-[17px] leading-snug font-bold">{s.title}</h2>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {s.active ? `${s.interval_days}日ごとに作る・次の回は ${s.next_run_on ?? "未定"} ごろ` : "止めています"}・これまで{s.episodes}回
                    </p>
                  </div>
                  <SeriesControls id={s.id} active={s.active} intervalDays={s.interval_days} />
                  {list.length > 0 && (
                    <ul className="divide-y divide-separator rounded-[14px] bg-surface-2/60">
                      {list.slice(0, 8).map((e) => (
                        <li key={e.id}>
                          <Link href={`/tasks/${e.id}`} className="flex min-h-11 items-center justify-between gap-2 px-3 py-2.5 text-[14px]">
                            <span className="min-w-0 truncate">第{e.series_episode ?? "?"}回：{e.title}</span>
                            <span className="shrink-0 text-[12px] text-muted">
                              {e.status === "completed" ? "完了" : e.phase === "waiting_human" ? "承認待ち" : "作成中"}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Section>
            );
          })
        )}
      </Page>
    </>
  );
}
