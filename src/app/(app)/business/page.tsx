import Link from "next/link";
import { getDb } from "@/lib/db";
import { BUSINESS_STATUS_LABEL, BUSINESS_STATUS_TONE, BUSINESS_STATUSES } from "@/lib/constants";
import { dateTime, yen } from "@/lib/format";
import { countBusinessByStatus, listBusinessProjects } from "@/lib/repo/business";
import { getSettings } from "@/lib/repo/settings";
import { Empty, Page, PageHeader, Section } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { FindWorkButton } from "./BusinessActions";

export const metadata = { title: "事業開発" };
// 「今すぐ仕事を探す」はAIの返事を待つため、長めに待てるようにする
export const maxDuration = 300;

export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && (BUSINESS_STATUSES as readonly string[]).includes(sp.status) ? sp.status : undefined;
  const sql = await getDb();
  const [items, counts, settings] = await Promise.all([
    listBusinessProjects(sql, { status }),
    countBusinessByStatus(sql),
    getSettings(sql),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title="事業開発" subtitle={`候補 ${total}件`} back="/more" backLabel="メニュー" />
      <Page>
        <div className="card space-y-3 p-4">
          <p className="text-[14px] leading-relaxed">
            事業開発担当の<b>朝日 ひかり</b>が、少ないお金で始められる事業の候補を探します。
            {settings.discovery_auto_start ? "見つけた候補は、チームが自動で調べます。" : "見つけた候補を、ここに保存します。"}
          </p>
          <FindWorkButton disabled={settings.emergency_stop} />
          <p className="text-xs text-muted">
            1回 約3〜10円。外部への連絡・登録・購入はしません（必要なときは承認依頼が届きます）。
            <Link href="/settings#autorun" className="ml-1 font-semibold text-brand">
              自動で探す設定
            </Link>
          </p>
        </div>

        <div className="-mx-4 overflow-x-auto px-4">
          <div className="flex gap-1.5">
            <Link
              href="/business"
              className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold ${!status ? "bg-brand text-brand-fg" : "bg-surface-3 text-muted"}`}
            >
              すべて {total}
            </Link>
            {BUSINESS_STATUSES.map((s) => (
              <Link
                key={s}
                href={`/business?status=${s}`}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold ${status === s ? "bg-brand text-brand-fg" : "bg-surface-3 text-muted"}`}
              >
                {BUSINESS_STATUS_LABEL[s]} {counts[s] ?? 0}
              </Link>
            ))}
          </div>
        </div>

        <Section>
          {items.length === 0 ? (
            <Empty icon="briefcase">
              {status ? "この状態の候補はありません。" : "まだ事業の候補はありません。「今すぐ仕事を探す」を押すと、事業開発担当が探し始めます。"}
            </Empty>
          ) : (
            <ul className="space-y-3">
              {items.map((b) => (
                <li key={b.id}>
                  <Link href={`/business/${b.id}`} className="card press block p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand">
                        <Icon name="briefcase" size={20} stroke={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${BUSINESS_STATUS_TONE[b.status]}`}>
                            {BUSINESS_STATUS_LABEL[b.status]}
                          </span>
                          {b.difficulty && <span className="text-[11px] text-muted">むずかしさ: {b.difficulty}</span>}
                        </div>
                        <p className="mt-1 text-[16px] leading-snug font-semibold">{b.name}</p>
                        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">{b.summary}</p>
                        <p className="mt-1.5 text-[12px] text-faint">
                          始めるお金 {b.initial_cost_jpy != null ? yen(b.initial_cost_jpy) : "不明"}・{dateTime(b.created_at)}
                        </p>
                      </div>
                      <Icon name="chevronRight" size={16} stroke={2.4} className="mt-1 text-faint" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Page>
    </>
  );
}
