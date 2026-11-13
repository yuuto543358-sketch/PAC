import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getTask } from "@/lib/repo/tasks";
import { getDeliverable, listDeliverables } from "@/lib/workflow/repo";
import { DELIVERABLE_FORMATS, DELIVERABLE_STATUS_LABEL } from "@/lib/constants";
import { dateTime } from "@/lib/format";
import { DocumentView } from "@/components/DocumentView";
import { Page, PageHeader, Section } from "@/components/ui";
import { OutputButtons } from "./OutputButtons";

export default async function DeliverablePage({ params }: { params: Promise<{ id: string; version: string }> }) {
  const { id, version } = await params;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) notFound();
  const sql = await getDb();
  const task = await getTask(sql, id);
  if (!task) notFound();
  const [d, all] = await Promise.all([getDeliverable(sql, id, v), listDeliverables(sql, id)]);
  if (!d) notFound();
  const fmt = DELIVERABLE_FORMATS.find((f) => f.id === d.format) ?? DELIVERABLE_FORMATS[0];
  const safeName = d.title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "deliverable";
  const statusTone =
    d.status === "accepted" || d.status === "passed" ? "bg-success-soft text-success" : d.status === "revise" || d.status === "rejected" ? "bg-accent-soft text-accent" : "bg-info-soft text-brand";

  return (
    <>
      <PageHeader title="成果物" back={`/tasks/${id}`} backLabel="業務" large={false} />
      <Page>
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${statusTone}`}>{DELIVERABLE_STATUS_LABEL[d.status] ?? d.status}</span>
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] text-muted">第{d.version}版</span>
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] text-muted">出力形式：{fmt.label}</span>
          </div>
          <h2 className="mt-2 text-[22px] leading-snug font-bold tracking-tight">{d.title}</h2>
          <p className="mt-1 text-[13px] text-muted">
            作成：{d.author_name ?? "—"} ・ {dateTime(d.created_at)} ・ 業務：
            <Link href={`/tasks/${id}`} className="text-brand">
              {task.title}
            </Link>
          </p>
          <div className="mt-4">
            <OutputButtons content={d.content} filename={`${safeName}_v${d.version}.${fmt.ext}`} mime={fmt.mime} />
          </div>
        </div>

        {d.review_note && (
          <Section title={d.status === "revise" || d.status === "rejected" ? "修正の指摘" : "監査メモ（リスク・注意点）"}>
            <div className="card p-4 text-[14px] leading-relaxed whitespace-pre-wrap">{d.review_note}</div>
          </Section>
        )}

        <Section title="本文">
          <article className="card p-5">
            <DocumentView content={d.content} format={d.format} />
          </article>
        </Section>

        {all.length > 1 && (
          <Section title="版の履歴">
            <ul className="card divide-y divide-separator">
              {all.map((x) => (
                <li key={x.version}>
                  <Link href={`/tasks/${id}/deliverables/${x.version}`} className={`flex items-center justify-between px-4 py-3 text-[15px] active:bg-surface-3 ${x.version === d.version ? "font-semibold" : ""}`}>
                    <span>
                      第{x.version}版 <span className="text-[13px] text-muted">・{x.author_name ?? "—"}・{dateTime(x.created_at)}</span>
                    </span>
                    <span className="text-[12px] text-muted">{DELIVERABLE_STATUS_LABEL[x.status] ?? x.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <p className="px-1 text-[12px] text-muted">「コピー」「ファイルで保存」はこの端末の中だけの操作です。外部への送信・公開は、承認センターでの承認が必要です。</p>
      </Page>
    </>
  );
}
