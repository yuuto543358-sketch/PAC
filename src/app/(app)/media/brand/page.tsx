import { getDb } from "@/lib/db";
import { getActiveBrand } from "@/lib/mediaco/repo";
import { noteAdapter, xAdapter } from "@/lib/mediaco/adapters";
import { yen } from "@/lib/format";
import { Empty, Page, PageHeader, Section } from "@/components/ui";
import { OutputButtons } from "@/app/(app)/tasks/[id]/deliverables/[version]/OutputButtons";
import { BrandAccountsForm, RunNowButton } from "../MediaForms";

export default async function BrandPage() {
  const sql = await getDb();
  const b = await getActiveBrand(sql);
  const note = noteAdapter();
  const x = xAdapter();
  return (
    <>
      <PageHeader title="メディア" back="/more" backLabel="メニュー" />
      <Page>
        {!b ? (
          <div className="card space-y-3 p-4">
            <Empty icon="star">まだメディアはありません。市場調査でジャンルが決まると、事業開発部がブランドを設計します。</Empty>
            <RunNowButton />
          </div>
        ) : (
          <>
            <div className="card p-5">
              <p className="text-[12px] font-semibold text-brand">{b.genre}</p>
              <h2 className="mt-0.5 text-[22px] leading-snug font-bold">{b.name}</h2>
              <p className="mt-2 text-[15px] leading-relaxed">{b.concept}</p>
              <dl className="mt-3 space-y-2 text-[14px]">
                <div><dt className="text-[12px] font-semibold text-muted">ターゲット読者</dt><dd>{b.target_reader}</dd></div>
                <div><dt className="text-[12px] font-semibold text-muted">口調</dt><dd>{b.tone}</dd></div>
                <div><dt className="text-[12px] font-semibold text-muted">発信テーマ</dt><dd>{b.themes.join("・")}</dd></div>
              </dl>
            </div>

            <Section title="販売商品">
              <ul className="card divide-y divide-separator">
                {b.products.map((p) => (
                  <li key={p.name} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[15px] font-semibold">{p.name}</span>
                      <span className="shrink-0 text-[13px] text-muted">{p.kind === "paid" ? yen(p.price_jpy) : "無料"}</span>
                    </div>
                    <p className="text-[13px] text-muted">{p.description}</p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="プロフィールと紹介文（コピーして使う）">
              <div className="space-y-3">
                {[
                  ["プロフィール", b.profile],
                  ["note の紹介文", b.note_bio],
                  ["X の紹介文", b.x_bio],
                  ["アイコンの制作指示", b.icon_prompt],
                ].map(([k, v]) => (
                  <div key={k} className="card space-y-2 p-4">
                    <p className="text-[12px] font-semibold text-muted">{k}</p>
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{v}</p>
                    <OutputButtons content={v} filename={`${k}.txt`} mime="text/plain" />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="アカウント">
              <div className="card space-y-3 p-4">
                <p className="text-[13px] text-muted">note と X のアカウントは、あなたが作ります（アプリは登録やログインをしません）。作ったら、ここに記録してください。</p>
                <BrandAccountsForm id={b.id} noteUrl={b.note_url} xHandle={b.x_handle} />
              </div>
            </Section>

            <Section title="公開のしかた">
              <div className="card space-y-3 p-4 text-[14px]">
                {[note, x].map((a) => (
                  <div key={a.id}>
                    <p className="font-semibold">{a.label}</p>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted">
                      {a.ownerSteps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  </div>
                ))}
                <p className="text-xs text-muted">
                  note の公式APIは法人向け（note pro）の提携先だけ、X の投稿APIは有料のため、いまはあなたが公開します。使えるようになったら、つなぎ方だけ差し替えられる作りにしてあります。
                </p>
              </div>
            </Section>
          </>
        )}
      </Page>
    </>
  );
}
