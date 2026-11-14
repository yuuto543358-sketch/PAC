import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { getSettings } from "@/lib/repo/settings";
import { createTask } from "@/lib/repo/tasks";
import { initWorkflow, setMember } from "@/lib/workflow/repo";
import { listEvents } from "./events";

// 先回りの準備：「これから起きること」が近づいたら、秘書（白石 結衣）がチームに下調べを頼む。
// 例：車検の30日前 → 相場・必要なもの・安くする方法・やることのチェックリストを報告書にしておく。
// チームは調べてまとめるだけ。予約・申し込み・支払いはしない（必要なら承認依頼の案）。

/** 何日前から準備を始めるか */
export const PREP_DAYS = 30;
/** 準備の業務を同時に進める上限（費用を抑えるため） */
const MAX_ACTIVE_PREP = 2;
const SECRETARY_ID = "secretary";

export async function runEventPrep(sql: Sql, today: string): Promise<string[]> {
  const settings = await getSettings(sql);
  if (!settings.life_prep_enabled || settings.emergency_stop) return [];
  const events = await listEvents(sql, today);
  const flags = await sql<{ id: string; prep: boolean; prep_for: string | null }[]>`
    select id, prep, to_char(prep_for, 'YYYY-MM-DD') as prep_for from life_events where status = 'active'`;
  const flag = new Map(flags.map((f) => [f.id, f]));
  const [{ n: active }] = await sql<{ n: number }[]>`
    select count(*)::int as n from life_events e join tasks t on t.id = e.prep_task_id
    where t.status not in ('completed','rejected','failed','on_hold')`;
  if (active >= MAX_ACTIVE_PREP) return [];
  const target = events.find((e) => {
    const f = flag.get(e.id);
    return f?.prep && e.nextDate && e.daysLeft != null && e.daysLeft >= 0 && e.daysLeft <= PREP_DAYS && f.prep_for !== e.nextDate;
  });
  if (!target || !target.nextDate) return [];
  const r = await createTask(sql, {
    title: `準備：${target.title}（${target.nextDate}）`.slice(0, 200),
    description: [
      `経営者の予定「${target.title}」が ${target.nextDate}（あと${target.daysLeft}日）にあります。秘書（白石 結衣）からの依頼で、前もって下調べをしてください。`,
      target.amount_jpy != null ? `経営者が見込んでいる費用: ${target.amount_jpy.toLocaleString("ja-JP")}円` : "",
      target.note ? `メモ: ${target.note}` : "",
      "成果物: いつまでに何をすればよいか（やることのチェックリストと期限）、費用の相場、安くする・楽にする方法、気をつけること。予定の種類に合わせて必要なものだけでよい（誕生日ならプレゼントの案など）。",
      "注意: 予約・申し込み・支払い・外部への連絡はしない（必要なら承認依頼の案として出す。実行は経営者が自分で行う）。分からないことは推測で埋めず「要確認」と書く。",
    ]
      .filter(Boolean)
      .join("\n"),
    source: "ai_discovered",
    priority: target.daysLeft! <= 7 ? "high" : "medium",
    assigneeId: "research",
    createdBy: { type: "employee", employeeId: SECRETARY_ID },
  });
  if (!r.created) {
    // 似た業務がすでにある（前に頼んだもの）。同じ回では二度と頼まない
    await sql`update life_events set prep_for = ${target.nextDate}::date where id = ${target.id}`;
    return [];
  }
  await initWorkflow(sql, r.task.id, true);
  await setMember(sql, r.task.id, SECRETARY_ID, "member");
  await sql`update life_events set prep_task_id = ${r.task.id}, prep_for = ${target.nextDate}::date, updated_at = now() where id = ${target.id}`;
  await audit(sql, "system", "life_event_prep", "life_event", target.id, { taskId: r.task.id });
  return [r.task.id];
}
