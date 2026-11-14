import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { yen } from "@/lib/format";
import type { QolSnapshot } from "@/lib/life/qolsnapshot";
import { Page, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "週のふりかえり" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = await getDb();
  const [r] = await sql<{ week_start: string; week_end: string; ai_summary: string; ai_used: boolean; stats: QolSnapshot }[]>`
    select to_char(week_start, 'YYYY-MM-DD') as week_start, to_char(week_end, 'YYYY-MM-DD') as week_end, ai_summary, ai_used, stats
    from life_reviews where id = ${id}`;
  if (!r) notFound();
  const s = r.stats;
  return (
    <>
      <PageHeader title="週のふりかえり" subtitle={`${r.week_start} 〜 ${r.week_end}`} back="/life/reviews" backLabel="ふりかえり" />
      <Page>
        <Section title={r.ai_used ? "森野から" : "まとめ"}>
          <div className="card p-4 text-[15px] leading-relaxed whitespace-pre-wrap">{r.ai_summary}</div>
          {r.ai_used && (
            <Link href="/life/habits" className="mt-2 block px-1 text-[13px] font-semibold text-brand">
              おすすめの習慣を見る
            </Link>
          )}
        </Section>
        <Section title="数字（記録から計算）">
          <div className="card space-y-1.5 p-4 text-[14px]">
            <p>QOLチェック：{s.qol ? `${s.qol.days}日・平均スコア ${s.qol.avg.score}（気分${s.qol.avg.mood} 体調${s.qol.avg.energy} 睡眠${s.qol.avg.sleep} ストレス${s.qol.avg.stress}）` : "記録なし"}</p>
            {s.habits.map((h) => (
              <p key={h.title}>
                習慣「{h.title}」：{h.doneInPeriod}回{h.frequency === "daily" ? " / 7日" : ` / 目標${h.target}回`}
              </p>
            ))}
            {s.goals.map((g) => (
              <p key={g.title}>
                目標「{g.title}」：{g.pct != null ? `${g.pct}%` : "記録で管理"}
                {g.behind && "（遅れ気味）"}
              </p>
            ))}
            {s.upcoming.length > 0 && <p>これからの予定：{s.upcoming.slice(0, 5).map((e) => `${e.title}（${e.date}）`).join("、")}・90日以内の出費 {yen(s.upcomingAmount90)}</p>}
          </div>
        </Section>
      </Page>
    </>
  );
}
