// QOL（毎日のチェック・習慣・これから起きること・目標・週のふりかえり）のテスト
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { addDays } from "@/lib/life/planner";
import { checkinStats, getCheckin, listCheckins, qolScore, saveCheckin } from "@/lib/life/checkins";
import { computeProgress, createHabit, habitProgressList, setHabitLog, setHabitStatus, weekStart } from "@/lib/life/habits";
import { createEvent, listEvents, markEventDone, nextOccurrence, upcomingSummary } from "@/lib/life/events";
import { addGoalProgress, createGoal, getGoal, goalView, listGoals } from "@/lib/life/goals";
import { lastWeek, runWeeklyReview } from "@/lib/life/review";
import { morningDigest } from "@/lib/life/jobs";
import { qolForAi, qolSnapshot } from "@/lib/life/qolsnapshot";
import { listCategories } from "@/lib/life/repo";
import { runScheduledJobs } from "@/lib/autonomy/scheduler";
import { listHabits } from "@/lib/life/habits";

const TODAY = "2030-06-12"; // 水曜

async function reset() {
  const sql = await getDb();
  await sql`delete from life_reviews`;
  await sql`delete from life_goals`;
  await sql`delete from life_events`;
  await sql`delete from life_habits`;
  await sql`delete from life_checkins`;
  await sql`update company_settings set emergency_stop = false, life_review_enabled = true, last_life_review_on = null,
    life_question_frequency = 'off', last_life_analysis_on = '2099-12-31', autorun_frequency = 'off', sns_plan_frequency = 'off'`;
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, monthly_target_jpy = 100000,
    daily_limit_jpy = 100000, max_calls_per_day = 2000, max_calls_per_minute = 60`;
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

describe("毎日のQOLチェック", () => {
  it("1日1件。同じ日は上書きで直せる。7日より前や未来は記録できない", async () => {
    const sql = await getDb();
    await saveCheckin(sql, TODAY, TODAY, { mood: 4, energy: 3, sleep: 2, stress: 4, note: "" });
    await saveCheckin(sql, TODAY, TODAY, { mood: 5, energy: 4, sleep: 4, stress: 2, note: "よく寝た" });
    const c = (await getCheckin(sql, TODAY))!;
    expect(c).toMatchObject({ mood: 5, sleep: 4, note: "よく寝た" });
    expect(qolScore(c)).toBe(4.3); // (5+4+4+(6-2))/4 = 4.25 → 4.3
    await expect(saveCheckin(sql, addDays(TODAY, 1), TODAY, { mood: 3, energy: 3, sleep: 3, stress: 3, note: "" })).rejects.toThrow();
    await expect(saveCheckin(sql, addDays(TODAY, -8), TODAY, { mood: 3, energy: 3, sleep: 3, stress: 3, note: "" })).rejects.toThrow();
    await expect(saveCheckin(sql, TODAY, TODAY, { mood: 6, energy: 3, sleep: 3, stress: 3, note: "" })).rejects.toThrow(/1〜5/);
  });

  it("平均・変化・「よく眠れた日の気分」を計算する", async () => {
    const sql = await getDb();
    const days = [
      { m: 2, s: 1 }, { m: 2, s: 2 }, { m: 3, s: 2 },
      { m: 4, s: 4 }, { m: 5, s: 5 }, { m: 4, s: 4 },
    ];
    for (let i = 0; i < days.length; i++) {
      await saveCheckin(sql, addDays(TODAY, i - 5), TODAY, { mood: days[i].m, energy: 3, sleep: days[i].s, stress: 3, note: "" });
    }
    const st = checkinStats(await listCheckins(sql, addDays(TODAY, -30)))!;
    expect(st.days).toBe(6);
    expect(st.sleepMood).toEqual({ goodSleep: 4.3, badSleep: 2.3 });
    expect(st.trend).toBeGreaterThan(0);
    expect(checkinStats([])).toBeNull();
  });
});

describe("小さな習慣", () => {
  it("チェックすると続いた日数・今週の回数・達成率が出る", async () => {
    const sql = await getDb();
    const id = await createHabit(sql, { title: "寝る前にスマホを置く", frequency: "daily" });
    await sql`update life_habits set start_date = ${addDays(TODAY, -9)}::date where id = ${id}`;
    for (const d of [0, -1, -2, -4]) await setHabitLog(sql, id, addDays(TODAY, d), TODAY, true);
    const [p] = await habitProgressList(sql, TODAY);
    expect(p.doneToday).toBe(true);
    expect(p.streak).toBe(3);
    expect(p.thisWeek).toBe(3); // 月(10日)〜水(12日)
    expect(p.rate4w).toBe(40); // 10日中4日
    await setHabitLog(sql, id, TODAY, TODAY, false);
    const [p2] = await habitProgressList(sql, TODAY);
    expect(p2.doneToday).toBe(false);
    expect(p2.streak).toBe(2); // 今日まだなら昨日まで
    await expect(setHabitLog(sql, id, addDays(TODAY, 1), TODAY, true)).rejects.toThrow();
  });

  it("週ごとの習慣、月曜はじまりの週、休止中はチェックできない、提案から始める", async () => {
    expect(weekStart("2030-06-12")).toBe("2030-06-10");
    expect(weekStart("2030-06-16")).toBe("2030-06-10"); // 日曜
    const sql = await getDb();
    const id = await createHabit(sql, { title: "週3回歩く", frequency: "weekly", targetPerWeek: 3 });
    await setHabitStatus(sql, id, "paused");
    await expect(setHabitLog(sql, id, TODAY, TODAY, true)).rejects.toThrow(/休んで/);
    const proposed = await createHabit(sql, { title: "朝に白湯", frequency: "daily", status: "proposed", source: "ai" });
    expect(await habitProgressList(sql, TODAY)).toHaveLength(0);
    await setHabitStatus(sql, proposed, "active");
    expect((await habitProgressList(sql, TODAY)).map((h) => h.id)).toEqual([proposed]);
    const weekly = computeProgress({ id: "x", title: "", why: "", frequency: "weekly", target_per_week: 3, category_id: null, status: "active", source: "owner", suggestion_id: null, start_date: addDays(TODAY, -27), created_at: new Date() }, [addDays(TODAY, -1), addDays(TODAY, -8)], TODAY);
    expect(weekly.thisWeek).toBe(1);
  });
});

describe("これから起きること", () => {
  it("くり返す予定は次の回を出し、「済んだ」で次へ進む。くり返さない予定は終わる", () => {
    expect(nextOccurrence({ event_date: "1990-05-10", repeat: "yearly", last_done_date: null, created_on: TODAY })).toBe("2031-05-10");
    expect(nextOccurrence({ event_date: "2030-01-31", repeat: "monthly", last_done_date: null, created_on: TODAY })).toBe("2030-06-30");
    expect(nextOccurrence({ event_date: "2030-07-01", repeat: "monthly", last_done_date: "2030-07-01", created_on: TODAY })).toBe("2030-08-01");
    expect(nextOccurrence({ event_date: "2030-06-01", repeat: "none", last_done_date: null, created_on: TODAY })).toBe("2030-06-01");
    expect(nextOccurrence({ event_date: "2030-06-01", repeat: "none", last_done_date: "2030-06-01", created_on: TODAY })).toBeNull();
  });

  it("近づいた予定と、出ていくお金の合計が分かる", async () => {
    const sql = await getDb();
    const car = await createEvent(sql, { title: "車検", date: addDays(TODAY, 5), repeat: "none", amountJpy: 80000, remindDays: 14 });
    await createEvent(sql, { title: "保険の更新", date: addDays(TODAY, 40), repeat: "yearly", amountJpy: 30000, remindDays: 7 });
    const list = await listEvents(sql, TODAY);
    expect(list[0]).toMatchObject({ title: "車検", daysLeft: 5, remindNow: true });
    expect(list[1].remindNow).toBe(false);
    expect(upcomingSummary(list, 30).amount).toBe(80000);
    expect(upcomingSummary(list, 60).amount).toBe(110000);
    await markEventDone(sql, car);
    expect((await listEvents(sql, TODAY)).map((e) => e.title)).toEqual(["保険の更新"]);
  });
});

describe("目標", () => {
  it("進み具合（%）と遅れ気味かどうか。減らす目標にも対応し、届いたら達成になる", async () => {
    const sql = await getDb();
    const id = await createGoal(sql, { title: "体重を3kg減らす", unit: "kg", startValue: 70, targetValue: 67, dueDate: "2099-12-31" });
    await addGoalProgress(sql, id, 69, "");
    let g = (await getGoal(sql, id, TODAY))!;
    expect(g.pct).toBe(33);
    const r = await addGoalProgress(sql, id, 66.8, "やった");
    expect(r.achieved).toBe(true);
    g = (await getGoal(sql, id, TODAY))!;
    expect(g.status).toBe("achieved");
    expect(await listGoals(sql, TODAY)).toHaveLength(0);
    const v = goalView({ id: "x", title: "", why: "", category_id: null, unit: "円", start_value: 0, target_value: 300000, due_date: "2030-12-31", status: "active", created_on: "2030-01-01", latest_value: 50000, latest_at: null }, TODAY);
    expect(v.pct).toBe(17);
    expect(v.behind).toBe(true);
  });
});

describe("週のふりかえり・朝のお知らせ・分析への反映", () => {
  it("先週＝月曜〜日曜", () => {
    expect(lastWeek("2030-06-12")).toEqual({ start: "2030-06-03", end: "2030-06-09" });
    expect(lastWeek("2030-06-10")).toEqual({ start: "2030-06-03", end: "2030-06-09" });
  });

  it("記録がなければAIを呼ばない。記録があれば、ふりかえりとおすすめの習慣（まだ始めない）を作る", async () => {
    const sql = await getDb();
    const empty = await runWeeklyReview(sql, "manual");
    expect(empty.aiUsed).toBe(false);
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
    await saveCheckin(sql, today, today, { mood: 3, energy: 3, sleep: 2, stress: 4, note: "" });
    const h = await createHabit(sql, { title: "散歩", frequency: "daily" });
    await setHabitLog(sql, h, today, today, true);
    const r = await runWeeklyReview(sql, "manual");
    expect(r.aiUsed).toBe(true);
    expect(r.proposedHabits).toBe(1);
    const proposed = await listHabits(sql, ["proposed"]);
    expect(proposed[0]).toMatchObject({ title: "寝る前にストレッチ", source: "ai" });
    const [rev] = await sql<{ ai_summary: string }[]>`select ai_summary from life_reviews where id = ${r.reviewId}`;
    expect(rev.ai_summary).toContain("来週の一歩");
    // 同じ習慣は二度すすめない
    const r2 = await runWeeklyReview(sql, "manual");
    expect(r2.proposedHabits).toBe(0);
  });

  it("「健康・運動」をAIに渡さない設定なら、QOLチェックはAIに渡さない", async () => {
    const sql = await getDb();
    await saveCheckin(sql, TODAY, TODAY, { mood: 3, energy: 3, sleep: 3, stress: 3, note: "" });
    await sql`update life_categories set ai_allowed = false where id = 'health'`;
    const snap = await qolSnapshot(sql, TODAY, 7);
    expect(snap.qol).not.toBeNull();
    expect(qolForAi(snap, await listCategories(sql)).qol).toBeNull();
    await sql`update life_categories set ai_allowed = true`;
  });

  it("朝のお知らせは1つにまとめる（習慣・質問・近づいた予定）", async () => {
    const sql = await getDb();
    await sql`delete from life_questions`;
    expect(await morningDigest(sql, TODAY)).toBeNull();
    await createHabit(sql, { title: "水を飲む", frequency: "daily" });
    await createEvent(sql, { title: "車検", date: addDays(TODAY, 3), repeat: "none", amountJpy: null, remindDays: 7 });
    const body = await morningDigest(sql, TODAY);
    expect(body).toBe("今日の習慣1つ・「車検」まであと3日");
    const rows = await sql<{ title: string; url: string }[]>`select title, url from notifications where dedupe_key = ${`morning:${TODAY}`}`;
    expect(rows[0]).toMatchObject({ url: "/" });
  });

  it("月曜の朝に、先週のふりかえりを自動で作る（同じ日に2回は作らない）", async () => {
    const sql = await getDb();
    await sql`update company_settings set last_life_review_on = null, last_life_question_on = null`;
    const monday = new Date("2030-06-10T00:00:00Z");
    await saveCheckin(sql, "2030-06-05", "2030-06-10", { mood: 4, energy: 4, sleep: 4, stress: 2, note: "" });
    const r1 = await runScheduledJobs(sql, monday);
    expect(r1.ran).toContain("life_review");
    expect(r1.life?.review?.aiUsed).toBe(true);
    const r2 = await runScheduledJobs(sql, monday);
    expect(r2.ran).not.toContain("life_review");
  });
});
