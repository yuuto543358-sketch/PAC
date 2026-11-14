import { getDb } from "@/lib/db";
import { jstDateParts, yen } from "@/lib/format";
import { listEvents, upcomingSummary } from "@/lib/life/events";
import { Empty, Page, PageHeader, Section, Stat } from "@/components/ui";
import { EventButtons, NewEventForm } from "../QolForms";

export const metadata = { title: "これから起きること" };

const REPEAT_LABEL: Record<string, string> = { none: "", monthly: "毎月", yearly: "毎年" };

function whenLabel(daysLeft: number | null) {
  if (daysLeft == null) return "";
  if (daysLeft < 0) return `${-daysLeft}日過ぎています`;
  if (daysLeft === 0) return "今日";
  if (daysLeft === 1) return "明日";
  return `あと${daysLeft}日`;
}

export default async function EventsPage() {
  const { date } = jstDateParts(new Date());
  const sql = await getDb();
  const events = await listEvents(sql, date);
  const s30 = upcomingSummary(events, 30);
  const s90 = upcomingSummary(events, 90);
  return (
    <>
      <PageHeader title="これから起きること" subtitle="担当：秘書 白石 結衣" back="/life" backLabel="ライフ" />
      <Page>
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label="30日以内の出費" value={yen(s30.amount)} sub={`${s30.events.length}件の予定`} />
          <Stat label="90日以内の出費" value={yen(s90.amount)} sub="分かっている分" />
        </div>
        <Section title="予定">
          {events.length === 0 ? (
            <Empty icon="clock">まだ予定はありません。車検・契約の更新・税金・誕生日などを登録すると、近づいたら白石がお知らせします。</Empty>
          ) : (
            <ul className="space-y-2.5">
              {events.map((e) => (
                <li key={e.id} className={`card p-4 ${e.remindNow ? "ring-2 ring-accent" : ""}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate text-[16px] font-semibold">{e.title}</p>
                    <p className={`shrink-0 text-[13px] font-semibold ${e.daysLeft != null && e.daysLeft <= e.remind_days ? "text-accent" : "text-muted"}`}>
                      {whenLabel(e.daysLeft)}
                    </p>
                  </div>
                  <p className="text-[12px] text-muted">
                    {e.nextDate}
                    {REPEAT_LABEL[e.repeat] && `・${REPEAT_LABEL[e.repeat]}`}
                    {e.amount_jpy != null && `・${yen(e.amount_jpy)}`}
                    {`・${e.remind_days === 0 ? "当日" : `${e.remind_days}日前`}にお知らせ`}
                  </p>
                  {e.note && <p className="mt-1 text-[13px]">{e.note}</p>}
                  <EventButtons id={e.id} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="予定を登録する">
          <div className="card p-4">
            <NewEventForm />
          </div>
          <p className="mt-2 px-1 text-xs text-muted">くり返す予定は「済んだ」を押すと、次の回（来月・来年）に進みます。</p>
        </Section>
      </Page>
    </>
  );
}
