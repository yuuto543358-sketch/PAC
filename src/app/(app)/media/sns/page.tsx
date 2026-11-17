import Link from "next/link";
import { getDb } from "@/lib/db";
import { listPosts, POST_KIND_LABEL } from "@/lib/mediaco/repo";
import { composeUrl } from "@/lib/sns/post";
import { dateTime } from "@/lib/format";
import { Empty, Page, PageHeader, Section } from "@/components/ui";
import { PostRecordForm } from "../MediaForms";

export default async function MediaSnsPage() {
  const sql = await getDb();
  const posts = await listPosts(sql, 60);
  const waiting = posts.filter((p) => p.approval_status === "pending" || p.approval_status === "on_hold");
  const toPost = posts.filter((p) => p.approval_status === "approved" && p.status !== "posted");
  const posted = posts.filter((p) => p.status === "posted");
  const totals = posted.reduce(
    (s, p) => ({ impressions: s.impressions + p.impressions, likes: s.likes + p.likes, clicks: s.clicks + p.clicks }),
    { impressions: 0, likes: 0, clicks: 0 },
  );
  return (
    <>
      <PageHeader title="X運営" back="/more" backLabel="メニュー" />
      <Page>
        <p className="px-1 text-[14px] leading-relaxed text-muted">
          マーケティング部が毎日、Xの投稿案と予定を作ります。承認したら「Xで開く」から、あなたが投稿してください（アプリは投稿しません。自動いいね・自動フォローもしません）。
        </p>
        <div className="card grid grid-cols-3 divide-x divide-separator text-center">
          {[
            ["投稿済み", `${posted.length}件`],
            ["表示（合計）", totals.impressions.toLocaleString("ja-JP")],
            ["クリック", totals.clicks.toLocaleString("ja-JP")],
          ].map(([k, v]) => (
            <div key={k} className="px-1 py-3">
              <span className="block text-[12px] text-muted">{k}</span>
              <span className="tabular block text-[18px] font-bold">{v}</span>
            </div>
          ))}
        </div>

        <Section title={`投稿する（承認ずみ・${toPost.length}件）`}>
          {toPost.length === 0 ? (
            <Empty icon="send">投稿を待っているものはありません。</Empty>
          ) : (
            <div className="space-y-3">
              {toPost.map((p) => (
                <div key={p.id} className="card space-y-3 p-4">
                  <p className="text-[12px] text-muted">
                    {POST_KIND_LABEL[p.kind] ?? p.kind}
                    {p.scheduled_for && `・おすすめ ${dateTime(p.scheduled_for)}`}
                  </p>
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{p.text}</p>
                  <a href={composeUrl("x", p.text)} target="_blank" rel="noopener noreferrer" className="btn-primary w-full">
                    Xで開く
                  </a>
                  <PostRecordForm id={p.id} />
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={`承認待ち（${waiting.length}件）`} action={waiting.length ? <Link href="/approvals" className="font-medium text-brand">承認へ</Link> : undefined}>
          {waiting.length === 0 ? (
            <Empty icon="approve">承認待ちの投稿案はありません。</Empty>
          ) : (
            <ul className="card divide-y divide-separator">
              {waiting.map((p) => (
                <li key={p.id}>
                  <Link href={`/approvals/${p.approval_id}`} className="press block px-4 py-3">
                    <span className="block text-[12px] text-muted">
                      {POST_KIND_LABEL[p.kind] ?? p.kind}
                      {p.scheduled_for && `・おすすめ ${dateTime(p.scheduled_for)}`}
                    </span>
                    <span className="line-clamp-2 block text-[14px]">{p.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {posted.length > 0 && (
          <Section title="投稿した記録と反応">
            <ul className="card divide-y divide-separator">
              {posted.map((p) => (
                <li key={p.id} className="px-4 py-3">
                  <span className="line-clamp-2 block text-[14px]">{p.text}</span>
                  <span className="block text-[12px] text-muted">
                    表示{p.impressions}・いいね{p.likes}・リポスト{p.reposts}・クリック{p.clicks}
                    {p.posted_at && `・${dateTime(p.posted_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Page>
    </>
  );
}
