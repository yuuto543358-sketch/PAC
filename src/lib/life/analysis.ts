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
import { latestRecords, listCategories, listFields, recordsSince } from "./repo";
import { computeStats, monthsAgo, statsForAi, type LifeStats } from "./stats";
import { isEmptySnapshot, qolForAi, qolSnapshot } from "./qolsnapshot";
import { LIFE_EMPLOYEE_ID } from "./questions";

// ライフ担当（森野 結）が、集計した数字を読んで、コメントと改善提案を作る。
// 数字はプログラムが計算した事実。AIは数字を変えず、足りない情報を推測で埋めない。

export const AnalysisSchema = z.object({
  summary: z.string().describe("この期間の暮らしのまとめ（400字以内。やさしい言葉で。数字はもらったものだけを使う）"),
  improved: z.array(z.string()).describe("前より良くなったこと（0〜3件。根拠となる数字や回答をそえる）"),
  ongoing_problems: z.array(z.string()).describe("続いている問題・放っておかれている課題・これから起きそうな問題（0〜3件）"),
  suggestions: z
    .array(
      z.object({
        title: z.string().describe("提案の題名（30字以内）"),
        problem: z.string().describe("見つけた問題"),
        evidence: z.string().describe("そう考えた根拠（どの数字・どの回答か。推測ならその理由）"),
        benefit: z.string().describe("改善するとどう良くなるか（分かれば金額や時間の目安）"),
        cost_text: z.string().describe("改善にかかる費用の目安（0円なら0円と書く）"),
        difficulty: z.enum(["やさしい", "ふつう", "むずかしい"]),
        priority: z.enum(["high", "medium", "low"]),
        recommendation: z.string().describe("おすすめの対応（具体的な手順）"),
        is_estimate: z.boolean().describe("推測にもとづく提案なら true"),
        category_id: z.string().describe("関係するカテゴリのid"),
        related_field_ids: z.array(z.string()).describe("根拠にした項目のid"),
        needs_team: z.boolean().describe("調査・比較・企画が必要で、チームで検討したほうがよいなら true"),
      }),
    )
    .describe("改善提案（0〜3件。根拠がないものは出さない）"),
  follow_up_questions: z
    .array(
      z.object({
        category_id: z.string(),
        label: z.string().describe("新しく知りたい情報の名前（20字以内）"),
        value_type: z.enum(["number", "text"]),
        unit: z.string().describe("数字なら単位（例：円/月）。文章なら空"),
        question: z.string().describe("本人への質問（やさしい言葉で1文）"),
        reason: z.string().describe("質問の理由（短く）"),
      }),
    )
    .describe("提案に必要なのに足りない情報があれば、追加で聞く質問（0〜2件）"),
});
export type AnalysisOutput = z.infer<typeof AnalysisSchema>;

export type AnalysisResult = {
  ok: boolean;
  message: string;
  reportId: string | null;
  suggestionIds: string[];
  aiUsed: boolean;
  costJpy: number;
};

function mockAnalysis(stats: LifeStats): AnalysisOutput {
  const phone = stats.fixedCosts.items.find((i) => i.fieldId === "phone_bill");
  return {
    summary: `【テスト用モック】直近${stats.periodMonths}か月の記録は${stats.recordCount}件です。固定費の合計は${stats.fixedCosts.total.toLocaleString("ja-JP")}円/月です。`,
    improved: [],
    ongoing_problems: stats.gaps.length ? [`まだ分からない大事な情報があります（${stats.gaps.slice(0, 2).join("・")}）`] : [],
    suggestions:
      phone && phone.value >= 5000
        ? [
            {
              title: "携帯電話料金の見直し",
              problem: `携帯電話料金が月${phone.value.toLocaleString("ja-JP")}円で、格安プランより高い可能性があります`,
              evidence: "本人の回答の携帯電話料金（推測：一般的な格安プランは月1,000〜3,000円台）",
              benefit: "月2,000円前後、年間2万円以上へらせる可能性があります",
              cost_text: "0円（乗りかえ手数料がかかる場合あり）",
              difficulty: "ふつう",
              priority: "high",
              recommendation: "いまの契約内容（データ量・通話）を確認し、同じ使い方で安いプランを比べる",
              is_estimate: true,
              category_id: "home",
              related_field_ids: ["phone_bill"],
              needs_team: true,
            },
          ]
        : [],
    follow_up_questions: phone
      ? [{ category_id: "home", label: "毎月のデータ使用量", value_type: "number", unit: "GB/月", question: "スマホのデータは、月にだいたい何GB使っていますか？", reason: "料金プランが合っているか確かめるためです" }]
      : [],
  };
}

