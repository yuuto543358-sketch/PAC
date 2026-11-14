import "server-only";
import { z } from "zod";
import type { Sql } from "@/lib/db";
import { AiUnavailableError, BudgetBlockedError, callStructured } from "@/lib/ai/client";
import { FIXED_COMPANY_PRINCIPLES, OWNER_POLICIES, PLAIN_LANGUAGE_RULES } from "@/lib/ai/prompts";
import { audit } from "@/lib/repo/audit";
import { getEmployee } from "@/lib/repo/employees";
import { getSettings } from "@/lib/repo/settings";
import { enqueueNotification } from "@/lib/notify";
import { buildLifeSnapshot } from "./snapshot";

// 社員の自主研究：毎週、社員が1人ずつ交代で、経営者の暮らしに役立つことを自分で選んで調べ、短いメモにする。
// メモは「報告書」に保存し、その社員の記憶（ナレッジ）にも残す。

const ROTATION = ["finance", "research", "secretary", "creative", "bizdev", "life"];

export const ResearchSchema = z.object({
  title: z.string().describe("調べたことの題名（30字以内）"),
  why: z.string().describe("なぜ経営者の暮らしに役立つと思ったか（1〜2文。根拠となる情報をそえる）"),
  memo: z.string().describe("調べた内容のメモ（600字以内。見出しと箇条書きで。事実と推測を分ける）"),
  tips: z.array(z.string()).describe("すぐ試せること（0〜3件）"),
});

/** その週の担当（週の番号で交代） */
export function researcherFor(date: string): string {
  const week = Math.floor(Date.parse(`${date}T00:00:00Z`) / (7 * 86_400_000));
  return ROTATION[week % ROTATION.length];
}

export async function runSelfResearch(sql: Sql, date: string, trigger: "manual" | "scheduled"): Promise<{ reportId: string | null; message: string }> {
  const settings = await getSettings(sql);
  if (settings.emergency_stop) return { reportId: null, message: "緊急停止中のため、自主研究はお休みしました" };
  const employeeId = researcherFor(date);
  const employee = await getEmployee(sql, employeeId);
  if (!employee) return { reportId: null, message: "担当の社員が見つかりません" };
  const [snapshot, recent] = await Promise.all([
    buildLifeSnapshot(sql),
    sql<{ title: string }[]>`select title from reports where report_type = 'employee' order by created_at desc limit 12`,
  ]);
  try {
    const r = await callStructured(sql, {
      model: settings.model_standard,
      effort: "low",
      maxTokens: 3000,
      system: `あなたは「${settings.company_name}」のAI社員「${employee.name}」（${employee.role_title}）です。
今週は「自主研究」の担当です。経営者（オーナー本人）の暮らしに役立ちそうなことを、あなたの専門の立場から1つ選んで調べ、短いメモにします。

【会社の基本原則（変更不可）】
${FIXED_COMPANY_PRINCIPLES}

${OWNER_POLICIES}

【あなた】
- 専門: ${employee.expertise.join("、")}
- 判断基準: ${employee.judgment_criteria}

${PLAIN_LANGUAGE_RULES}

【テーマの選び方】
- 経営者の生活情報（下）に合ったテーマにする（例：固定費の相場、使えるお得な制度、季節の備え、時間を節約する工夫、体調を整えるコツ）。
- 生活情報が少ないときは、多くの人に役立つ身近なテーマでよい。
- 最近のメモ（下）と同じテーマは選ばない。
- ${settings.web_research_enabled ? "必要なら Web検索で、新しい情報を確かめる（1回まで）。どのページの情報か分かるように書く。" : "Web検索は使えない。あなたの知識の範囲で書き、古いかもしれない情報は「要確認」と書く。"}
- 申し込み・購入などはすすめるだけ。実行は経営者が決めて自分で行う。

【経営者の生活情報（本人の回答）】
${snapshot}

【最近の自主研究のメモ】
${recent.length ? recent.map((x) => `- ${x.title}`).join("\n") : "（まだありません）"}`,
      messages: [{ role: "user", content: "今週の自主研究をお願いします。" }],
      schema: ResearchSchema,
      schemaName: "employee_self_research",
      purpose: "life:research",
      employeeId,
      webSearch: settings.web_research_enabled ? { maxCalls: 1 } : null,
      mock: () => ({
        title: `【テスト用モック】${employee.name}の自主研究`,
        why: "テスト用の内容です",
        memo: "## 調べたこと\n- テスト用のメモです",
        tips: ["まずは1つだけ試してみる"],
      }),
    });
    if (!r.ok) return { reportId: null, message: r.message };
    const d = r.data;
    const content = [
      `担当：${employee.name}（${employee.role_title}）`,
      "",
      `**なぜ調べたか**：${d.why}`,
      "",
      d.memo,
      d.tips.length ? `\n## すぐ試せること\n${d.tips.map((t) => `- ${t}`).join("\n")}` : "",
      r.sources.length ? `\n## 参考にしたページ\n${r.sources.map((s) => `- ${s.title || s.url}：${s.url}`).join("\n")}` : "",
    ].join("\n");
    const title = `自主研究（${employee.name}）：${d.title}`.slice(0, 200);
    const [row] = await sql<{ id: string }[]>`
      insert into reports (report_type, title, content, employee_id, period_start, period_end)
      values ('employee', ${title}, ${content}, ${employeeId}, ${date}::date, ${date}::date)
      returning id`;
    await sql`
      insert into knowledge (employee_id, category, title, content, created_by)
      values (${employeeId}, 'note', ${`自主研究：${d.title}`.slice(0, 200)}, ${d.memo.slice(0, 1000)}, 'employee')`;
    if (trigger === "scheduled") {
      await enqueueNotification(sql, {
        kind: "report",
        title: `${employee.name}から自主研究のメモが届きました`,
        body: d.title,
        url: "/reports",
        dedupeKey: `research:${row.id}`,
      });
    }
    await audit(sql, trigger === "manual" ? "owner" : "system", "self_research", "report", row.id, { employeeId });
    return { reportId: row.id, message: `${employee.name}が自主研究のメモを書きました` };
  } catch (err) {
    if (err instanceof BudgetBlockedError || err instanceof AiUnavailableError) return { reportId: null, message: err.message };
    throw err;
  }
}
