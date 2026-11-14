import Link from "next/link";
import { getDb } from "@/lib/db";
import { APPROVAL_STATUS_LABEL, SNS_PLATFORM_LABEL, SNS_PLATFORMS, type ApprovalStatus } from "@/lib/constants";
import { dateTime } from "@/lib/format";
import { getSettings } from "@/lib/repo/settings";
import { isPlatformConfigured } from "@/lib/sns/post";
import { Empty, Page, PageHeader, Section } from "@/components/ui";
import { PlanSnsButton, SnsSettingsForm } from "./SnsForms";

export const metadata = { title: "SNS運用" };
export const maxDuration = 300;

const SETUP: Record<string, { keys: string[]; steps: string[] }> = {
  x: {
    keys: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"],
    steps: [
      "X の開発者ページ（developer.x.com）に、投稿したいアカウントでログインして登録する",
      "アプリを作り、権限を「Read and write」にする",
      "「Keys and tokens」で API Key・API Secret・Access Token・Access Token Secret を作る",
      "使った分だけ払う方式なので、クレジット（利用料）を少し購入する（1投稿 約2円、リンク入りは約30円の目安）",
      "4つの値を Vercel の環境変数に追加して Redeploy する",
    ],
  },
  bluesky: {
    keys: ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"],
    steps: [
      "Bluesky のアプリで「設定」→「プライバシーとセキュリティ」→「アプリパスワード」を作る",
      "BLUESKY_HANDLE に自分のハンドル（例：yourname.bsky.social）、BLUESKY_APP_PASSWORD に作ったアプリパスワードを入れる",
      "Vercel の環境変数に追加して Redeploy する（Bluesky は投稿の費用がかかりません）",
    ],
  },
};

export default async function SnsPage() {
  const sql = await getDb();
  const [settings, posts, [count]] = await Promise.all([
    getSettings(sql),
    sql<{ id: string; title: string; content: string; destination: string; status: ApprovalStatus; created_at: Date; note: string | null }[]>`
      select a.id, a.title, a.content, a.destination, a.status, a.created_at,
        (select e.note from approval_events e where e.approval_id = a.id and e.event = 'executed' order by e.id desc limit 1) as note
      from approvals a where a.action_type = 'sns_post' and a.status <> 'superseded'
      order by a.created_at desc limit 30`,
    sql<{ n: number }[]>`
      select count(*)::int as n from approvals where action_type = 'sns_post' and status = 'executed'
        and executed_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'`,
  ]);
  const configured = SNS_PLATFORMS.filter(isPlatformConfigured);
  return (
    <>
      <PageHeader title="SNS運用" subtitle={`今月の投稿 ${count.n}回／上限 ${settings.sns_monthly_post_limit}回`} back="/more" backLabel="メニュー" />
      <Page>
        <div className="card space-y-3 p-4">
          <p className="text-[14px] leading-relaxed">
            SNS担当の<b>春野 創太</b>が、会社のSNSの投稿案を作ります。投稿案は1件ずつ「承認」に届き、
            <b>あなたが承認すると、アプリが自動で投稿します。</b>
          </p>
          <PlanSnsButton />
          <p className="text-xs text-muted">
            1回 約1円（AIの利用料）。{configured.length === 0 && "SNSの設定がまだないため、承認後は「内容をコピー」で、あなたが投稿します。"}
          </p>
        </div>

        <Section title="つないでいるSNS">
          <ul className="card divide-y divide-separator">
            {SNS_PLATFORMS.map((p) => {
              const ok = isPlatformConfigured(p);
              return (
                <li key={p} className="px-4 py-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold">{SNS_PLATFORM_LABEL[p]}</span>
                      <span className={`text-[13px] font-semibold ${ok ? "text-success" : "text-muted"}`}>{ok ? "つながっています" : "未設定（つなぎ方）"}</span>
                    </summary>
                    <div className="mt-2 space-y-2 text-[13px] leading-relaxed">
                      <ol className="list-decimal space-y-1 pl-5">
                        {SETUP[p].steps.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                      <p className="text-xs text-muted">環境変数の名前：{SETUP[p].keys.join("、")}（どれも秘密の値です。他の人に見せないでください）</p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="SNS運用の設定">
          <div className="card p-4">
            <SnsSettingsForm
              initial={{
                sns_plan_frequency: settings.sns_plan_frequency,
                sns_posts_per_plan: settings.sns_posts_per_plan,
                sns_monthly_post_limit: settings.sns_monthly_post_limit,
              }}
            />
          </div>
          <p className="mt-2 px-1 text-xs text-muted">
            自動で作るのは夜中（午前3時ごろ）です（CRON_SECRET の設定が必要）。上限に達すると、その月はそれ以上投稿しません。
          </p>
        </Section>

        <Section title="これまでの投稿案">
          {posts.length === 0 ? (
            <Empty icon="send">まだ投稿案はありません。「今すぐ投稿案を作る」を押すと、SNS担当が作ります。</Empty>
          ) : (
            <ul className="card divide-y divide-separator">
              {posts.map((p) => {
                const url = p.note?.match(/https?:\/\/\S+$/)?.[0];
                return (
                  <li key={p.id}>
                    <Link href={`/approvals/${p.id}`} className="block px-4 py-3">
                      <div className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="text-muted">
                          {p.destination}・{dateTime(p.created_at)}
                        </span>
                        <span className={`font-semibold ${p.status === "executed" ? "text-success" : p.status === "pending" ? "text-accent" : "text-muted"}`}>
                          {p.status === "executed" ? "投稿済み" : APPROVAL_STATUS_LABEL[p.status] ?? p.status}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-3 text-[14px] leading-relaxed whitespace-pre-wrap">{p.content}</p>
                      {url && <p className="mt-1 truncate text-[12px] text-brand">{url}</p>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </Page>
    </>
  );
}
