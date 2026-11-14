import { getDb } from "@/lib/db";
import { dateTime, longDate } from "@/lib/format";
import { LIFE_QUESTION_STATUS_LABEL } from "@/lib/constants";
import { listQuestions, openQuestions, previewNextQuestions } from "@/lib/life/questions";
import { Empty, Page, PageHeader, SegmentedLinks } from "@/components/ui";
import { AskNowButton, QuestionCard } from "../LifeForms";

export const metadata = { title: "質問一覧" };

const TABS = [
  { key: "open", label: "回答待ち" },
  { key: "answered", label: "回答済み" },
  { key: "skipped", label: "スキップ" },
  { key: "next", label: "次の予定" },
];

export default async function LifeQuestionsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "open";
  const sql = await getDb();
  return (
    <>
      <PageHeader title="質問一覧" back="/life" backLabel="ライフ" />
      <Page>
        <SegmentedLinks items={TABS.map((t) => ({ ...t, href: `/life/questions?tab=${t.key}` }))} active={tab} />
        <TabBody tab={tab} sql={sql} />
      </Page>
    </>
  );
}

async function TabBody({ tab, sql }: { tab: string; sql: Awaited<ReturnType<typeof getDb>> }) {
  if (tab === "open") {
    const qs = await openQuestions(sql);
    const later = (await listQuestions(sql, ["later"])).filter((q) => !qs.some((o) => o.id === q.id));
    return (
      <div className="space-y-3">
        {qs.length === 0 ? <Empty icon="chat">回答待ちの質問はありません。</Empty> : qs.map((q) => <QuestionCard key={q.id} q={q} />)}
        {later.length > 0 && (
          <p className="px-1 text-xs text-muted">「後で答える」にした質問が{later.length}問あります（2日後に、もう一度出てきます）。</p>
        )}
        {qs.length === 0 && <AskNowButton />}
      </div>
    );
  }
  if (tab === "next") {
    const { candidates, nextDay } = await previewNextQuestions(sql);
    return (
      <div className="space-y-3">
        <p className="card p-4 text-[14px]">
          次に質問が届く日：<b>{nextDay ? longDate(new Date(`${nextDay}T00:00:00+09:00`)) : "停止中（設定で変えられます）"}</b>
        </p>
        {candidates.length === 0 ? (
          <Empty icon="check">いま聞く予定のことはありません。</Empty>
        ) : (
          <ul className="card divide-y divide-separator">
            {candidates.map((c) => (
              <li key={c.field.id} className="px-4 py-3">
                <p className="text-[15px]">{c.text}</p>
                <p className="text-[12px] text-muted">{c.why === "missing" ? "まだ分からない情報" : c.why === "stale" ? "更新の確認" : "期間ごとの記録"}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const statuses = tab === "answered" ? ["answered"] : ["skipped", "unknown", "expired"];
  const qs = await listQuestions(sql, statuses, 100);
  if (qs.length === 0) return <Empty icon="inbox">まだありません。</Empty>;
  return (
    <ul className="card divide-y divide-separator">
      {qs.map((q) => (
        <li key={q.id} className="px-4 py-3">
          <p className="text-[15px]">{q.text}</p>
          <p className="text-[12px] text-muted">
            {LIFE_QUESTION_STATUS_LABEL[q.status] ?? q.status}・{dateTime(q.answered_at ?? q.asked_at)}
          </p>
        </li>
      ))}
    </ul>
  );
}
