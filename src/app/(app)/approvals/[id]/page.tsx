import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getApproval, getApprovalEvents } from "@/lib/repo/approvals";
import { APPROVAL_ACTION_LABEL } from "@/lib/constants";
import { dateTime, yen } from "@/lib/format";
import { Alert, ApprovalStatusBadge, Page, PageHeader, PhaseNotice, Section } from "@/components/ui";
import { DecisionForm, ResubmitForm } from "./forms";

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
      <PageHeader title="承認依頼" back="/approvals" />
      <Page>
        <div className={`card p-4 ${a.status === "pending" ? "border-accent" : ""}`}>
          <div className="flex items-center gap-2">
            <ApprovalStatusBadge status={a.status} />
            <span className="text-xs text-muted">{dateTime(a.created_at)} 提出</span>
          </div>
          <h2 className="mt-2 text-lg font-bold">{a.title}</h2>
          {a.task_id && (
            <Link href={`/tasks/${a.task_id}`} className="mt-1 inline-block text-sm text-brand">
              関連業務：{a.task_title} ›
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

        <Section title="実行しようとしている内容">
          <div className="card p-4 text-[15px] whitespace-pre-wrap">{a.content}</div>
        </Section>

        <Section title="詳細">
          <dl className="card divide-y divide-line text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="px-4 py-3">
                <dt className="text-xs font-semibold text-muted">{k}</dt>
                <dd className="mt-1 whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {open && (
          <Section title="判断">
            <div className="card p-4">
              <DecisionForm approvalId={a.id} hash={a.content_hash} isOnHold={a.status === "on_hold"} />
            </div>
            <details className="card mt-2.5">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">内容を修正して再提出 ›</summary>
              <div className="border-t border-line p-4">
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
          </Section>
        )}

        {a.status === "approved" && (
          <PhaseNotice phase="Phase 4">
            承認は記録されました。実際に外部へ実行する機能はまだありません。実装後も、サーバーが「承認済み」かつ「承認時と内容が同じ」ことを確認した場合だけ実行されます。
          </PhaseNotice>
        )}

        {a.decision_note && (
          <Section title="判断メモ">
            <div className="card p-4 text-sm whitespace-pre-wrap">{a.decision_note}</div>
          </Section>
        )}

        <Section title="承認履歴（変更・削除できない記録）">
          <ol className="card divide-y divide-line text-sm">
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
      </Page>
    </>
  );
}
