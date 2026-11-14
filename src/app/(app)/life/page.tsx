import Link from "next/link";
import { getDb } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { LIFE_PRIORITY_LABEL } from "@/lib/constants";
import { lifeOverview } from "@/lib/life/overview";
import { openQuestions } from "@/lib/life/questions";
import { Empty, Page, PageHeader, Section, Stat } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { AskNowButton, QuestionCard } from "./LifeForms";

export const metadata = { title: "ライフ" };
export const maxDuration = 300;

export default async function LifePage() {
  const sql = await getDb();
  const [overview, questions, [report], suggestions] = await Promise.all([
    lifeOverview(sql),
    openQuestions(sql),
    sql<{ id: string; period_months: number; ai_summary: string; created_at: Date }[]>`
      select id, period_months, ai_summary, created_at from life_reports order by created_at desc limit 1`,
    sql<{ id: string; title: string; priority: string }[]>`
      select id, title, priority from life_suggestions where status = 'new' order by created_at desc limit 3`,
  ]);
  const links: { href: string; label: string; icon: IconName }[] = [
    { href: "/life/records", label: "生活情報", icon: "document" },
    { href: "/life/questions", label: "質問一覧", icon: "chat" },
    { href: "/life/reports", label: "分析レポート", icon: "report" },
    { href: "/life/suggestions", label: "改善提案", icon: "sparkles" },
  ];
  return (
    <>
      <PageHeader title="ライフ" subtitle="ライフ担当 森野 結" back="/more" backLabel="メニュー" />
      <Page>
        <Section title={questions.length ? `森野からの質問（${questions.length}問）` : "森野からの質問"}>
          {questions.length === 0 ? (
            <div className="card space-y-3 p-4">
              <p className="text-[14px] leading-relaxed text-muted">いまは回答待ちの質問はありません。次の質問は、決まった日に届きます。</p>
              <AskNowButton />
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((q) => (
                <QuestionCard key={q.id} q={q} />
              ))}
            </div>
          )}
          <p className="mt-2 px-1 text-xs text-muted">答えたくない質問は「スキップ」でOKです。答えた内容は「生活情報」でいつでも直したり、消したりできます。</p>
        </Section>

        <div className="grid grid-cols-2 gap-2.5">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="card press flex items-center gap-2.5 p-3.5">
              <Icon name={l.icon} size={20} stroke={2} className="text-brand" />
              <span className="text-[14px] font-semibold">{l.label}</span>
            </Link>
          ))}
        </div>

        <Section title="情報の集まり具合">
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="登録ずみの項目" value={`${overview.filledFields} / ${overview.totalFields}`} sub="使っているカテゴリの項目" />
            <Stat label="更新が必要" value={`${overview.stale.length}件`} sub="前の回答から時間がたったもの" />
          </div>
          {overview.missing.length > 0 && (
            <div className="card mt-2.5 p-4">
              <p className="text-[13px] font-semibold">まだ分からない大事な情報</p>
              <ul className="mt-1.5 space-y-1 text-[14px]">
                {overview.missing.slice(0, 5).map((c) => (
                  <li key={c.field.id}>
                    <Link href={`/life/records/${c.field.id}`} className="text-brand">
                      {c.field.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">森野が少しずつ質問します。先に教えたいときは、項目を開いて記録できます。</p>
            </div>
          )}
          {overview.stale.length > 0 && (
            <div className="card mt-2.5 p-4">
              <p className="text-[13px] font-semibold">更新が必要な情報</p>
              <ul className="mt-1.5 space-y-1 text-[14px]">
                {overview.stale.slice(0, 5).map((c) => (
                  <li key={c.field.id}>
                    <Link href={`/life/records/${c.field.id}`} className="text-brand">
                      {c.field.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="最近の分析" action={<Link href="/life/reports" className="font-medium text-brand">すべて</Link>}>
          {report ? (
            <Link href={`/life/reports/${report.id}`} className="card press block p-4">
              <p className="text-[12px] font-semibold text-brand">
                直近{report.period_months}か月の分析・{dateTime(report.created_at)}
              </p>
              <p className="mt-1 line-clamp-3 text-[14px] leading-relaxed">{report.ai_summary || "数字のまとめ（AIのコメントなし）"}</p>
            </Link>
          ) : (
            <Empty icon="report">まだ分析はありません。情報が集まると、森野が月に1回分析します。</Empty>
          )}
        </Section>

        <Section title="新しい改善提案" action={<Link href="/life/suggestions" className="font-medium text-brand">すべて</Link>}>
          {suggestions.length === 0 ? (
            <Empty icon="sparkles">まだ提案はありません。</Empty>
          ) : (
            <ul className="card divide-y divide-separator">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <Link href={`/life/suggestions/${s.id}`} className="flex items-center justify-between gap-2 px-4 py-3">
                    <span className="truncate text-[15px] font-medium">{s.title}</span>
                    <span className="shrink-0 text-[12px] text-muted">優先度 {LIFE_PRIORITY_LABEL[s.priority]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Link href="/life/settings" className="block text-center text-[14px] font-semibold text-brand">
          質問の頻度・カテゴリの設定
        </Link>
      </Page>
    </>
  );
}
