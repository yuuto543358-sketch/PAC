import { Page, PageHeader, PhaseNotice, Section } from "@/components/ui";

export const metadata = { title: "報告書" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="報告書" back="/more" />
      <Page>
        <PhaseNotice phase="Phase 2">
          社長が業務履歴とAPI費用をもとに報告書を作成し、ここに保存します。週次報告の自動作成は Phase 3（定期実行）で行います。現在はまだ使えません。
        </PhaseNotice>
        <Section title="作成予定の報告書">
          <ul className="card divide-y divide-line text-sm">
            {["日次報告", "週次報告", "月次報告", "事業開発レポート", "社員別活動報告"].map((r) => (
              <li key={r} className="px-4 py-3 text-muted">
                {r}
              </li>
            ))}
          </ul>
        </Section>
      </Page>
    </>
  );
}
