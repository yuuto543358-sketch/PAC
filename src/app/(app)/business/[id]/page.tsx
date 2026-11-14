import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { BUSINESS_STATUS_LABEL, BUSINESS_STATUS_TONE, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/constants";
import { dateTime, yen } from "@/lib/format";
import { getBusinessProject } from "@/lib/repo/business";
import { Page, PageHeader, Section } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SourceList } from "@/components/SourceList";
import { BusinessStatusForm, BusinessWorkButtons, InvestigateButton } from "../BusinessActions";
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
  const canBuild = b.status === "promising" || b.status === "adopted";
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

        <Section title="次の一歩">
          {canBuild ? (
            <>
              <BusinessWorkButtons id={b.id} />
              <p className="mt-1.5 px-1 text-xs text-muted">
                チームが商品の中身や、販売ページの文章・値段・売る場所の候補を用意します（各 約5〜20円）。出品・投稿・登録は、あなたが自分で行います。
              </p>
            </>
          ) : (
            <p className="card px-4 py-3 text-[13px] text-muted">
              下の「あなたの判断」で「有望」か「採用」にすると、チームに「商品を作る」「販売の準備をする」を任せられます。
            </p>
          )}
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
            「採用」にしても、自動で何かが始まることはありません。お金や外部への操作が必要なときは、必ず承認依頼が届きます。
          </p>
        </Section>
      </Page>
    </>
  );
}
