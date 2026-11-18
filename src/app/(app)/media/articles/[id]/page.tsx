import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { ARTICLE_STATUS_LABEL, getArticle } from "@/lib/mediaco/repo";
import { dateTime, yen } from "@/lib/format";
import { Alert, Page, PageHeader, Section } from "@/components/ui";
import { DocumentView } from "@/components/DocumentView";
import { SourceList } from "@/components/SourceList";
import { NoteCopyButtons, OutputButtons } from "@/app/(app)/tasks/[id]/deliverables/[version]/OutputButtons";
import { MetricsForm, PublishForm } from "../../MediaForms";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = await getDb();
  const a = await getArticle(sql, id);
  if (!a) notFound();
  const q = a.quality ?? {};
  const rows: [string, string][] = [
    ["ジャンル", a.genre],
    ["テーマ", a.theme],
    ["想定読者", a.target],
    ["読者の悩み", a.reader_pain],
    ["種類・価格案", a.kind === "paid" ? `有料記事・${yen(a.price_jpy)}` : "無料記事（読者を集める）"],
    ["収益性の評価（事業開発部）", `${a.profit_score}点`],
    ["執筆日", a.written_on ?? "—"],
    ["制作にかかったAIの費用", `${a.cost_jpy.toFixed(1)}円`],
  ];
  return (
    <>
      <PageHeader title="記事" back="/media/articles" backLabel="記事" large={false} />
      <Page>
        <div className="card p-5">
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold">{ARTICLE_STATUS_LABEL[a.status] ?? a.status}</span>
          <h2 className="mt-2 text-[20px] leading-snug font-bold">{a.title || a.theme}</h2>
          {a.status === "failed" && <div className="mt-3"><Alert tone="error">作れませんでした：{a.last_error}</Alert></div>}
          {a.status === "rejected" && <div className="mt-3"><Alert tone="warn">品質検査で公開できない問題が見つかったため、取りやめました：{q.comment}</Alert></div>}
          {q.unrevised && (
            <div className="mt-3">
              <Alert tone="warn">品質検査の指摘を、AIが自動で直しきれませんでした（{a.last_error}）。下の「品質検査」の指摘を読んで、note に公開する前に直すか、公開してよいかを確かめてください。</Alert>
            </div>
          )}
          {a.body && (
            <div className="mt-4 space-y-2.5">
              <OutputButtons content={a.body} filename={`${(a.title || "article").slice(0, 40)}.md`} mime="text/markdown" />
              {(a.status === "ready" || a.status === "published") && <NoteCopyButtons content={a.body} />}
            </div>
          )}
        </div>

        {a.status === "ready" && (
          <Section title="note に公開する（あなたが行う）">
            <div className="card space-y-3 p-4">
              <ol className="list-decimal space-y-1 pl-5 text-[14px] text-muted">
                <li>上の「note に貼る」のボタンで、タイトル・本文を順にコピーして、note の新しい記事に貼る</li>
                <li>{a.kind === "paid" ? `有料記事にして、値段を ${yen(a.price_jpy)} に、「ここから有料」を「有料部分」の前に設定する` : "無料のまま公開する"}</li>
                <li>公開したら、記事のURLを下に入れて「公開した」を押す</li>
              </ol>
              <PublishForm id={a.id} url={a.published_url} />
            </div>
          </Section>
        )}

        {a.status === "published" && (
          <Section title="成果を記録する（note のダッシュボードの数字）">
            <div className="card space-y-3 p-4">
              <p className="text-[13px]">
                公開：<a href={a.published_url} target="_blank" rel="noopener noreferrer" className="tap break-all text-brand">{a.published_url}</a>
                {a.published_at && <span className="text-muted">（{dateTime(a.published_at)}）</span>}
              </p>
              <MetricsForm id={a.id} m={{ views: a.views, likes: a.likes, sales: a.sales, revenue: a.revenue_jpy }} />
            </div>
          </Section>
        )}

        {a.quality_score != null && (
          <Section title="品質検査（監査・品質管理部）">
            <div className="card space-y-2 p-4 text-[14px]">
              <p>
                <b className="tabular text-[18px]">{a.quality_score}点</b>
                <span className="ml-2 text-muted">{q.revised ? "（指摘を1回直して完成）" : q.unrevised ? "（指摘は直せていません）" : ""}</span>
              </p>
              {q.comment && <p>{q.comment}</p>}
              {[...(q.issues ?? []), ...(q.fact_issues ?? []), ...(q.hype ?? [])].length > 0 && (
                <ul className="list-disc pl-5 text-muted">
                  {[...(q.issues ?? []), ...(q.fact_issues ?? []), ...(q.hype ?? [])].map((i) => <li key={i}>{i}</li>)}
                </ul>
              )}
              {q.copyright_risk && <p className="text-[12px] text-muted">著作権・転載のリスク：{q.copyright_risk === "low" ? "低い" : q.copyright_risk === "medium" ? "中くらい" : "高い"}</p>}
            </div>
          </Section>
        )}

        <Section title="記事の情報">
          <dl className="card divide-y divide-separator text-[14px]">
            {rows.map(([k, v]) => (
              <div key={k} className="px-4 py-3">
                <dt className="text-[12px] font-semibold text-muted">{k}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {a.sources.length > 0 && (
          <Section title="情報源">
            <SourceList sources={a.sources} />
          </Section>
        )}

        {a.body && (
          <Section title="本文">
            <article className="card p-5">
              <DocumentView content={a.body} format="note_article" />
            </article>
          </Section>
        )}
      </Page>
    </>
  );
}
