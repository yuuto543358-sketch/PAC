import Link from "next/link";
import { getDb } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { REPORT_TYPE_LABEL } from "@/lib/constants";
import { getSettings } from "@/lib/repo/settings";
import { Empty, Page, PageHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { DocumentView } from "@/components/DocumentView";
import { ReportNowButtons } from "../business/BusinessActions";

export const metadata = { title: "報告書" };
export const maxDuration = 300;

type ReportRow = { id: string; report_type: string; title: string; content: string; task_id: string | null; created_at: Date };

export default async function ReportsPage() {
  const sql = await getDb();
  const [reports, settings] = await Promise.all([
    sql<ReportRow[]>`
      select id, report_type, title, content, task_id, created_at from reports order by created_at desc limit 50`,
    getSettings(sql),
  ]);
  const autoLabel =
    settings.autorun_frequency === "daily" ? "毎日（月曜は週報も）" : settings.autorun_frequency === "weekly" ? "毎週月曜" : "停止中";
  return (
    <>
      <PageHeader title="報告書" subtitle={`${reports.length}件`} back="/more" backLabel="メニュー" />
      <Page>
        <div className="card space-y-3 p-4">
          <p className="text-[14px] leading-relaxed">
            社長の<b>天城 翔</b>が、会社の様子をまとめて報告します。数字はシステムが自動で集計した事実です。
          </p>
          <ReportNowButtons />
          <p className="text-xs text-muted">
            1回 約1円。自動の報告：<b className="text-ink">{autoLabel}</b>
            <Link href="/settings#autorun" className="ml-1 font-semibold text-brand">
              設定を変える
            </Link>
          </p>
        </div>
        {reports.length === 0 ? (
          <Empty icon="report">まだ報告書はありません。上のボタンで作るか、チームが業務を完了すると、ここに保存されます。</Empty>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id}>
                <details className="card group overflow-hidden">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand">
                      <Icon name="report" size={20} stroke={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-brand">{REPORT_TYPE_LABEL[r.report_type] ?? r.report_type}</span>
                      <span className="block truncate text-[15px] font-semibold">{r.title}</span>
                      <span className="block text-[12px] text-muted">{dateTime(r.created_at)}</span>
                    </span>
                    <Icon name="chevronRight" size={16} stroke={2.4} className="text-faint transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="border-t border-separator px-4 py-3.5">
                    <DocumentView content={r.content} format="markdown_report" />
                    {r.task_id && (
                      <Link href={`/tasks/${r.task_id}`} className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-brand">
                        業務と成果物を見る
                        <Icon name="chevronRight" size={14} stroke={2.4} />
                      </Link>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </>
  );
}
