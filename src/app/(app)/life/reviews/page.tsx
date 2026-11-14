import Link from "next/link";
import { getDb } from "@/lib/db";
import { Empty, Page, PageHeader } from "@/components/ui";
import { RunReviewButton } from "../QolForms";

export const metadata = { title: "週のふりかえり" };
export const maxDuration = 300;

export default async function ReviewsPage() {
  const sql = await getDb();
  const rows = await sql<{ id: string; week_start: string; week_end: string; ai_summary: string; ai_used: boolean }[]>`
    select id, to_char(week_start, 'YYYY-MM-DD') as week_start, to_char(week_end, 'YYYY-MM-DD') as week_end, ai_summary, ai_used
    from life_reviews order by created_at desc limit 30`;
  return (
    <>
      <PageHeader title="週のふりかえり" subtitle="担当：ライフ担当 森野 結" back="/life" backLabel="ライフ" />
      <Page>
        <div className="card space-y-2 p-4">
          <p className="text-[14px] leading-relaxed">毎週月曜の朝に、森野が先週の暮らし（チェック・習慣・目標・予定）をふりかえって、来週の小さな一歩を書きます。</p>
          <RunReviewButton />
        </div>
        {rows.length === 0 ? (
          <Empty icon="report">まだふりかえりはありません。</Empty>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/life/reviews/${r.id}`} className="card press block p-4">
                  <p className="text-[12px] font-semibold text-brand">
                    {r.week_start} 〜 {r.week_end}
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
