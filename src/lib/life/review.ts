import "server-only";
import { z } from "zod";
import type { Sql } from "@/lib/db";
import { AiUnavailableError, BudgetBlockedError, callStructured } from "@/lib/ai/client";
import { FIXED_COMPANY_PRINCIPLES, PLAIN_LANGUAGE_RULES } from "@/lib/ai/prompts";
import { similarity } from "@/lib/dedupe";
import { jstDateParts } from "@/lib/format";
import { createStepLogger } from "@/lib/log";
import { audit } from "@/lib/repo/audit";
import { getEmployee } from "@/lib/repo/employees";
import { getSettings } from "@/lib/repo/settings";
import { createHabit, listHabits, weekStart } from "./habits";
import { addDays } from "./planner";
import { listCategories } from "./repo";
import { LIFE_EMPLOYEE_ID } from "./questions";
import { isEmptySnapshot, qolForAi, qolSnapshot, type QolSnapshot } from "./qolsnapshot";

// 週のふりかえり（月曜の朝に、先週の月曜〜日曜の分を森野が書く）。
// 数字（チェック・習慣・目標・予定）はプログラムが集計し、森野はそれを読んでコメントと来週の一歩を書く。

export const ReviewSchema = z.object({
  summary: z.string().describe("先週のふりかえり（300字以内。やさしく、責めない言葉で。数字はもらったものだけ）"),
  good_points: z.array(z.string()).describe("よかったこと（0〜3件）"),
  concerns: z.array(z.string()).describe("気になること（0〜3件。根拠をそえる）"),
  next_week_focus: z.array(z.string()).describe("来週の一歩（1〜3件。小さくて具体的なこと）"),
  habit_proposals: z
    .array(
      z.object({
        title: z.string().describe("小さな習慣（20字以内。例：寝る前にスマホを置く）"),
        why: z.string().describe("おすすめする理由（根拠をそえて）"),
        frequency: z.enum(["daily", "weekly"]),
        target_per_week: z.number().describe("週に何回か（毎日なら7）"),
      }),
    )
    .describe("新しく始めるとよさそうな小さな習慣（0〜2件。今ある習慣と同じものは出さない）"),
});
export type ReviewOutput = z.infer<typeof ReviewSchema>;

export type ReviewResult = { ok: boolean; message: string; reviewId: string | null; aiUsed: boolean; proposedHabits: number };

/** 先週（月曜〜日曜） */
export function lastWeek(today: string) {
  const thisMon = weekStart(today);
  return { start: addDays(thisMon, -7), end: addDays(thisMon, -1) };
}

