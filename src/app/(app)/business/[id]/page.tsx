import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { BUSINESS_STAGE_LABEL, BUSINESS_STAGE_STEPS, BUSINESS_STATUS_LABEL, BUSINESS_STATUS_TONE, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/constants";
import { dateTime, yen } from "@/lib/format";
import { getBusinessProject } from "@/lib/repo/business";
import { Page, PageHeader, Section } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SourceList } from "@/components/SourceList";
import { AutoAdvanceToggle, BusinessStatusForm, InvestigateButton, MarkListedForm, RetryStageButton } from "../BusinessActions";
import { businessMoney } from "@/lib/repo/ledger";
import { yenPrecise } from "@/lib/format";

export const metadata = { title: "事業の候補" };
export const maxDuration = 300;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-[12px] font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] leading-relaxed whitespace-pre-wrap">{children || "（記載なし）"}</dd>
    </div>
  );
}

export default async function BusinessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = await getDb();
  const b = await getBusinessProject(sql, id);
  if (!b) notFound();
  const [money, related] = await Promise.all([
    businessMoney(sql, b.id),
    sql<{ id: string; title: string; status: TaskStatus }[]>`
      select id, title, status from tasks where business_project_id = ${b.id} order by created_at desc limit 10`,
  ]);
  const taskActive =
    b.validation_task_id && b.validation_task_status && !["completed", "rejected", "failed"].includes(b.validation_task_status);
  return (
    <>
      <PageHeader title="事業の候補" back="/business" backLabel="事業開発" />
      <Page>
        <div className="card p-4">
          <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${BUSINESS_STATUS_TONE[b.status]}`}>
            {BUSINESS_STATUS_LABEL[b.status]}
          </span>
          <h1 className="mt-2 text-[20px] leading-snug font-bold">{b.name}</h1>
          <p className="mt-2 text-[15px] leading-relaxed">{b.summary}</p>
          <p className="mt-2 text-[12px] text-faint">
            見つけた人: {b.discovered_by_name ?? "—"}・{dateTime(b.created_at)}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "売る値段", v: b.price_jpy },
            { label: "始めるお金", v: b.initial_cost_jpy },
            { label: "毎月のお金", v: b.running_cost_jpy },
          ].map((x) => (
            <div key={x.label} className="card p-3 text-center">
              <p className="text-[11px] text-muted">{x.label}</p>
              <p className="mt-0.5 text-[15px] font-bold">{x.v != null ? yen(x.v) : "不明"}</p>
            </div>
          ))}
        </div>
        <p className="-mt-2 px-1 text-[11px] text-faint">※ 金額はAIの見積もり（目安）です。実際の金額は確認が必要です。</p>

        <Section title="チームでの調査">
          {b.validation_task_id ? (
            <Link href={`/tasks/${b.validation_task_id}/room`} className="card press flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                <Icon name="users" size={20} stroke={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{b.validation_task_title}</span>
                <span className="block text-[12px] text-muted">
                  {TASK_STATUS_LABEL[b.validation_task_status as TaskStatus] ?? b.validation_task_status}・グループチャットを見る
                </span>
              </span>
              <Icon name="chevronRight" size={16} stroke={2.4} className="text-faint" />
            </Link>
          ) : null}
          {!taskActive && (
            <div className={b.validation_task_id ? "mt-2" : ""}>
              <InvestigateButton id={b.id} />
              <p className="mt-1.5 px-1 text-xs text-muted">
                調査担当をリーダーにチームを作り、本当にうまくいきそうかを調べて報告書にします（約5〜20円）。
              </p>
            </div>
          )}
        </Section>

        <Section title="販売までの道のり">
          <div className="card p-4">
            <ol className="grid grid-cols-5 gap-1 text-center text-[11px]">
              {BUSINESS_STAGE_STEPS.map((st, i) => {
                const cur = BUSINESS_STAGE_STEPS.indexOf(b.stage);
                const state = cur > i || b.stage === "selling" ? "done" : cur === i ? "now" : "todo";
                return (
                  <li key={st} className="flex flex-col items-center gap-1">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${
                        state === "done" ? "bg-success text-white" : state === "now" ? "bg-brand text-brand-fg" : "bg-surface-3 text-faint"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={state === "now" ? "font-semibold text-ink" : "text-muted"}>{BUSINESS_STAGE_LABEL[st]}</span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed">
              {b.status !== "adopted" ? (
                <>下の「あなたの判断」で<b>「採用」</b>にすると、チームが商品づくり → 出品の準備まで自動で進めます。あなたは、できた成果物を確認して承認するだけです。</>
              ) : !b.auto_advance ? (
                <>自動で進めるのを止めています。</>
              ) : b.stage === "product" ? (
                <>チームが<b>商品の完成品</b>を作っています。できたら「承認」に届くので、内容を確認して承認すると、出品の準備が自動で始まります。</>
              ) : b.stage === "listing" ? (
                <>チームが<b>出品パッケージ</b>（そのまま貼れる商品名・説明文・値段・手順など）を作っています。承認すると「出品の承認」が届きます。</>
              ) : b.stage === "launch" ? (
                b.launch_approval_status === "approved" ? (
                  <>出品の承認ずみです。出品パッケージのとおりに<b>出品したら、下で「出品しました」</b>を押してください。</>
                ) : (
                  <>
                    <b>出品の承認</b>があなたに届いています。
                    {b.launch_approval_id && (
                      <Link href={`/approvals/${b.launch_approval_id}`} className="ml-1 font-semibold text-brand">
                        承認センターで確認する
                      </Link>
                    )}
                  </>
                )
              ) : b.stage === "selling" ? (
                <>
                  <b>販売中</b>です{b.platform && `（${b.platform}）`}。毎週金曜に事業開発担当が売れ行きを見て、必要なら改善の業務を自動で始めます。売れたら「この事業のお金」で記録してください。
                  {b.listing_url && (
                    <a href={b.listing_url} target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold text-brand">
                      販売ページを見る
                    </a>
                  )}
                </>
              ) : (
                <>調査が終わったら、「採用」にするかどうかを決めてください。</>
              )}
            </div>
            {b.stage === "launch" && b.launch_approval_status === "approved" && (
              <div className="mt-3">
                <MarkListedForm id={b.id} platform={b.platform} />
              </div>
            )}
            {b.stage_task_id && b.stage_task_status && ["rejected", "failed"].includes(b.stage_task_status) && (b.stage === "product" || b.stage === "listing") && (
              <div className="mt-3">
                <RetryStageButton id={b.id} />
              </div>
            )}
            {b.status === "adopted" && (
              <div className="mt-3">
                <AutoAdvanceToggle id={b.id} on={b.auto_advance} />
              </div>
            )}
          </div>
          {related.length > 0 && (
            <ul className="card mt-2.5 divide-y divide-separator text-sm">
              {related.map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="truncate text-brand">{t.title}</span>
                    <span className="shrink-0 text-xs text-muted">{TASK_STATUS_LABEL[t.status] ?? t.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="この事業のお金"
          action={
            <Link href={`/finance/ledger?business=${b.id}`} className="font-medium text-brand">
              記録する
            </Link>
          }
        >
          <div className="card grid grid-cols-2 gap-y-1.5 p-4 text-[14px]">
            <span className="text-muted">入ったお金</span>
            <span className="text-right font-semibold text-success">{yen(money.income)}</span>
            <span className="text-muted">出たお金</span>
            <span className="text-right">{yen(money.expense)}</span>
            <span className="text-muted">AIの利用料</span>
            <span className="text-right">{yenPrecise(money.api)}</span>
            <span className="border-t border-line pt-1.5 font-bold">もうけ</span>
            <span className={`border-t border-line pt-1.5 text-right font-bold ${money.profit < 0 ? "text-danger" : "text-success"}`}>
              {yen(money.profit)}
            </span>
          </div>
        </Section>

        <Section title="くわしい内容">
          <dl className="card divide-y divide-separator">
            <Row label="お客さんになる人">{b.target_customer}</Row>
            <Row label="お客さんの困りごと">{b.customer_problem}</Row>
            <Row label="似たサービス・競合">{b.competitors}</Row>
            <Row label="お金のもらい方">{b.monetization}</Row>
            <Row label="始めるむずかしさ">{b.difficulty}</Row>
            <Row label="心配なこと">{b.risks}</Row>
            <Row label="お金をかけずに確かめる方法">{b.validation_method}</Row>
          </dl>
          {b.sources.length > 0 && <SourceList sources={b.sources} className="mt-3" />}
        </Section>

        <Section title="あなたの判断">
          <div className="card p-4">
            {b.owner_note && (
              <p className="mb-3 rounded-[12px] bg-surface-2 px-3 py-2 text-[13px]">
                <span className="font-semibold">前回のメモ：</span>
                {b.owner_note}
              </p>
            )}
            <BusinessStatusForm key={`${b.status}-${b.updated_at.getTime()}`} id={b.id} current={b.status} />
          </div>
          <p className="mt-2 px-1 text-xs text-muted">
            「採用」にすると、チームが商品づくり → 出品の準備まで自動で進めます。出品・お金・外部への操作は、必ずあなたの承認のあと、あなたが行います。
          </p>
        </Section>
      </Page>
    </>
  );
}
