import "server-only";
import type { Db, Sql } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { addDays } from "./planner";

// これから起きること（車検・契約の更新・税金・誕生日など）。秘書（白石 結衣）が近づいたら知らせる。AIは使わない。

export type LifeEvent = {
  id: string;
  title: string;
  event_date: string;
  repeat: "none" | "monthly" | "yearly";
  amount_jpy: number | null;
  remind_days: number;
  category_id: string | null;
  note: string;
  last_done_date: string | null;
  status: "active" | "archived";
  created_on: string;
};

export type UpcomingEvent = LifeEvent & { nextDate: string | null; daysLeft: number | null; remindNow: boolean };

const COLS = `id, title, to_char(event_date, 'YYYY-MM-DD') as event_date, repeat, amount_jpy, remind_days, category_id, note,
  to_char(last_done_date, 'YYYY-MM-DD') as last_done_date, status,
  to_char((created_at at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD') as created_on`;

function addMonthsKeepDay(date: string, months: number, day: number): string {
  const [y, m] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** 次の予定日。くり返す予定は「最後に済んだ日の次」か「登録した日以降」の最初の回 */
export function nextOccurrence(e: Pick<LifeEvent, "event_date" | "repeat" | "last_done_date" | "created_on">): string | null {
  if (e.repeat === "none") return e.last_done_date && e.last_done_date >= e.event_date ? null : e.event_date;
  const day = Number(e.event_date.slice(8, 10));
  // 基準日：最後に済んだ日の翌日。まだ一度も済んでいなければ「登録した日」と「最初の日付」の遅いほう
  const ref = e.last_done_date ? addDays(e.last_done_date, 1) : e.created_on > e.event_date ? e.created_on : e.event_date;
  const step = e.repeat === "monthly" ? 1 : 12;
  let cur = e.event_date;
  for (let i = 0; i < 2400 && cur < ref; i++) cur = addMonthsKeepDay(e.event_date, step * (i + 1), day);
  return cur;
}

export function withNext(e: LifeEvent, today: string): UpcomingEvent {
  const nextDate = e.status === "active" ? nextOccurrence(e) : null;
  const daysLeft = nextDate ? Math.round((Date.parse(nextDate) - Date.parse(today)) / 86_400_000) : null;
  return { ...e, nextDate, daysLeft, remindNow: daysLeft != null && daysLeft <= e.remind_days };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createEvent(
  sql: Sql,
  v: { title: string; date: string; repeat: string; amountJpy: number | null; remindDays: number; categoryId?: string | null; note?: string },
): Promise<string> {
  const title = v.title.trim().slice(0, 80);
  if (!title) throw new Error("予定の名前を入力してください");
  if (!DATE_RE.test(v.date)) throw new Error("日付を選んでください");
  const repeat = ["none", "monthly", "yearly"].includes(v.repeat) ? v.repeat : "none";
  if (v.amountJpy != null && !(v.amountJpy >= 0 && v.amountJpy <= 100_000_000)) throw new Error("金額が正しくありません");
  const remind = Math.min(90, Math.max(0, Math.round(v.remindDays)));
  const [row] = await sql<{ id: string }[]>`
    insert into life_events (title, event_date, repeat, amount_jpy, remind_days, category_id, note)
    values (${title}, ${v.date}::date, ${repeat}, ${v.amountJpy}, ${remind}, ${v.categoryId ?? null}, ${(v.note ?? "").slice(0, 500)})
    returning id`;
  await audit(sql, "owner", "life_event_created", "life_event", row.id);
  return row.id;
}

export async function listEvents(db: Db, today: string, includeArchived = false): Promise<UpcomingEvent[]> {
  const rows = await db.unsafe<LifeEvent[]>(
    `select ${COLS} from life_events ${includeArchived ? "" : "where status = 'active'"} order by event_date`,
    [],
    { simple: false },
  );
  return rows
    .map((e) => withNext({ ...e, amount_jpy: e.amount_jpy == null ? null : Number(e.amount_jpy) }, today))
    .sort((a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999"));
}

/** 「済んだ」：この回を終わりにする（くり返す予定は次の回へ、くり返さない予定は終了） */
export async function markEventDone(sql: Sql, id: string) {
  const [e] = await sql<LifeEvent[]>`select ${sql.unsafe(COLS)} from life_events where id = ${id}`;
  if (!e) throw new Error("予定が見つかりません");
  const next = nextOccurrence(e);
  if (!next) throw new Error("この予定は、もう済んでいます");
  await sql`
    update life_events set last_done_date = ${next}::date,
      status = case when repeat = 'none' then 'archived' else status end, updated_at = now()
    where id = ${id}`;
}

export async function archiveEvent(sql: Sql, id: string) {
  const rows = await sql`update life_events set status = 'archived', updated_at = now() where id = ${id} returning id`;
  if (rows.length === 0) throw new Error("予定が見つかりません");
}

/** これから days 日のあいだの予定と、出ていくお金の合計（分かっている分） */
export function upcomingSummary(events: UpcomingEvent[], days: number) {
  const within = events.filter((e) => e.daysLeft != null && e.daysLeft <= days);
  return { events: within, amount: within.reduce((a, e) => a + (e.amount_jpy ?? 0), 0) };
}
