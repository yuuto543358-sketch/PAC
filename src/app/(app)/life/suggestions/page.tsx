import Link from "next/link";
import { getDb } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { LIFE_PRIORITY_LABEL, LIFE_SUGGESTION_STATUSES, LIFE_SUGGESTION_STATUS_LABEL } from "@/lib/constants";
import { countSuggestionsByStatus, listSuggestions } from "@/lib/life/suggestions";
import { Empty, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "改善提案" };

export default async function LifeSuggestionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = (LIFE_SUGGESTION_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "new";
  const sql = await getDb();
  const [items, counts] = await Promise.all([listSuggestions(sql, status), countSuggestionsByStatus(sql)]);
  return (
    <>
      <PageHeader title="改善提案" back="/life" backLabel="ライフ" />
      <Page>
        <div className="-mx-4 overflow-x-auto px-4">
          <div className="flex gap-1.5">
            {LIFE_SUGGESTION_STATUSES.map((s) => (
              <Link
                key={s}
                href={`/life/suggestions?status=${s}`}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold ${status === s ? "bg-brand text-brand-fg" : "bg-surface-3 text-muted"}`}
              >
                {LIFE_SUGGESTION_STATUS_LABEL[s]} {counts[s] ?? 0}
              </Link>
            ))}
          </div>
        </div>
        {items.length === 0 ? (
          <Empty icon="sparkles">この状態の提案はありません。</Empty>
        ) : (
          <ul className="space-y-3">
            {items.map((s) => (
              <li key={s.id}>
                <Link href={`/life/suggestions/${s.id}`} className="card press block p-4">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className={`rounded-full px-2 py-px font-semibold ${s.priority === "high" ? "bg-accent-soft text-accent" : "bg-surface-3 text-muted"}`}>
                      優先度 {LIFE_PRIORITY_LABEL[s.priority]}
                    </span>
                    {s.is_estimate && <span className="rounded-full bg-surface-3 px-2 py-px font-semibold text-muted">推測を含む</span>}
                    {s.category_name && <span className="text-muted">{s.category_name}</span>}
                  </div>
                  <p className="mt-1 text-[16px] font-semibold">{s.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{s.problem}</p>
                  <p className="mt-1 text-[11px] text-faint">{dateTime(s.created_at)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </>
  );
}
