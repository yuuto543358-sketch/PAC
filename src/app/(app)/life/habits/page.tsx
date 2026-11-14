import { getDb } from "@/lib/db";
import { jstDateParts } from "@/lib/format";
import { habitProgressList } from "@/lib/life/habits";
import { addDays } from "@/lib/life/planner";
import { Empty, Page, PageHeader, Section } from "@/components/ui";
import { HabitCheck, HabitStatusButtons, NewHabitForm } from "../QolForms";

export const metadata = { title: "小さな習慣" };

export default async function HabitsPage({ searchParams }: { searchParams: Promise<{ title?: string; why?: string; suggestion?: string }> }) {
  const sp = await searchParams;
  const { date } = jstDateParts(new Date());
  const sql = await getDb();
  const [active, proposed, resting] = await Promise.all([
    habitProgressList(sql, date, ["active"]),
    habitProgressList(sql, date, ["proposed"]),
    habitProgressList(sql, date, ["paused", "done"]),
  ]);
  const week = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6));
  return (
    <>
      <PageHeader title="小さな習慣" subtitle="担当：ライフ担当 森野 結" back="/life" backLabel="ライフ" />
      <Page>
        <Section title="今日の習慣">
          {active.length === 0 ? (
            <Empty icon="check">まだ習慣はありません。下で、小さな習慣を1つ始めてみましょう。</Empty>
          ) : (
            <ul className="card divide-y divide-separator">
              {active.map((h) => (
                <li key={h.id}>
                  <HabitCheck
                    id={h.id}
                    date={date}
                    done={h.doneToday}
                    title={h.title}
                    meta={h.frequency === "daily" ? `${h.streak}日続いています` : `今週 ${h.thisWeek} / ${h.target_per_week}回`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {proposed.length > 0 && (
          <Section title="森野からのおすすめ">
            <div className="space-y-2.5">
              {proposed.map((h) => (
                <div key={h.id} className="card space-y-2 p-4">
                  <p className="text-[15px] font-semibold">{h.title}</p>
                  {h.why && <p className="text-[13px] text-muted">{h.why}</p>}
                  <HabitStatusButtons id={h.id} status={h.status} />
                </div>
              ))}
            </div>
          </Section>
        )}

        {active.length > 0 && (
          <Section title="続き具合">
            <div className="space-y-2.5">
              {active.map((h) => (
                <div key={h.id} className="card space-y-2 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[15px] font-semibold">{h.title}</p>
                    <p className="shrink-0 text-[12px] text-muted">{h.rate4w == null ? "始めたばかり" : `達成率 ${h.rate4w}%`}</p>
                  </div>
                  <div className="flex gap-1.5" aria-label="この7日間">
                    {week.map((d) => (
                      <span
                        key={d}
                        title={d}
                        className={`flex h-7 flex-1 items-center justify-center rounded-[8px] text-[10px] ${h.recent.includes(d) ? "bg-success text-white" : "bg-surface-3 text-faint"}`}
                      >
                        {Number(d.slice(8, 10))}
                      </span>
                    ))}
                  </div>
                  {h.why && <p className="text-[12px] text-muted">{h.why}</p>}
                  <HabitStatusButtons id={h.id} status={h.status} />
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="新しい習慣を始める">
          <div className="card p-4">
            <NewHabitForm prefill={{ title: sp.title, why: sp.why, suggestionId: sp.suggestion }} />
          </div>
          <p className="mt-2 px-1 text-xs text-muted">続けるコツは「小さく始める」こと。毎朝の通知で、今日の習慣をお知らせします。</p>
        </Section>

        {resting.length > 0 && (
          <Section title="お休み中・身についた習慣">
            <div className="space-y-2.5">
              {resting.map((h) => (
                <div key={h.id} className="card space-y-2 p-4">
                  <p className="text-[15px]">
                    {h.title}
                    <span className="ml-1 text-[12px] text-muted">（{h.status === "done" ? "身についた" : "お休み中"}）</span>
                  </p>
                  <HabitStatusButtons id={h.id} status={h.status} />
                </div>
              ))}
            </div>
          </Section>
        )}
      </Page>
    </>
  );
}
