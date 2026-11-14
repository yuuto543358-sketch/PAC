// ライフインテリジェンスのテスト（AI_MOCK=1 のテスト用応答で動かす）
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import {
  addRecord,
  deleteRecord,
  formatRecordValue,
  getField,
  latestRecords,
  listCategories,
  listFields,
  listRecords,
  parseValue,
  recordHistory,
  updateRecord,
} from "@/lib/life/repo";
import { addDays, isQuestionDay, planQuestions, targetPeriod } from "@/lib/life/planner";
import { computeStats, monthsAgo, statsForAi } from "@/lib/life/stats";
import { runLifeAnalysis } from "@/lib/life/analysis";
import { getSuggestion, listSuggestions, setSuggestionStatus } from "@/lib/life/suggestions";
import { recordsSince } from "@/lib/life/repo";
import { analysisPeriodsFor } from "@/lib/life/jobs";
import { suggestionToTeam } from "@/lib/life/team";
import { buildLifeSnapshot } from "@/lib/life/snapshot";
import { runWorkflows } from "@/lib/workflow/engine";
import { listMembers, listRoomMessages, getWorkflow } from "@/lib/workflow/repo";
import { buildChatSystemPrompt } from "@/lib/ai/prompts";
import { runScheduledJobs } from "@/lib/autonomy/scheduler";
import { answerQuestion, createQuestionBatch, listQuestions, openQuestions, previewNextQuestions } from "@/lib/life/questions";

