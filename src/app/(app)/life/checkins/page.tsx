import { getDb } from "@/lib/db";
import { jstDateParts } from "@/lib/format";
import { checkinStats, getCheckin, listCheckins, qolScore } from "@/lib/life/checkins";
import { addDays } from "@/lib/life/planner";
import { Empty, Page, PageHeader, Section, SegmentedLinks, Stat } from "@/components/ui";
import { LifeChart } from "@/components/LifeChart";
import { CheckinForm } from "../QolForms";

export const metadata = { title: "毎日のQOLチェック" };

const RANGES = [
  { key: "7", label: "1週間" },
  { key: "30", label: "1か月" },
  { key: "90", label: "3か月" },
];

export default async function CheckinsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const sp = await searchParams;
  const range = RANGES.some((x) => x.key === sp.r) ? Number(sp.r) : 30;
  const { date } = jstDateParts(new Date());
  const sql = await getDb();
  const [todayC, list] = await Promise.all([getCheckin(sql, date), listCheckins(sql, addDays(date, -(range - 1)))]);
  const st = checkinStats(list);
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return (
    <>
      <PageHeader title="毎日のQOLチェック" subtitle="担当：ライフ担当 森野 結" back="/life" backLabel="ライフ" />
      <Page>
        <Section title={todayC ? `今日のチェック（スコア ${qolScore(todayC)}）` : "今日のチェック（10秒）"}>
          <div className="card p-4">
            <CheckinForm date={date} initial={todayC} />
          </div>
        </Section>

        <SegmentedLinks items={RANGES.map((x) => ({ ...x, href: `/life/checkins?r=${x.key}` }))} active={String(range)} />
        {!st ? (
          <Empty icon="sparkles">この期間のチェックはまだありません。毎日つけると、調子の変化が見えてきます。</Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="平均スコア" value={`${st.avg.score} / 5`} sub={`${st.days}日分`} />
              <Stat
                label="前半→後半の変化"
                value={st.trend == null ? "—" : `${st.trend > 0 ? "+" : ""}${st.trend}`}
                sub={st.trend == null ? "6日以上で分かります" : st.trend > 0 ? "良くなっています" : st.trend < 0 ? "少し下がっています" : "変わりません"}
              />
            </div>
            {list.length >= 2 && (
              <div className="card p-4">
                <LifeChart points={list.map((c) => ({ label: md(c.check_date), value: qolScore(c) }))} kind="line" unit="" title="QOLスコアの変化（5が最高）" />
              </div>
            )}
            <div className="card grid grid-cols-4 gap-1 p-3 text-center text-[12px]">
              {[
                ["気分", st.avg.mood],
                ["体調", st.avg.energy],
                ["睡眠", st.avg.sleep],
                ["ストレス", st.avg.stress],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <p className="text-muted">{l}</p>
                  <p className="text-[17px] font-bold">{v}</p>
                </div>
              ))}
            </div>
            {st.sleepMood && (
              <p className="card p-4 text-[14px] leading-relaxed">
                <b>気づき：</b>よく眠れた日の気分は平均 <b>{st.sleepMood.goodSleep}</b>、眠れなかった日は <b>{st.sleepMood.badSleep}</b> でした。
                {st.sleepMood.goodSleep - st.sleepMood.badSleep >= 1 && "睡眠が気分に大きく関わっていそうです。"}
                <span className="block text-[11px] text-faint">（あなたの記録から計算した数字です）</span>
              </p>
            )}
            <Section title="記録">
              <ul className="card divide-y divide-separator text-[14px]">
                {[...list].reverse().map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="text-muted">{md(c.check_date)}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{c.note}</span>
                    <span className="shrink-0 text-[12px] text-muted">
                      気分{c.mood} 体調{c.energy} 睡眠{c.sleep} ストレス{c.stress}
                    </span>
                    <span className="w-9 shrink-0 text-right font-bold">{qolScore(c)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </Page>
    </>
  );
}
