import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { LIFE_PRIORITY_LABEL, LIFE_SUGGESTION_STATUS_LABEL, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/constants";
import { getSuggestion } from "@/lib/life/suggestions";
import { Page, PageHeader, Section } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SuggestionStatusForm, SuggestionTeamButton } from "../../LifeForms";

export const metadata = { title: "改善提案" };
export const maxDuration = 300;

export default async function LifeSuggestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = await getDb();
  const s = await getSuggestion(sql, id);
  if (!s) notFound();
  const rows: [string, string][] = [
    ["見つけた問題", s.problem],
    ["そう考えた根拠", s.evidence],
    ["改善するメリット", s.benefit],
    ["かかる費用の目安", s.cost_text],
    ["実行のむずかしさ", s.difficulty],
    ["優先度", LIFE_PRIORITY_LABEL[s.priority]],
    ["おすすめの対応", s.recommendation],
  ];
  const taskActive = s.task_id && s.task_status && !["completed", "rejected", "failed"].includes(s.task_status);
  return (
    <>
      <PageHeader title="改善提案" back="/life/suggestions" backLabel="提案一覧" />
      <Page>
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full bg-brand-soft px-2 py-px font-semibold text-brand">{LIFE_SUGGESTION_STATUS_LABEL[s.status]}</span>
            {s.is_estimate && <span className="rounded-full bg-accent-soft px-2 py-px font-semibold text-accent">推測を含む提案です</span>}
            {s.category_name && <span className="text-muted">{s.category_name}</span>}
          </div>
          <h1 className="mt-2 text-[20px] leading-snug font-bold">{s.title}</h1>
          <p className="mt-1 text-[12px] text-faint">ライフ担当 森野 結・{dateTime(s.created_at)}</p>
        </div>

        <dl className="card divide-y divide-separator">
          {rows.map(([k, v]) => (
            <div key={k} className="px-4 py-3">
              <dt className="text-[12px] font-semibold text-muted">{k}</dt>
              <dd className="mt-0.5 text-[15px] leading-relaxed whitespace-pre-wrap">{v || "（記載なし）"}</dd>
            </div>
          ))}
        </dl>
        {s.report_id && (
          <Link href={`/life/reports/${s.report_id}`} className="block px-1 text-[13px] font-semibold text-brand">
            根拠になった分析レポートを見る
          </Link>
        )}

        <Section title="チームで検討する">
          {s.task_id ? (
            <Link href={`/tasks/${s.task_id}/room`} className="card press flex items-center gap-3 p-4">
              <Icon name="users" size={20} stroke={2} className="text-brand" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{s.task_title}</span>
                <span className="block text-[12px] text-muted">
                  {TASK_STATUS_LABEL[s.task_status as TaskStatus] ?? s.task_status}・グループチャットを見る
                </span>
              </span>
            </Link>
          ) : null}
          {!taskActive && (
            <div className={s.task_id ? "mt-2" : ""}>
              <SuggestionTeamButton id={s.id} />
              <p className="mt-1.5 px-1 text-xs text-muted">
                社長がチームを作り、調査担当が調べて比べ、企画担当が具体案を作り、財務・監査担当が費用とリスクを確認して、社長が報告します（約5〜20円）。契約や購入はしません。
              </p>
            </div>
          )}
        </Section>

        <Section title="あなたの判断">
          <div className="card p-4">
            {s.owner_note && <p className="mb-3 rounded-[12px] bg-surface-2 px-3 py-2 text-[13px]">前回のメモ：{s.owner_note}</p>}
            <SuggestionStatusForm key={`${s.status}-${s.updated_at.getTime()}`} id={s.id} current={s.status} />
          </div>
          <p className="mt-2 px-1 text-xs text-muted">「採用」にしても、アプリが契約変更や購入をすることはありません。必要なときは承認依頼が届き、実行はあなたが行います。</p>
        </Section>
      </Page>
    </>
  );
}
