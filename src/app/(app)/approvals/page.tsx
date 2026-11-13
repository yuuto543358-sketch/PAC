import Link from "next/link";
import { getDb } from "@/lib/db";
import { listApprovals } from "@/lib/repo/approvals";
import { APPROVAL_ACTION_LABEL } from "@/lib/constants";
import { dateTime, yen } from "@/lib/format";
import { ApprovalStatusBadge, ChevronRight, Empty, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "承認センター" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "closed" ? "closed" : "open";
  const sql = await getDb();
  const items = await listApprovals(sql, view);
  const pending = items.filter((a) => a.status === "pending").length;

  return (
    <>
      <PageHeader title="承認センター" subtitle={view === "open" ? `未確認 ${pending}件` : "処理済みの承認"} />
      <Page>
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
          <Link href="/approvals" className={`flex-1 rounded-lg py-2 text-center text-sm font-semibold ${view === "open" ? "bg-surface shadow-sm" : "text-muted"}`}>
            判断が必要
          </Link>
          <Link href="/approvals?view=closed" className={`flex-1 rounded-lg py-2 text-center text-sm font-semibold ${view === "closed" ? "bg-surface shadow-sm" : "text-muted"}`}>
            処理済み
          </Link>
        </div>
        <p className="px-1 text-xs text-muted">
          メール送信・投稿・購入など、外部に影響する操作は、ここで承認されるまで実行されません。承認は「内容・実行先・費用」に結びついた1件ごとの承認です。
        </p>
        {items.length === 0 ? (
          <Empty>{view === "open" ? "判断が必要な案件はありません。" : "処理済みの案件はまだありません。"}</Empty>
        ) : (
          <ul className="space-y-2">
            {items.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/approvals/${a.id}`}
                  className={`card flex items-center gap-3 p-3.5 active:opacity-70 ${a.status === "pending" ? "border-l-4 border-l-accent" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <ApprovalStatusBadge status={a.status} />
                      <span className="truncate text-xs text-muted">{APPROVAL_ACTION_LABEL[a.action_type]}</span>
                    </div>
                    <div className="mt-1.5 truncate text-[15px] font-semibold">{a.title}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {a.requester_name ?? "—"} ／ 費用 {yen(a.estimated_cost_jpy)} ／ {dateTime(a.created_at)}
                    </div>
                  </div>
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
