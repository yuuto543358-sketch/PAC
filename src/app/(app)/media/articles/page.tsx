import Link from "next/link";
import { getDb } from "@/lib/db";
import { ARTICLE_STATUS_LABEL, listArticles } from "@/lib/mediaco/repo";
import { yen } from "@/lib/format";
import { ChevronRight, Empty, Page, PageHeader, SegmentedLinks } from "@/components/ui";

const TABS = [
  { key: "all", label: "すべて" },
  { key: "ready", label: "公開待ち" },
  { key: "published", label: "公開済み" },
  { key: "working", label: "作成中" },
];
const WORKING = ["planned", "researched", "drafted", "checked"];

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "all" } = await searchParams;
  const sql = await getDb();
  const all = await listArticles(sql, { limit: 200 });
  const list =
    status === "ready" ? all.filter((a) => a.status === "ready")
    : status === "published" ? all.filter((a) => a.status === "published")
    : status === "working" ? all.filter((a) => WORKING.includes(a.status))
    : all;
  return (
    <>
      <PageHeader title="記事" subtitle={`${all.length}本`} />
      <Page>
        <SegmentedLinks items={TABS.map((t) => ({ ...t, href: t.key === "all" ? "/media/articles" : `/media/articles?status=${t.key}` }))} active={TABS.some((t) => t.key === status) ? status : "all"} />
        {list.length === 0 ? (
          <Empty icon="document">ここに出る記事はまだありません。</Empty>
        ) : (
          <ul className="card divide-y divide-separator overflow-hidden">
            {list.map((a) => (
              <li key={a.id}>
                <Link href={`/media/articles/${a.id}`} className="press flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{a.title || a.theme}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {ARTICLE_STATUS_LABEL[a.status] ?? a.status}・{a.kind === "paid" ? yen(a.price_jpy) : "無料"}
                      {a.quality_score != null && `・品質${a.quality_score}点`}
                      {a.status === "published" && `・閲覧${a.views}・販売${a.sales}・${yen(a.revenue_jpy)}`}
                    </span>
                  </span>
                  <ChevronRight />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </>
  );
}