export async function runLifeAnalysis(
  sql: Sql,
  months: 1 | 3 | 6 | 12,
  trigger: "manual" | "scheduled",
  now = new Date(),
): Promise<AnalysisResult> {
  const log = createStepLogger("life-analysis");
  const { date } = jstDateParts(now);
  const [settings, fields, categories, latest, employee] = await Promise.all([
    getSettings(sql),
    listFields(sql),
    listCategories(sql),
    latestRecords(sql),
    getEmployee(sql, LIFE_EMPLOYEE_ID),
  ]);
  const records = await recordsSince(sql, monthsAgo(date, 12));
  const stats = computeStats({ fields, categories, records, latest, months, today: date, now });
  stats.qolExtra = await qolSnapshot(sql, date, months * 30);

  const save = async (summary: string, aiUsed: boolean) => {
    const [row] = await sql<{ id: string }[]>`
      insert into life_reports (period_months, period_start, period_end, stats, ai_summary, ai_used, data_gaps, employee_id)
      values (${months}, ${stats.periodStart}::date, ${stats.periodEnd}::date, ${sql.json(stats as never)}, ${summary},
        ${aiUsed}, ${stats.gaps.slice(0, 20)}::text[], ${LIFE_EMPLOYEE_ID})
      returning id`;
    return row.id;
  };

  // 情報がなければ、AIは呼ばない（費用0円）
  if (stats.recordCount === 0 && stats.fixedCosts.items.length === 0 && isEmptySnapshot(stats.qolExtra)) {
    const id = await save("この期間の記録がまだないため、分析できません。森野からの質問に答えると、分析できるようになります。", false);
    return { ok: true, message: "記録がまだないため、数字だけのレポートを作りました（AIは使っていません）", reportId: id, suggestionIds: [], aiUsed: false, costJpy: 0 };
  }
  if (settings.emergency_stop || !employee) {
    const id = await save("緊急停止中のため、AIのコメントなしで数字だけをまとめました。", false);
    return { ok: true, message: "緊急停止中のため、数字だけのレポートを作りました", reportId: id, suggestionIds: [], aiUsed: false, costJpy: 0 };
  }

  const aiStats = { ...statsForAi(stats, categories), qolExtra: qolForAi(stats.qolExtra, categories) };
  const allowedCats = categories.filter((c) => c.ai_allowed && c.is_active);
  const openSuggestions = await sql<{ title: string }[]>`
    select title from life_suggestions where status in ('new','considering','adopted') order by created_at desc limit 20`;
  const fieldIds = new Set(fields.map((f) => f.id));

  let out: AnalysisOutput;
  let costJpy = 0;
  try {
    const r = await callStructured(sql, {
      model: settings.model_standard,
      effort: "low",
      maxTokens: 4000,
      system: `あなたは「${settings.company_name}」のAI社員「${employee.name}」（ライフインテリジェンス担当）です。
経営者（あなたの会社のオーナー本人）の暮らしの情報を分析し、本人が気づいていない問題や改善のきっかけを見つけて、具体的な解決策まで提案します。

【会社の基本原則（変更不可）】
${FIXED_COMPANY_PRINCIPLES}

【あなた】
- 性格: ${employee.personality}
- 判断基準: ${employee.judgment_criteria}

${PLAIN_LANGUAGE_RULES}

【分析のルール】
- qolExtra は、毎日のQOLチェック（1〜5。ストレスは5が多い）・習慣の達成・目標の進み具合・これから起きる予定と出費。生活の質（QOL）を上げることを、いちばん大事にする。
- もらった数字は、プログラムが計算した事実。数字を変えたり、もらっていない数字を作ったりしない。
- 情報が足りないところは、推測で埋めない。「この情報が足りないため分からない」と書く。必要なら follow_up_questions で質問する。
- 相場などの一般的な知識を使うときは「推測」と書き、is_estimate を true にする。
- 提案は、根拠のあるものだけ（0件でもよい）。問題を指摘するだけでなく、具体的な解決策まで書く。
- 契約変更・購入・申し込みなどは、提案するだけ。実行は本人が承認したうえで、本人が行う。
- すでにある提案（下）と同じ内容は出さない。
- category_id は次のどれか：${allowedCats.map((c) => `${c.id}（${c.name}）`).join("、")}
${aiStats.excludedCategories.length ? `- 本人の設定で、次のカテゴリの情報はもらっていない：${aiStats.excludedCategories.join("、")}` : ""}

【すでにある提案】
${openSuggestions.length ? openSuggestions.map((s) => `- ${s.title}`).join("\n") : "（なし）"}`,
      messages: [{ role: "user", content: `直近${months}か月の集計です。分析してください。\n${JSON.stringify(aiStats)}` }],
      schema: AnalysisSchema,
      schemaName: "life_analysis",
      purpose: `life:analysis:${months}m`,
      employeeId: LIFE_EMPLOYEE_ID,
      mock: () => mockAnalysis(aiStats as LifeStats),
    });
    costJpy = r.costJpy;
    if (!r.ok) {
      const id = await save(`AIのコメントを作れなかったため、数字だけをまとめました（${r.message}）`, false);
      return { ok: true, message: "数字だけのレポートを作りました", reportId: id, suggestionIds: [], aiUsed: false, costJpy };
    }
    out = r.data;
  } catch (err) {
    if (err instanceof BudgetBlockedError || err instanceof AiUnavailableError) {
      const id = await save(`AIを使えなかったため、数字だけをまとめました（${err.message}）`, false);
      return { ok: true, message: `数字だけのレポートを作りました（${err.message}）`, reportId: id, suggestionIds: [], aiUsed: false, costJpy: 0 };
    }
    log.fail("analysis", err);
    throw err;
  }

  const summary = [
    out.summary,
    out.improved.length ? `\n【良くなったこと】\n${out.improved.map((s) => `・${s}`).join("\n")}` : "",
    out.ongoing_problems.length ? `\n【続いている問題・気をつけたいこと】\n${out.ongoing_problems.map((s) => `・${s}`).join("\n")}` : "",
  ].join("");
  const reportId = await save(summary, true);

  // 改善提案（すでにある提案と似ているものは保存しない）
  const allowedIds = new Set(allowedCats.map((c) => c.id));
  const existing = openSuggestions.map((s) => s.title);
  const suggestionIds: string[] = [];
  for (const s of out.suggestions.slice(0, 3)) {
    if (!s.title.trim() || existing.some((t) => similarity(t, s.title) >= 0.7)) continue;
    existing.push(s.title);
    const [row] = await sql<{ id: string }[]>`
      insert into life_suggestions (title, problem, evidence, benefit, cost_text, difficulty, priority, recommendation,
        is_estimate, category_id, related_field_ids, report_id, needs_team)
      values (${s.title.slice(0, 120)}, ${s.problem.slice(0, 2000)}, ${s.evidence.slice(0, 2000)}, ${s.benefit.slice(0, 2000)},
        ${s.cost_text.slice(0, 500)}, ${s.difficulty}, ${s.priority}, ${s.recommendation.slice(0, 3000)}, ${s.is_estimate},
        ${allowedIds.has(s.category_id) ? s.category_id : null}, ${s.related_field_ids.filter((id) => fieldIds.has(id))}::text[],
        ${reportId}, ${s.needs_team})
      returning id`;
    suggestionIds.push(row.id);
  }

  // 追加の質問（新しい項目として登録。回答待ちが多いときは増やさない）
  const [{ n: pending }] = await sql<{ n: number }[]>`select count(*)::int as n from life_questions where status = 'pending'`;
  let room = Math.max(0, 3 - pending);
  for (const q of out.follow_up_questions.slice(0, 2)) {
    if (room <= 0 || !allowedIds.has(q.category_id) || !q.question.trim()) continue;
    const dup = fields.some((f) => similarity(f.label, q.label) >= 0.8);
    if (dup) continue;
    const id = `ai_${crypto.randomUUID().slice(0, 8)}`;
    await sql`
      insert into life_fields (id, category_id, label, value_type, unit, question, reason, refresh_days, importance, created_by)
      values (${id}, ${q.category_id}, ${q.label.slice(0, 60)}, ${q.value_type}, ${q.unit.slice(0, 20)}, ${q.question.slice(0, 300)},
        ${q.reason.slice(0, 300)}, 180, 3, 'ai')`;
    await sql`
      insert into life_questions (field_id, text, reason, source, employee_id)
      values (${id}, ${q.question.slice(0, 300)}, ${q.reason.slice(0, 300)}, 'ai', ${LIFE_EMPLOYEE_ID})`;
    room--;
  }
  await audit(sql, trigger === "manual" ? "owner" : "system", "life_analysis", "life_report", reportId, {
    months,
    suggestions: suggestionIds.length,
    costJpy,
  });
  return {
    ok: true,
    message: `直近${months}か月の分析を作りました${suggestionIds.length ? `（改善提案 ${suggestionIds.length}件）` : ""}`,
    reportId,
    suggestionIds,
    aiUsed: true,
    costJpy,
  };
}
