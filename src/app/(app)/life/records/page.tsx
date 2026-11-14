import Link from "next/link";
import { getDb } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { LIFE_SOURCE_LABEL } from "@/lib/constants";
import { lifeOverview } from "@/lib/life/overview";
import { formatRecordValue } from "@/lib/life/repo";
import { Page, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "生活情報" };

export default async function LifeRecordsPage() {
  const sql = await getDb();
  const o = await lifeOverview(sql);
  const staleIds = new Set(o.stale.map((c) => c.field.id));
  return (
    <>
      <PageHeader title="生活情報" subtitle={`${o.filledFields} / ${o.totalFields} 項目`} back="/life" backLabel="ライフ" />
      <Page>
        {o.categories.map((c) => {
          const fields = o.fields.filter((f) => f.category_id === c.id && f.is_active);
          if (fields.length === 0) return null;
          return (
            <Section key={c.id} title={`${c.name}${c.is_active ? "" : "（使っていません）"}`}>
              <ul className="card divide-y divide-separator">
                {fields.map((f) => {
                  const r = o.latest.get(f.id);
                  return (
                    <li key={f.id}>
                      <Link href={`/life/records/${f.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block truncate text-[15px]">{f.label}</span>
                          <span className="block text-[12px] text-muted">
                            {r ? `${relativeTime(r.confirmed_at)}・${LIFE_SOURCE_LABEL[r.source]}` : "まだ分かりません"}
                            {staleIds.has(f.id) && <span className="ml-1 font-semibold text-accent">更新が必要</span>}
                            {r?.source === "ai_estimate" && <span className="ml-1 font-semibold text-accent">推定</span>}
                          </span>
                        </span>
                        <span className={`max-w-[45%] shrink-0 truncate text-right text-[15px] ${r ? "font-semibold" : "text-faint"}`}>
                          {r ? formatRecordValue(f, r) : "—"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })}
        <p className="px-1 text-xs text-muted">「本人の回答」と「AIの推定」は区別して表示します。分からない情報を、AIが勝手に数字で埋めることはありません。</p>
      </Page>
    </>
  );
}