export async function runWeeklyReview(sql: Sql, trigger: "manual" | "scheduled", now = new Date()): Promise<ReviewResult> {
  const log = createStepLogger("life-review");
  const { date } = jstDateParts(now);
  const week = trigger === "manual" ? { start: addDays(date, -6), end: date } : lastWeek(date);
  const [settings, categories, employee, habits] = await Promise.all([
    getSettings(sql),
    listCategories(sql),
    getEmployee(sql, LIFE_EMPLOYEE_ID),
    listHabits(sql, ["active", "proposed", "paused"]),
  ]);
  const snap = await qolSnapshot(sql, week.end, 7);
  const save = async (summary: string, aiUsed: boolean, stats: QolSnapshot) => {
    const [row] = await sql<{ id: string }[]>`
      insert into life_reviews (week_start, week_end, stats, ai_summary, ai_used)
      values (${week.start}::date, ${week.end}::date, ${sql.json(stats as never)}, ${summary}, ${aiUsed})
      returning id`;
    return row.id;
  };
  if (isEmptySnapshot(snap)) {
    const id = await save("この週の記録（QOLチェック・習慣・目標・予定）がまだないため、ふりかえりはお休みです。まずは毎日のチェックから始めてみましょう。", false, snap);
    return { ok: true, message: "記録がないため、AIは使わずに終えました", reviewId: id, aiUsed: false, proposedHabits: 0 };
  }
  if (settings.emergency_stop || !employee) {
    const id = await save("緊急停止中のため、数字だけのふりかえりです。", false, snap);
    return { ok: true, message: "緊急停止中のため、数字だけのふりかえりを作りました", reviewId: id, aiUsed: false, proposedHabits: 0 };
  }
  const aiSnap = qolForAi(snap, categories);
  let out: ReviewOutput;
  try {
    const r = await callStructured(sql, {
      model: settings.model_standard,
      effort: "low",
      maxTokens: 2500,
      system: `あなたは「${settings.company_name}」のAI社員「${employee.name}」（ライフインテリジェンス担当）です。
この会社のいちばんの仕事は、経営者（オーナー本人）の生活をより良くすることです。毎週、先週の暮らしをふりかえり、来週の小さな一歩を一緒に考えます。

【会社の基本原則（変更不可）】
${FIXED_COMPANY_PRINCIPLES}

【あなた】
- 性格: ${employee.personality}
- 話し方: ${employee.speaking_style}

${PLAIN_LANGUAGE_RULES}

【ふりかえりのルール】
- 数字はプログラムが集計した事実。変えたり、ない数字を作ったりしない。QOLチェックは1〜5（ストレスは5が多い）。
- 責めない。できなかったことより、できたことを先に。続けやすい「小さな一歩」をすすめる。
- 習慣の提案は、今ある習慣（下）と同じものは出さない。根拠がなければ出さない。
- 体や心の不調が続いているようなら、無理をしないことと、必要なら専門家（病院など）に相談することをすすめる（診断はしない）。

【今ある習慣】
${habits.length ? habits.map((h) => `- ${h.title}（${h.status}）`).join("\n") : "（なし）"}`,
      messages: [{ role: "user", content: `${week.start}〜${week.end} の記録です。ふりかえってください。\n${JSON.stringify(aiSnap)}` }],
      schema: ReviewSchema,
      schemaName: "life_weekly_review",
      purpose: "life:review",
      employeeId: LIFE_EMPLOYEE_ID,
      mock: () => ({
        summary: `【テスト用モック】先週もおつかれさまでした。QOLチェックは${aiSnap.qol?.days ?? 0}日、習慣は${aiSnap.habits.length}個の記録があります。`,
        good_points: aiSnap.habits.filter((h) => h.doneInPeriod > 0).map((h) => `「${h.title}」を${h.doneInPeriod}回できました`).slice(0, 2),
        concerns: aiSnap.qol && aiSnap.qol.avg.sleep < 3 ? ["睡眠の点数が低めです"] : [],
        next_week_focus: ["寝る30分前に画面を見ないようにしてみる"],
        habit_proposals: [{ title: "寝る前にストレッチ", why: "睡眠の点数を上げるため（推測）", frequency: "daily" as const, target_per_week: 7 }],
      }),
    });
    if (!r.ok) {
      const id = await save(`AIのコメントを作れなかったため、数字だけのふりかえりです（${r.message}）`, false, snap);
      return { ok: true, message: "数字だけのふりかえりを作りました", reviewId: id, aiUsed: false, proposedHabits: 0 };
    }
    out = r.data;
  } catch (err) {
    if (err instanceof BudgetBlockedError || err instanceof AiUnavailableError) {
      const id = await save(`AIを使えなかったため、数字だけのふりかえりです（${err.message}）`, false, snap);
      return { ok: true, message: `数字だけのふりかえりを作りました（${err.message}）`, reviewId: id, aiUsed: false, proposedHabits: 0 };
    }
    log.fail("review", err);
    throw err;
  }
  const text = [
    out.summary,
    out.good_points.length ? `\n【よかったこと】\n${out.good_points.map((s) => `・${s}`).join("\n")}` : "",
    out.concerns.length ? `\n【気になること】\n${out.concerns.map((s) => `・${s}`).join("\n")}` : "",
    out.next_week_focus.length ? `\n【来週の一歩】\n${out.next_week_focus.map((s) => `・${s}`).join("\n")}` : "",
  ].join("");
  const reviewId = await save(text, true, snap);
  let proposed = 0;
  for (const h of out.habit_proposals.slice(0, 2)) {
    if (!h.title.trim() || habits.some((x) => similarity(x.title, h.title) >= 0.7)) continue;
    await createHabit(sql, {
      title: h.title,
      why: h.why,
      frequency: h.frequency,
      targetPerWeek: h.target_per_week,
      status: "proposed",
      source: "ai",
    });
    proposed++;
  }
  await audit(sql, trigger === "manual" ? "owner" : "system", "life_review", "life_review", reviewId, { proposed });
  return { ok: true, message: `ふりかえりを作りました${proposed ? `（おすすめの習慣 ${proposed}件）` : ""}`, reviewId, aiUsed: true, proposedHabits: proposed };
}
