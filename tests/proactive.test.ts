// AI社員が裏で動く仕事（先回りの準備・変化への声かけ・自主研究・1日に何回も動く）のテスト
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { addDays } from "@/lib/life/planner";
import { saveCheckin } from "@/lib/life/checkins";
import { createHabit, setHabitLog } from "@/lib/life/habits";
import { createEvent } from "@/lib/life/events";
import { createGoal } from "@/lib/life/goals";
import { runEventPrep } from "@/lib/life/prep";
import { activeNudges, detectNudges, dismissNudge, runNudges } from "@/lib/life/nudges";
import { researcherFor, runSelfResearch } from "@/lib/life/research";
import { runScheduledJobs } from "@/lib/autonomy/scheduler";

const TODAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

async function reset() {
  const sql = await getDb();
  await sql`delete from life_nudges`;
  await sql`update life_events set prep_task_id = null`;
  await sql`delete from life_events`;
  await sql`delete from life_goals`;
  await sql`delete from life_habits`;
  await sql`delete from life_checkins`;
  await sql`update tasks set status = 'completed', completed_at = now() where status not in ('completed','rejected','failed')`;
  await sql`update company_settings set emergency_stop = false, life_prep_enabled = true, life_nudge_enabled = true,
    life_research_enabled = true, web_research_enabled = true, last_life_nudge_on = null, last_life_prep_on = null,
    last_life_research_on = null, life_question_frequency = 'off', last_life_analysis_on = '2099-12-31',
    last_life_review_on = '2099-12-31', autorun_frequency = 'off', sns_plan_frequency = 'off'`;
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, monthly_target_jpy = 100000,
    daily_limit_jpy = 100000, max_calls_per_day = 2000, max_calls_per_minute = 60, max_calls_per_task = 20`;
  await sql.begin(async (tx) => {
    await tx`alter table api_usage disable trigger api_usage_guard`;
    await tx`update api_usage set created_at = created_at - interval '2 minutes' where created_at > now() - interval '2 minutes'`;
    await tx`alter table api_usage enable trigger api_usage_guard`;
  });
}

beforeAll(async () => {
  await closeDb();
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await closeDb();
});

describe("② 先回りの準備", () => {
  it("30日以内の予定はチームに下調べを頼む（秘書が依頼・同じ回は二度頼まない・1日1件）", async () => {
    const sql = await getDb();
    const car = await createEvent(sql, { title: "車検", date: addDays(TODAY, 20), repeat: "none", amountJpy: 80000, remindDays: 14 });
    await createEvent(sql, { title: "遠い予定", date: addDays(TODAY, 60), repeat: "none", amountJpy: null, remindDays: 7 });
    await createEvent(sql, { title: "誕生日", date: addDays(TODAY, 10), repeat: "yearly", amountJpy: null, remindDays: 7, prep: false });
    const ids = await runEventPrep(sql, TODAY);
    expect(ids).toHaveLength(1);
    const [t] = await sql<{ title: string; created_by_employee_id: string; source: string }[]>`select title, created_by_employee_id, source from tasks where id = ${ids[0]}`;
    expect(t.title).toBe(`準備：車検（${addDays(TODAY, 20)}）`);
    expect(t).toMatchObject({ created_by_employee_id: "secretary", source: "ai_discovered" });
    const members = await sql<{ employee_id: string }[]>`select employee_id from task_members where task_id = ${ids[0]}`;
    expect(members.map((m) => m.employee_id)).toContain("secretary");
    const [e] = await sql<{ prep_task_id: string }[]>`select prep_task_id from life_events where id = ${car}`;
    expect(e.prep_task_id).toBe(ids[0]);
    // 2回目：車検はもう頼んだ。誕生日は「頼まない」設定。遠い予定は30日より先
    expect(await runEventPrep(sql, TODAY)).toHaveLength(0);
  });

  it("設定でオフにできる", async () => {
    const sql = await getDb();
    await sql`update company_settings set life_prep_enabled = false`;
    await createEvent(sql, { title: "更新", date: addDays(TODAY, 5), repeat: "none", amountJpy: null, remindDays: 7 });
    expect(await runEventPrep(sql, TODAY)).toHaveLength(0);
  });
});

describe("③ 変化に気づいて声かけ", () => {
  it("調子が3日続けて低い・習慣が3日お休み・予定を過ぎた・目標が遅れ気味 を見つける", async () => {
    const sql = await getDb();
    for (const d of [-2, -1, 0]) await saveCheckin(sql, addDays(TODAY, d), TODAY, { mood: 2, energy: 2, sleep: 2, stress: 4, note: "" });
    const h = await createHabit(sql, { title: "散歩", frequency: "daily" });
    await sql`update life_habits set start_date = ${addDays(TODAY, -10)}::date where id = ${h}`;
    await setHabitLog(sql, h, addDays(TODAY, -5), TODAY, true);
    await createEvent(sql, { title: "税金の支払い", date: addDays(TODAY, -2), repeat: "none", amountJpy: null, remindDays: 7 });
    const g = await createGoal(sql, { title: "貯金30万円", unit: "円", startValue: 0, targetValue: 300000, dueDate: addDays(TODAY, 10) });
    await sql`update life_goals set created_at = now() - interval '200 days' where id = ${g}`;
    const kinds = (await detectNudges(sql, TODAY)).map((n) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(["qol_low", "habit_break", "event_overdue", "goal_behind"]));
  });

  it("森野のひとことにして保存（1日3件まで）。同じことは7日以内に二度言わない。閉じられる", async () => {
    const sql = await getDb();
    for (const d of [-2, -1, 0]) await saveCheckin(sql, addDays(TODAY, d), TODAY, { mood: 1, energy: 2, sleep: 1, stress: 5, note: "" });
    await createEvent(sql, { title: "支払い", date: addDays(TODAY, -1), repeat: "none", amountJpy: null, remindDays: 7 });
    const n = await runNudges(sql, TODAY);
    expect(n).toBe(2);
    const list = await activeNudges(sql);
    expect(list.every((x) => x.body.startsWith("【テスト用モック】"))).toBe(true);
    expect(await runNudges(sql, TODAY)).toBe(0);
    await dismissNudge(sql, list[0].id);
    expect(await activeNudges(sql)).toHaveLength(1);
  });

  it("記録がなければ何もしない（AIも呼ばない）", async () => {
    const sql = await getDb();
    const [{ n: before }] = await sql<{ n: number }[]>`select count(*)::int as n from api_usage`;
    expect(await runNudges(sql, TODAY)).toBe(0);
    const [{ n: after }] = await sql<{ n: number }[]>`select count(*)::int as n from api_usage`;
    expect(after).toBe(before);
  });
});

describe("④ 社員の自主研究", () => {
  it("担当は週ごとに交代する", () => {
    const a = researcherFor("2030-06-13");
    const b = researcherFor("2030-06-20");
    expect(a).not.toBe(b);
    expect(researcherFor("2030-06-14")).toBe(a);
  });

  it("メモを報告書と、その社員の記憶に残す（Web検索で見たページも載せる）", async () => {
    const sql = await getDb();
    const r = await runSelfResearch(sql, "2030-06-13", "manual");
    expect(r.reportId).toBeTruthy();
    const [rep] = await sql<{ report_type: string; title: string; content: string; employee_id: string }[]>`
      select report_type, title, content, employee_id from reports where id = ${r.reportId}`;
    expect(rep.report_type).toBe("employee");
    expect(rep.employee_id).toBe(researcherFor("2030-06-13"));
    expect(rep.content).toContain("参考にしたページ");
    const k = await sql`select 1 from knowledge where employee_id = ${rep.employee_id} and category = 'note' and title like '自主研究：%'`;
    expect(k.length).toBeGreaterThan(0);
  });
});

describe("① 1日に何回も動いても大丈夫", () => {
  it("同じ日に何回呼ばれても、声かけ・準備・自主研究は1回ずつ。最後に動いた時刻を記録する", async () => {
    const sql = await getDb();
    await createEvent(sql, { title: "更新手続き", date: addDays("2030-06-13", 10), repeat: "none", amountJpy: null, remindDays: 7 });
    for (const d of [-2, -1, 0]) {
      await sql`insert into life_checkins (check_date, mood, energy, sleep, stress) values (${addDays("2030-06-13", d)}::date, 1, 1, 1, 5)`;
    }
    const thursday = new Date("2030-06-13T03:00:00Z"); // 木曜 12:00（日本時間）
    const r1 = await runScheduledJobs(sql, thursday);
    expect(r1.ran).toEqual(expect.arrayContaining(["life_nudges", "life_prep", "self_research"]));
    const r2 = await runScheduledJobs(sql, new Date("2030-06-13T08:30:00Z"));
    expect(r2.ran).not.toContain("life_nudges");
    expect(r2.ran).not.toContain("life_prep");
    expect(r2.ran).not.toContain("self_research");
  });
});
