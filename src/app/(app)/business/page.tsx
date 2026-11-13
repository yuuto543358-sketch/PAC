import { Page, PageHeader, PhaseNotice, Section } from "@/components/ui";

export const metadata = { title: "事業開発" };

const FIELDS = [
  "事業名",
  "概要",
  "想定顧客",
  "顧客の課題",
  "競合",
  "想定販売価格",
  "初期費用",
  "継続費用",
  "収益化の方法",
  "実現難易度",
  "リスク",
  "検証方法",
  "現在のステータス",
];

export default function BusinessPage() {
  return (
    <>
      <PageHeader title="事業開発" back="/more" />
      <Page>
        <PhaseNotice phase="Phase 3〜4">
          AI社員（事業開発担当・調査担当・財務担当）が事業候補を発掘・評価し、この画面で進捗を管理できるようになります。現在はまだ使えません。
        </PhaseNotice>
        <Section title="管理する予定の項目">
          <ul className="card flex flex-wrap gap-1.5 p-4">
            {FIELDS.map((f) => (
              <li key={f} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1 text-xs text-muted">保存先のデータベースの表（business_projects）はすでに用意済みです。</p>
        </Section>
      </Page>
    </>
  );
}
