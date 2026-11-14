import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getApproval, getApprovalEvents } from "@/lib/repo/approvals";
import { APPROVAL_ACTION_LABEL } from "@/lib/constants";
import { dateTime, yen } from "@/lib/format";
import { Alert, ApprovalStatusBadge, IconTile, Page, PageHeader, Section } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { APPROVAL_ACTION_STYLE } from "@/lib/approval-style";
import { DecisionForm, ResubmitForm } from "./forms";
import { OwnerDoPanel, SelfSendPanel } from "./SelfSendPanel";
import { OWNER_SENDS_ACTION_TYPES } from "@/lib/constants";
import { DocumentView } from "@/components/DocumentView";

// 差し戻し後のチームの作業（バックグラウンド）を待つ時間（秒）
export const maxDuration = 300;

const EVENT_LABEL: Record<string, string> = {
  created: "承認依頼が提出されました",
  resubmitted: "修正版として再提出されました",
  approve: "経営者が承認しました",
  reject: "経営者が却下しました",
  hold: "経営者が保留にしました",
  superseded: "修正版に置き換えられました",
  execution_started: "実行を開始しました",
  executed: "実行が完了しました",
  execution_failed: "実行に失敗しました",
};

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = await getDb();
  const a = await getApproval(sql, id);
  if (!a) notFound();
  const events = await getApprovalEvents(sql, id);
  const [newer] = await sql<{ id: string }[]>`select id from approvals where supersedes_id = ${id} limit 1`;
  const open = a.status === "pending" || a.status === "on_hold";
  const isDeliverable = a.action_type === "accept_deliverable";
  const deliverableVersion = Number(a.payload?.deliverableVersion) || null;
  const ownerSends = OWNER_SENDS_ACTION_TYPES.includes(a.action_type);
  const isSns = a.action_type === "sns_post";
  const executedEvent = events.find((e) => e.event === "executed");
  const failedEvent = events.find((e) => e.event === "execution_failed");
  const postUrl = executedEvent?.note.match(/https?:\/\/\S+$/)?.[0] ?? null;

  const rows: [string, string][] = [
    ["操作の種類", APPROVAL_ACTION_LABEL[a.action_type]],
    ["実行先", a.destination || "（記載なし）"],
    ["担当社員", a.requester_name ?? "—"],
    ["発生する費用", yen(a.estimated_cost_jpy)],
    ["実行する理由", a.reason || "（記載なし）"],
    ["想定されるリスク", a.risks || "（記載なし）"],
    ["承認後に何が起こるか", a.after_effect || "（記載なし）"],
  ];

  return (
    <>
      <PageHeader title="承認依頼" back="/approvals" backLabel="承認" large={false} />
      <Page>
        <div className="card p-5">
          <div className="flex items-start gap-3.5">
            <IconTile name={APPROVAL_ACTION_STYLE[a.action_type].icon} color={APPROVAL_ACTION_STYLE[a.action_type].color} size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <ApprovalStatusBadge status={a.status} />
                <span className="text-[12px] text-muted">{dateTime(a.created_at)} 提出</span>
              </div>
              <h2 className="mt-1.5 text-[20px] leading-snug font-bold tracking-tight">{a.title}</h2>
              <p className="mt-0.5 text-[13px] text-muted">{APPROVAL_ACTION_LABEL[a.action_type]}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-[14px] bg-surface-2 p-3 text-center">
            <div>
              <div className="text-[11px] font-semibold text-muted">発生する費用</div>
              <div className="tabular mt-0.5 text-[20px] font-bold">{yen(a.estimated_cost_jpy)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-muted">担当社員</div>
              <div className="mt-1 truncate text-[15px] font-semibold">{a.requester_name ?? "—"}</div>
            </div>
          </div>
          {a.task_id && (
            <Link href={`/tasks/${a.task_id}`} className="press mt-3 flex items-center gap-2 rounded-[12px] bg-brand-soft px-3 py-2.5 text-[14px] font-medium text-brand">
              <Icon name="tasks" size={18} stroke={2} />
              <span className="min-w-0 flex-1 truncate">関連業務：{a.task_title}</span>
              <Icon name="chevronRight" size={16} stroke={2.4} />
            </Link>
          )}
        </div>

        {newer && (
          <Link href={`/approvals/${newer.id}`} className="block">
            <Alert tone="info">この依頼は修正版に置き換えられました。修正版を見る ›</Alert>
          </Link>
        )}
        {a.supersedes_id && (
          <Link href={`/approvals/${a.supersedes_id}`} className="block">
            <Alert tone="info">これは修正版です。元の依頼を見る ›</Alert>
          </Link>
        )}

        {isDeliverable ? (
          <Section
            title="確認する成果物"
            action={
              a.task_id && deliverableVersion ? (
                <Link href={`/tasks/${a.task_id}/deliverables/${deliverableVersion}`} className="font-medium text-brand">
                  全画面で見る
                </Link>
              ) : undefined
            }
          >
            <article className="card max-h-[60vh] overflow-y-auto p-5">
              <DocumentView content={a.content} format={String(a.payload?.format ?? "markdown_report")} />
            </article>
          </Section>
        ) : (
          <Section title={ownerSends ? "送る内容（AIが書いた文面）" : isSns ? `投稿する文章（${a.destination || "SNS"}）` : "実行しようとしている内容"}>
            <div className="card p-4 text-[16px] leading-relaxed whitespace-pre-wrap">{a.content}</div>
            {isSns && (
              <p className="mt-2 px-1 text-xs text-muted">
                {a.content.length}文字・{a.estimated_cost_jpy > 0 ? `投稿の費用の目安 ${yen(a.estimated_cost_jpy)}（Xの利用料。リンク入りは高くなります）` : "投稿の費用はかかりません"}
              </p>
            )}
            {ownerSends && open && (
              <p className="mt-2 px-1 text-xs text-muted">
                承認すると、この文面を送るための「本文をコピー」「メールアプリで開く」ボタンが出ます。送るのはあなたです（アプリは自動で送りません）。
              </p>
            )}
          </Section>
        )}

        {a.status === "approved" && ownerSends && (
          <Section title="あなたが送る">
            <SelfSendPanel subject={a.title} body={a.content} destination={a.destination} />
          </Section>
        )}

        <Section title="詳細">
          <dl className="card divide-y divide-separator text-[15px]">
            {rows.map(([k, v]) => (
              <div key={k} className="px-4 py-3.5">
                <dt className="text-[12px] font-semibold text-muted">{k}</dt>
                <dd className="mt-1 leading-relaxed whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {open && (
          <Section title="判断">
            <div className="card p-4">
              <DecisionForm approvalId={a.id} hash={a.content_hash} isOnHold={a.status === "on_hold"} isDeliverable={isDeliverable} />
            </div>
            {!isDeliverable && (
            <details className="card mt-3 overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 text-[15px] font-semibold">
                <Icon name="edit" size={18} stroke={2} className="text-muted" />
                内容を修正して再提出
                <Icon name="chevronRight" size={16} stroke={2.4} className="ml-auto text-faint" />
              </summary>
              <div className="border-t border-separator p-4">
                <ResubmitForm
                  approvalId={a.id}
                  hash={a.content_hash}
                  initial={{
                    title: a.title,
                    content: a.content,
                    destination: a.destination,
                    estimatedCostJpy: a.estimated_cost_jpy,
                    reason: a.reason,
                    risks: a.risks,
                    afterEffect: a.after_effect,
                  }}
                />
              </div>
            </details>
            )}
          </Section>
        )}

        {a.status === "executed" && isSns && (
          <Section title="投稿しました">
            <div className="card space-y-2 p-4 text-[14px]">
              <p>{executedEvent?.note.replace(/\s*https?:\/\/\S+$/, "") ?? "投稿しました"}</p>
              {postUrl && (
                <a href={postUrl} target="_blank" rel="noopener noreferrer" className="btn-tinted w-full">
                  投稿を見る
                </a>
              )}
              <p className="text-xs text-muted">投稿を消したいときは、そのSNSのアプリから消してください。</p>
            </div>
          </Section>
        )}

        {a.status === "execution_failed" && (
          <Section title="投稿できませんでした">
            <div className="card p-4 text-[14px] text-danger">{failedEvent?.note ?? "原因が分かりませんでした"}</div>
            <div className="mt-2.5">
              <OwnerDoPanel body={a.content} />
            </div>
          </Section>
        )}

        {a.status === "approved" && !isDeliverable && !ownerSends && (
          <Section title="あなたが行う">
            <OwnerDoPanel body={a.content} />
          </Section>
        )}

        {a.decision_note && (
          <Section title="判断メモ">
            <div className="card p-4 text-sm whitespace-pre-wrap">{a.decision_note}</div>
          </Section>
        )}

        <Section title="承認履歴（変更・削除できない記録）">
          <ol className="card divide-y divide-separator text-sm">
            {events.map((ev) => (
              <li key={ev.id} className="px-4 py-2.5">
                <div className="text-xs text-muted">{dateTime(ev.created_at)}</div>
                <div>
                  {EVENT_LABEL[ev.event] ?? ev.event}
                  {ev.note && <span className="text-muted">（{ev.note}）</span>}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2 px-1 text-[11px] break-all text-muted">内容の指紋（改ざん検出用）: {a.content_hash}</p>
        </Section>
        {open && <div className="h-16" aria-hidden />}
      </Page>
    </>
  );
}
