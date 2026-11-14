import { getDb } from "@/lib/db";
import { dateTime, todayJst, yen } from "@/lib/format";
import { listBusinessProjects } from "@/lib/repo/business";
import { ledgerTotals, listLedgerEntries } from "@/lib/repo/ledger";
import { Empty, Page, PageHeader, Section, Stat } from "@/components/ui";
import { LedgerEntryForm, VoidLedgerForm } from "./LedgerForms";

export const metadata = { title: "お金の記録" };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ business?: string }> }) {
  const sp = await searchParams;
  const sql = await getDb();
  const [entries, totals, businesses] = await Promise.all([
    listLedgerEntries(sql, { limit: 100 }),
    ledgerTotals(sql),
    listBusinessProjects(sql, { limit: 100 }),
  ]);
  const defaultBusiness = businesses.find((b) => b.id === sp.business)?.id;
  return (
    <>
      <PageHeader title="お金の記録" subtitle="入ったお金・出たお金" back="/finance" backLabel="財務" />
      <Page>
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label="今月 入ったお金" value={yen(totals.month.income)} sub={`これまで ${yen(totals.total.income)}`} icon="trend" />
          <Stat label="今月 出たお金" value={yen(totals.month.expense)} sub={`これまで ${yen(totals.total.expense)}`} icon="wallet" />
        </div>

        <Section title="新しく記録する">
          <div className="card p-4">
            <LedgerEntryForm today={todayJst()} businesses={businesses.map((b) => ({ id: b.id, name: b.name }))} defaultBusinessId={defaultBusiness} />
          </div>
          <p className="mt-2 px-1 text-xs leading-relaxed text-muted">
            売上や、材料・広告などに使ったお金を、あなたが記録します（AIは銀行やお店のサイトを見られないため）。AIの利用料は自動で記録されるので、ここには入れなくて大丈夫です。
          </p>
        </Section>

        <Section title="これまでの記録">
          {entries.length === 0 ? (
            <Empty icon="wallet">まだ記録はありません。</Empty>
          ) : (
            <ul className="card divide-y divide-separator">
              {entries.map((e) => (
                <li key={e.id} className={`px-4 py-3 ${e.voided_at ? "opacity-60" : ""}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">
                        {e.category}
                        {e.description && <span className="text-muted">・{e.description}</span>}
                      </span>
                      <span className="block text-[12px] text-muted">
                        {e.occurred_on}
                        {e.business_name && `・${e.business_name}`}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[16px] font-bold tabular ${e.voided_at ? "line-through" : e.kind === "income" ? "text-success" : "text-ink"}`}>
                      {e.kind === "income" ? "+" : "−"}
                      {yen(e.amount_jpy)}
                    </span>
                  </div>
                  {e.voided_at ? (
                    <p className="mt-1 text-[12px] text-danger">
                      取り消し済み（{dateTime(e.voided_at)}）：{e.void_reason}
                    </p>
                  ) : (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] text-faint">間違えたときは</summary>
                      <VoidLedgerForm id={e.id} />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Page>
    </>
  );
}
