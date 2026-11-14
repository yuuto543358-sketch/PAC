import Link from "next/link";
import { getDb } from "@/lib/db";
import { APPROVAL_STATUS_LABEL, type ApprovalStatus } from "@/lib/constants";
import { dateTime } from "@/lib/format";
import { getSettings } from "@/lib/repo/settings";
import { Empty, Page, PageHeader, Section } from "@/components/ui";
import { PlanSnsButton, SnsSettingsForm } from "./SnsForms";

export const metadata = { title: "SNS運用" };
export const maxDuration = 300;

export default async function SnsPage() {
  const sql = await getDb();
  const [settings, posts] = await Promise.all([
    getSettings(sql),
    sql<{ id: string; content: string; destination: string; status: ApprovalStatus; created_at: Date }[]>`
      select id, content, destination, status, created_at from approvals
      where action_type = 'sns_post' and status <> 'superseded'
      order by created_at desc limit 30`,
  ]);
  const pending = posts.filter((p) => p.status === "pending").length;
  return (
    <>
      <PageHeader title="SNS運用" subtitle={pending > 0 ? `承認待ちの投稿案 ${pending}件` : "投稿案はSNS担当が作ります"} back="/more" backLabel="メニュー" />
      <Page>
        <div className="card space-y-3 p-4">
          <p className="text-[14px] leading-relaxed">
            SNS担当の<b>春野 創太</b>が、会社のSNSの投稿案を作ります。投稿案は1件ずつ「承認」に届きます。
            <b>投稿は、承認したあとにあなたが行います</b>（「Xで開く」「Blueskyで開く」を押すと、文章が入った投稿画面が開きます）。
          </p>
          <PlanSnsButton />
          <p className="text-xs text-muted">1回 約1円（AIの利用料）。アプリがSNSに投稿することはありません。</p>
        </div>

        <Section title="SNS運用の設定">
          <div className="card p-4">
            <SnsSettingsForm
              initial={{
                sns_plan_frequency: settings.sns_plan_frequency,
                sns_posts_per_plan: settings.sns_posts_per_plan,
                sns_platforms: settings.sns_platforms ?? ["x"],
              }}
            />
          </div>
          <p className="mt-2 px-1 text-xs text-muted">自動で作るのは毎朝（午前7時半ごろ）です（CRON_SECRET の設定が必要）。</p>
        </Section>

        <Section title="これまでの投稿案">
          {posts.length === 0 ? (
            <Empty icon="send">まだ投稿案はありません。「今すぐ投稿案を作る」を押すと、SNS担当が作ります。</Empty>
          ) : (
            <ul className="card divide-y divide-separator">
              {posts.map((p) => (
                <li key={p.id}>
                  <Link href={`/approvals/${p.id}`} className="block px-4 py-3">
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-muted">
                        {p.destination}・{dateTime(p.created_at)}
                      </span>
                      <span className={`font-semibold ${p.status === "pending" ? "text-accent" : p.status === "approved" ? "text-success" : "text-muted"}`}>
                        {p.status === "approved" ? "承認済み（あなたが投稿）" : (APPROVAL_STATUS_LABEL[p.status] ?? p.status)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[14px] leading-relaxed whitespace-pre-wrap">{p.content}</p>
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