/** 生活情報をまっさらにする（テスト用DBだけで行う操作） */
export async function resetLife() {
  const sql = await getDb();
  await sql`delete from life_suggestions`;
  await sql`delete from life_reports`;
  await sql`delete from life_questions`;
  await sql`delete from life_records`;
  await sql`delete from life_fields where created_by <> 'system'`;
  await sql`update life_categories set is_active = true, ai_allowed = true`;
  await sql`update company_settings set life_question_frequency = 'normal', life_questions_per_batch = 3,
    life_auto_task = true, last_life_question_on = null, last_life_analysis_on = null, emergency_stop = false`;
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
beforeEach(resetLife);
afterAll(async () => {
  await resetLife();
  await closeDb();
});

describe("Phase 1：生活情報の保存と管理", () => {
  it("新しい部署・社員・カテゴリ・項目が用意されている（既存の社員はそのまま）", async () => {
    const sql = await getDb();
    const emps = await sql<{ id: string }[]>`select id from employees order by sort_order`;
    expect(emps.map((e) => e.id)).toEqual(["president", "bizdev", "research", "creative", "secretary", "finance", "life"]);
    const cats = await listCategories(sql);
    expect(cats.map((c) => c.id)).toEqual(["money", "home", "car", "health", "pet", "work", "hobby"]);
    const fields = await listFields(sql);
    expect(fields.find((f) => f.id === "phone_bill")).toMatchObject({ unit: "円/月", kind: "state", importance: 5 });
    expect(fields.find((f) => f.id === "food_monthly")).toMatchObject({ kind: "periodic", period: "month" });
  });

  it("値は項目の種類に合わせて確かめる", () => {
    const num = { value_type: "number" as const, choices: [], label: "携帯電話料金" };
    expect(parseValue(num, "3,980円")).toEqual({ num: 3980, text: "" });
    expect(parseValue(num, "３９８０")).toEqual({ num: 3980, text: "" });
    expect(() => parseValue(num, "たぶん4000")).toThrow(/数字/);
    expect(() => parseValue(num, "-5")).toThrow();
    expect(() => parseValue(num, "")).toThrow();
    const choice = { value_type: "choice" as const, choices: ["はい", "いいえ"], label: "車" };
    expect(parseValue(choice, "はい").text).toBe("はい");
    expect(() => parseValue(choice, "たぶん")).toThrow(/選択肢/);
  });

  it("上書きしない：料金が変わったら、前の値も残る", async () => {
    const sql = await getDb();
    await addRecord(sql, { fieldId: "phone_bill", raw: "3000" });
    await addRecord(sql, { fieldId: "phone_bill", raw: "4000" });
    const all = await listRecords(sql, "phone_bill");
    expect(all.map((r) => Number(r.value_num))).toEqual([4000, 3000]);
    const latest = (await latestRecords(sql)).get("phone_bill")!;
    expect(Number(latest.value_num)).toBe(4000);
    expect(latest.source).toBe("owner");
    const f = (await getField(sql, "phone_bill"))!;
    expect(formatRecordValue(f, latest)).toBe("4,000円/月");
  });

  it("修正すると履歴が残り、履歴は変更できない", async () => {
    const sql = await getDb();
    const id = await addRecord(sql, { fieldId: "rent", raw: "65000" });
    await updateRecord(sql, id, "62000", "打ち間違い");
    const h = await recordHistory(sql, id);
    expect(h).toHaveLength(1);
    expect(Number(h[0].old_value_num)).toBe(65000);
    expect(Number(h[0].new_value_num)).toBe(62000);
    expect(h[0].reason).toBe("打ち間違い");
    await expect(sql`update life_record_history set reason = 'x' where record_id = ${id}`).rejects.toThrow(/変更できません/);
  });

  it("削除すると、記録と履歴が完全に消え、操作履歴に中身は残らない", async () => {
    const sql = await getDb();
    const id = await addRecord(sql, { fieldId: "weight", raw: "65.5" });
    await updateRecord(sql, id, "64.8", "");
    await deleteRecord(sql, id);
    expect(await sql`select 1 from life_records where id = ${id}`).toHaveLength(0);
    expect(await sql`select 1 from life_record_history where record_id = ${id}`).toHaveLength(0);
    const [log] = await sql<{ detail: Record<string, unknown> }[]>`
      select detail from audit_logs where action = 'life_record_deleted' and target_id = ${id}`;
    expect(log.detail).toEqual({ field: "weight" });
  });
});

describe("Phase 2：質問・回答・履歴", () => {
  it("期間ごとの項目は、月なら先月・週ならきのうまでの7日間について聞く", () => {
    expect(targetPeriod({ period: "month" }, "2026-01-05")).toEqual({ start: "2025-12-01", end: "2025-12-31", label: "先月（12月）" });
    expect(targetPeriod({ period: "month" }, "2026-03-01")).toEqual({ start: "2026-02-01", end: "2026-02-28", label: "先月（2月）" });
    expect(targetPeriod({ period: "week" }, "2026-11-14")).toEqual({ start: "2026-11-07", end: "2026-11-13", label: "この1週間" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("質問の日：停止なら作らない、使い始めは毎日、ふつうは月曜と木曜", () => {
    expect(isQuestionDay("off", 1, true)).toBe(false);
    expect(isQuestionDay("normal", 2, true)).toBe(true);
    expect(isQuestionDay("normal", 1, false)).toBe(true);
    expect(isQuestionDay("normal", 4, false)).toBe(true);
    expect(isQuestionDay("normal", 2, false)).toBe(false);
    expect(isQuestionDay("low", 4, false)).toBe(false);
    expect(isQuestionDay("high", 6, false)).toBe(true);
  });

  it("大事な情報から、1回に最大3問だけ聞く。理由も付く", async () => {
    const sql = await getDb();
    const r = await createQuestionBatch(sql, "manual");
    expect(r.created).toBe(3);
    const qs = await openQuestions(sql);
    expect(qs).toHaveLength(3);
    // 大事さ5の「家賃」「携帯電話料金」が先に来る
    expect(qs.map((q) => q.field_id)).toEqual(expect.arrayContaining(["rent", "phone_bill"]));
    for (const q of qs) expect(q.reason.length).toBeGreaterThan(0);
    // 回答待ちが3問あるうちは、新しい質問を作らない
    const r2 = await createQuestionBatch(sql, "manual");
    expect(r2.created).toBe(0);
  });

  it("答えると記録になり、同じことは聞かない。スキップ・分からない・後で も選べる", async () => {
    const sql = await getDb();
    await createQuestionBatch(sql, "manual");
    const [a, b, c] = await openQuestions(sql);
    const ans = await answerQuestion(sql, a.id, "answer", a.value_type === "choice" ? a.choices![0] : "5000");
    expect(ans.status).toBe("answered");
    await answerQuestion(sql, b.id, "skip");
    await answerQuestion(sql, c.id, "later");
    await expect(answerQuestion(sql, a.id, "answer", "1")).rejects.toThrow(/もう答えて/);
    const rec = (await latestRecords(sql)).get(a.field_id!)!;
    expect(rec.question_id).toBe(a.id);
    expect(rec.source).toBe("owner");
    // 次の質問：答えた・スキップした・後での項目は出てこない
    const r = await createQuestionBatch(sql, "manual");
    const next = (await openQuestions(sql)).map((q) => q.field_id);
    expect(r.created).toBeGreaterThan(0);
    expect(next).not.toContain(a.field_id);
    expect(next).not.toContain(b.field_id);
    expect(next).not.toContain(c.field_id);
    expect((await listQuestions(sql, ["skipped"])).map((q) => q.id)).toContain(b.id);
  });

  it("「後で」は2日たつと、もう一度回答待ちに出る", async () => {
    const sql = await getDb();
    await createQuestionBatch(sql, "manual");
    const [a] = await openQuestions(sql);
    await answerQuestion(sql, a.id, "later");
    expect((await openQuestions(sql)).map((q) => q.id)).not.toContain(a.id);
    await sql`update life_questions set remind_after = now() - interval '1 minute' where id = ${a.id}`;
    expect((await openQuestions(sql)).map((q) => q.id)).toContain(a.id);
  });

  it("十分な情報がある項目は聞かず、古くなったら確認する。条件つきの項目は条件を満たすときだけ", async () => {
    const sql = await getDb();
    const fields = await listFields(sql);
    const categories = await listCategories(sql);
    await addRecord(sql, { fieldId: "rent", raw: "60000" });
    await addRecord(sql, { fieldId: "car_owned", raw: "いいえ" });
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const plan = (latest: Awaited<ReturnType<typeof latestRecords>>) =>
      planQuestions({ fields, categories, latest, lastQuestions: new Map(), today, now, limit: 100 }).map((c) => c.field.id);
    let ids = plan(await latestRecords(sql));
    expect(ids).not.toContain("rent");
    expect(ids).not.toContain("car_cost_monthly"); // 車を持っていない
    await sql`update life_records set confirmed_at = now() - interval '200 days' where field_id = 'rent'`;
    ids = plan(await latestRecords(sql));
    expect(ids).toContain("rent");
    const stale = planQuestions({ fields, categories, latest: await latestRecords(sql), lastQuestions: new Map(), today, now, limit: 100 }).find((c) => c.field.id === "rent")!;
    expect(stale.why).toBe("stale");
    expect(stale.reason).toMatch(/変わっていないか/);
  });

  it("使わないカテゴリの質問はしない。頻度「停止」なら自動では作らない", async () => {
    const sql = await getDb();
    await sql`update life_categories set is_active = false where id <> 'pet'`;
    await createQuestionBatch(sql, "manual");
    const qs = await openQuestions(sql);
    expect(qs.every((q) => q.category_id === "pet")).toBe(true);
    await sql`update company_settings set life_question_frequency = 'off'`;
    const r = await createQuestionBatch(sql, "scheduled");
    expect(r.created).toBe(0);
  });

  it("次の質問の予定を確認できる（質問は作らない）", async () => {
    const sql = await getDb();
    const p = await previewNextQuestions(sql);
    expect(p.candidates.length).toBeGreaterThan(0);
    expect(p.nextDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await openQuestions(sql)).toHaveLength(0);
  });
});

describe("Phase 4：集計・AIの分析・改善提案", () => {
  async function seedData() {
    const sql = await getDb();
    await addRecord(sql, { fieldId: "rent", raw: "60000" });
    await addRecord(sql, { fieldId: "phone_bill", raw: "3000" });
    await sql`update life_records set confirmed_at = now() - interval '20 days' where field_id = 'phone_bill'`;
    await addRecord(sql, { fieldId: "phone_bill", raw: "6500" });
    await addRecord(sql, { fieldId: "car_owned", raw: "いいえ" });
    const today = new Date().toISOString().slice(0, 10);
    await addRecord(sql, { fieldId: "food_monthly", raw: "40000", periodStart: monthsAgo(today, 2).slice(0, 8) + "01", periodEnd: monthsAgo(today, 2).slice(0, 8) + "28" });
    await addRecord(sql, { fieldId: "food_monthly", raw: "50000", periodStart: monthsAgo(today, 1).slice(0, 8) + "01", periodEnd: monthsAgo(today, 1).slice(0, 8) + "28" });
    await addRecord(sql, { fieldId: "exercise_week", raw: "ほぼしていない", periodEnd: today });
    return sql;
  }

  it("固定費の合計・月ごとの推移・変わったこと・足りない情報を、プログラムが計算する", async () => {
    const sql = await seedData();
    const today = new Date().toISOString().slice(0, 10);
    const [fields, categories, latest, records] = await Promise.all([listFields(sql), listCategories(sql), latestRecords(sql), recordsSince(sql, monthsAgo(today, 12))]);
    const st = computeStats({ fields, categories, records, latest, months: 3, today, now: new Date() });
    expect(st.fixedCosts.total).toBe(60000 + 6500);
    expect(st.fixedCosts.missing).toContain("インターネット料金");
    expect(st.fixedCosts.missing).not.toContain("車の維持費"); // 車を持っていない
    const food = st.monthly.find((m) => m.fieldId === "food_monthly")!;
    expect(food.series.map((p) => p.value)).toEqual([40000, 50000]);
    expect(food.changePct).toBe(25);
    expect(st.stateChanges.find((c) => c.fieldId === "phone_bill")).toMatchObject({ from: "3,000円/月", to: "6,500円/月" });
    expect(st.exercise?.lowShare).toBe(100);
    expect(st.gaps).toContain("毎月の手取り収入");
  });

  it("「AIに渡さない」カテゴリの情報は、AIに渡す内容から外す", async () => {
    const sql = await seedData();
    await sql`update life_categories set ai_allowed = false where id = 'home'`;
    const today = new Date().toISOString().slice(0, 10);
    const [fields, categories, latest, records] = await Promise.all([listFields(sql), listCategories(sql), latestRecords(sql), recordsSince(sql, monthsAgo(today, 12))]);
    const ai = statsForAi(computeStats({ fields, categories, records, latest, months: 3, today, now: new Date() }), categories);
    expect(JSON.stringify(ai)).not.toContain("携帯電話料金");
    expect(ai.fixedCosts.items).toHaveLength(0);
    expect(ai.excludedCategories).toContain("住居・生活環境");
    expect(ai.monthly.map((m) => m.fieldId)).toContain("food_monthly"); // 家計はそのまま
  });

  it("記録がなければAIを呼ばずに「分析できません」と記録する（0円）", async () => {
    const sql = await getDb();
    const [{ n: before }] = await sql<{ n: number }[]>`select count(*)::int as n from api_usage`;
    const r = await runLifeAnalysis(sql, 1, "manual");
    const [{ n: after }] = await sql<{ n: number }[]>`select count(*)::int as n from api_usage`;
    expect(after).toBe(before);
    expect(r.aiUsed).toBe(false);
    const [rep] = await sql<{ ai_summary: string; data_gaps: string[] }[]>`select ai_summary, data_gaps from life_reports where id = ${r.reportId}`;
    expect(rep.ai_summary).toMatch(/分析できません/);
    expect(rep.data_gaps.length).toBeGreaterThan(0);
  });

  it("分析すると、レポート・改善提案（7つの項目）・追加の質問ができ、同じ提案は二度出さない", async () => {
    const sql = await seedData();
    const r = await runLifeAnalysis(sql, 1, "manual");
    expect(r.aiUsed).toBe(true);
    expect(r.suggestionIds).toHaveLength(1);
    const s = (await getSuggestion(sql, r.suggestionIds[0]))!;
    for (const k of ["problem", "evidence", "benefit", "cost_text", "difficulty", "priority", "recommendation"] as const) {
      expect(String(s[k]).length).toBeGreaterThan(0);
    }
    expect(s.is_estimate).toBe(true);
    expect(s.needs_team).toBe(true);
    expect(s.related_field_ids).toEqual(["phone_bill"]);
    const ai = await sql<{ id: string; created_by: string }[]>`select id, created_by from life_fields where created_by = 'ai'`;
    expect(ai).toHaveLength(1);
    expect((await openQuestions(sql)).some((q) => q.field_id === ai[0].id)).toBe(true);
    const [usage] = await sql<{ purpose: string; employee_id: string }[]>`
      select purpose, employee_id from api_usage order by created_at desc limit 1`;
    expect(usage).toMatchObject({ purpose: "life:analysis:1m", employee_id: "life" });
    const r2 = await runLifeAnalysis(sql, 1, "manual");
    expect(r2.suggestionIds).toHaveLength(0);
  });

  it("緊急停止中は、AIを使わずに数字だけのレポートにする", async () => {
    const sql = await seedData();
    await sql`update company_settings set emergency_stop = true`;
    const r = await runLifeAnalysis(sql, 3, "manual");
    expect(r.aiUsed).toBe(false);
    expect(r.costJpy).toBe(0);
  });

  it("提案の状態を変えられ、操作履歴に残る", async () => {
    const sql = await seedData();
    const r = await runLifeAnalysis(sql, 1, "manual");
    await setSuggestionStatus(sql, r.suggestionIds[0], "adopted", "やってみる");
    expect((await listSuggestions(sql, "adopted")).map((x) => x.id)).toContain(r.suggestionIds[0]);
    await expect(setSuggestionStatus(sql, r.suggestionIds[0], "bogus", "")).rejects.toThrow();
  });
});

describe("Phase 5：サーバーの定期実行（アプリを開いていなくても動く）", () => {
  beforeEach(async () => {
    const sql = await getDb();
    await sql`update company_settings set autorun_frequency = 'off', sns_plan_frequency = 'off'`;
  });

  it("分析する期間：毎月1日は1か月、1・4・7・10月は3か月、1・7月は6か月、1月は12か月も", () => {
    expect(analysisPeriodsFor("2030-02-01")).toEqual([1]);
    expect(analysisPeriodsFor("2030-04-01")).toEqual([1, 3]);
    expect(analysisPeriodsFor("2030-07-01")).toEqual([1, 3, 6]);
    expect(analysisPeriodsFor("2030-01-01")).toEqual([1, 3, 6, 12]);
    expect(analysisPeriodsFor("2030-01-02")).toEqual([]);
  });

  it("質問の日に質問を作り、通知の順番待ちに入れる。同じ日に2回は作らない", async () => {
    const sql = await getDb();
    const day = new Date("2030-03-05T00:00:00Z"); // 火曜。使い始めなので毎日
    const r1 = await runScheduledJobs(sql, day);
    expect(r1.ran).toContain("life_questions");
    expect((await openQuestions(sql)).length).toBe(3);
    expect(await sql`select 1 from notifications where dedupe_key = 'morning:2030-03-05'`).toHaveLength(1);
    await sql`update life_questions set status = 'skipped'`;
    const r2 = await runScheduledJobs(sql, day);
    expect(r2.ran).not.toContain("life_questions");
  });

  it("月の初めに分析し、優先度の高い提案はチームの業務になる（ライフ担当もメンバー）", async () => {
    const sql = await getDb();
    await sql`update tasks set status = 'completed', completed_at = now() where source = 'ai_discovered' and status not in ('completed','rejected','failed')`;
    await addRecord(sql, { fieldId: "phone_bill", raw: "8000" });
    await addRecord(sql, { fieldId: "rent", raw: "70000" });
    const r = await runScheduledJobs(sql, new Date("2030-01-01T00:00:00Z"));
    expect(r.ran).toContain("life_analysis");
    expect(r.life!.analyses).toHaveLength(4);
    expect(r.life!.taskIds).toHaveLength(1);
    const taskId = r.life!.taskIds[0];
    const [s] = await sql<{ status: string; task_id: string }[]>`select status, task_id from life_suggestions where task_id = ${taskId}`;
    expect(s.status).toBe("considering");
    const members = await sql<{ employee_id: string; role: string }[]>`select employee_id, role from task_members where task_id = ${taskId}`;
    expect(members.map((m) => m.employee_id)).toEqual(expect.arrayContaining(["president", "life"]));
    const [t] = await sql<{ source: string; created_by_employee_id: string }[]>`select source, created_by_employee_id from tasks where id = ${taskId}`;
    expect(t).toMatchObject({ source: "ai_discovered", created_by_employee_id: "life" });
    expect(await sql`select 1 from notifications where dedupe_key = 'life-a:2030-01-01'`).toHaveLength(1);
    // 同じ日にもう一度動いても、分析は二重にしない
    const r2 = await runScheduledJobs(sql, new Date("2030-01-01T00:00:00Z"));
    expect(r2.ran).not.toContain("life_analysis");
  });

  it("緊急停止中も質問は作る（AIを使わないため）。分析はAIなしの数字だけ", async () => {
    const sql = await getDb();
    await sql`update company_settings set emergency_stop = true`;
    await addRecord(sql, { fieldId: "phone_bill", raw: "8000" });
    const r = await runScheduledJobs(sql, new Date("2030-02-01T00:00:00Z"));
    expect(r.ran).toContain("life_questions");
    expect(r.life!.analyses[0].aiUsed).toBe(false);
    expect(r.life!.taskIds).toHaveLength(0);
  });
});

describe("Phase 6：AI社員どうしの連携・自動の業務化・安全", () => {
  async function newSuggestion(title = `通信費の見直し ${crypto.randomUUID()}`, priority = "high") {
    const sql = await getDb();
    const [row] = await sql<{ id: string }[]>`
      insert into life_suggestions (title, problem, evidence, benefit, cost_text, difficulty, priority, recommendation, is_estimate, category_id, needs_team)
      values (${title}, '携帯料金が高い可能性', '本人の回答：月8,000円', '月3,000円ほど安くなるかも', '0円', 'ふつう', ${priority}, 'プランを比べる', true, 'home', true)
      returning id`;
    return row.id;
  }

  it("「チームで検討する」で業務ができ、社長の編成→議論（ライフ担当も参加）→成果物→監査→報告まで進み、記録が残る", async () => {
    const sql = await getDb();
    await sql`update tasks set status = 'completed', completed_at = now() where source = 'ai_discovered' and status not in ('completed','rejected','failed')`;
    const id = await newSuggestion();
    const r = await suggestionToTeam(sql, id, "manual");
    expect(r.ok).toBe(true);
    await runWorkflows(sql, { taskIds: [r.taskId!], maxSteps: 25, deadlineMs: 60_000 });
    const wf = await getWorkflow(sql, r.taskId!);
    expect(wf?.phase).toBe("waiting_human");
    const members = await listMembers(sql, r.taskId!);
    expect(members.map((m) => m.employee_id)).toEqual(expect.arrayContaining(["president", "life", "finance"]));
    const msgs = await listRoomMessages(sql, r.taskId!);
    const speakers = new Set(msgs.filter((m) => m.author_type === "employee").map((m) => m.employee_id));
    expect(speakers.has("president")).toBe(true);
    expect(speakers.has("life")).toBe(true);
    expect(speakers.has("finance")).toBe(true);
    // 2回目は「すでに検討中」
    const again = await suggestionToTeam(sql, id, "manual");
    expect(again.ok).toBe(false);
    // チームが出す承認依頼は「承認待ち」のまま。アプリが外部で実行することはない
    const approvals = await sql<{ status: string; action_type: string }[]>`select status, action_type from approvals where task_id = ${r.taskId}`;
    expect(approvals.every((a) => a.status === "pending")).toBe(true);
  });

  it("自動の業務化は同時に2件まで", async () => {
    const sql = await getDb();
    await sql`update tasks set status = 'completed', completed_at = now() where status not in ('completed','rejected','failed')`;
    const ids = [await newSuggestion(`提案A ${crypto.randomUUID()}`), await newSuggestion(`提案B ${crypto.randomUUID()}`), await newSuggestion(`提案C ${crypto.randomUUID()}`)];
    const results = [];
    for (const id of ids) results.push(await suggestionToTeam(sql, id, "auto"));
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(results[2].message).toMatch(/上限/);
  });

  it("ライフ担当との会話には生活情報のまとめが入る（「AIに渡さない」カテゴリは入らない）", async () => {
    const sql = await getDb();
    await addRecord(sql, { fieldId: "phone_bill", raw: "4000" });
    await addRecord(sql, { fieldId: "weight", raw: "60", periodEnd: "2026-11-01" });
    await sql`update life_categories set ai_allowed = false where id = 'health'`;
    const snap = await buildLifeSnapshot(sql);
    expect(snap).toContain("携帯電話料金: 4,000円/月");
    expect(snap).not.toContain("体重");
    const [life] = await sql`select * from employees where id = 'life'`;
    const p = buildChatSystemPrompt({ settings: { company_name: "テスト", philosophy: "", custom_rules: "" } as never, employee: { ...life, department_name: "ライフ" } as never, roster: [], openTasks: [], todayJst: "2026-11-14", lifeSnapshot: snap });
    expect(p).toContain("携帯電話料金");
    expect(p).toContain("推測で数字を作らない");
  });
});
