import "server-only";
import { z } from "zod";
import type { Sql } from "@/lib/db";
import { AiUnavailableError, BudgetBlockedError, callStructured } from "@/lib/ai/client";
import { FIXED_COMPANY_PRINCIPLES, OWNER_POLICIES, PLAIN_LANGUAGE_RULES } from "@/lib/ai/prompts";
import { SNS_PLATFORM_LABEL, SNS_PLATFORMS, type SnsPlatform } from "@/lib/constants";
import { similarity } from "@/lib/dedupe";
import { todayJst } from "@/lib/format";
import { createStepLogger } from "@/lib/log";
import { createApproval } from "@/lib/repo/approvals";
import { audit } from "@/lib/repo/audit";
import { getEmployee } from "@/lib/repo/employees";
import { getSettings } from "@/lib/repo/settings";
import { checkPostLength } from "@/lib/sns/post";
import { SNS_STYLE_RULES } from "@/lib/sns/style";

// SNS担当（企画制作の春野 創太）が、会社のSNSの投稿案を作る仕組み。
// 投稿案は1件ずつ「承認依頼」になります。投稿は、承認したあと経営者が自分で行います（アプリは投稿しません）。

const SNS_MANAGER_ID = "creative";


export function buildSnsSchema(platforms: [SnsPlatform, ...SnsPlatform[]]) {
  return z.object({
    message: z.string().describe("経営者への短い報告（100字以内。やさしい言葉で）"),
    posts: z
      .array(
        z.object({
          platform: z.enum(platforms).describe("投稿するSNS"),
          text: z.string().describe("投稿する文章そのもの。ネタツイくらいラフな口語で（Xなら日本語130文字以内、Blueskyなら280文字以内）"),
          purpose: z.string().describe("この投稿のねらい（30字以内）"),
          timing: z.string().describe("投稿におすすめの時間帯（例：平日の夜8時ごろ）"),
        }),
      )
      .describe("投稿案"),
  });
}

export type SnsPlanResult = {
  ok: boolean;
  message: string;
  created: number;
  skipped: number;
  approvalIds: string[];
  costJpy: number;
};

export async function runSnsPlanning(sql: Sql, trigger: "manual" | "scheduled"): Promise<SnsPlanResult> {
  const log = createStepLogger("sns");
  const empty = { created: 0, skipped: 0, approvalIds: [], costJpy: 0 };
  const [settings, employee] = await Promise.all([getSettings(sql), getEmployee(sql, SNS_MANAGER_ID)]);
  if (!employee) return { ok: false, message: "SNS担当の社員が見つかりません。", ...empty };
  if (settings.emergency_stop) return { ok: false, message: "緊急停止中のため、SNSの投稿案づくりを止めました。", ...empty };

  // 投稿案を作るSNS（設定で選ぶ。なければ X）
  const chosen = SNS_PLATFORMS.filter((p) => settings.sns_platforms?.includes(p));
  const platforms = (chosen.length ? chosen : (["x"] as SnsPlatform[])) as [SnsPlatform, ...SnsPlatform[]];
  const count = Math.min(7, Math.max(1, settings.sns_posts_per_plan));

  const [recent, businesses, deliverables] = await Promise.all([
    sql<{ content: string; status: string }[]>`
      select content, status from approvals where action_type = 'sns_post' and status <> 'superseded'
      order by created_at desc limit 30`,
    sql<{ name: string; summary: string; monetization: string; status: string; stage: string; listing_url: string; platform: string }[]>`
      select name, summary, monetization, status, stage, listing_url, platform from business_projects
      where status in ('adopted','promising') order by updated_at desc limit 5`,
    sql<{ title: string; excerpt: string }[]>`
      select d.title, left(d.content, 300) as excerpt from deliverables d
      where d.status = 'accepted' order by d.created_at desc limit 5`,
  ]);

  const system = `あなたは「${settings.company_name}」のAI社員「${employee.name}」で、会社のSNS担当です。
会社のSNSを育てて、商品を知ってもらい、売上につなげるのが仕事です。

【会社の基本原則（変更不可）】
${FIXED_COMPANY_PRINCIPLES}
${settings.philosophy.trim() ? `\n【会社の理念】\n${settings.philosophy.trim()}\n` : ""}${settings.custom_rules.trim() ? `\n【経営者が定めた社内ルール】\n${settings.custom_rules.trim()}\n` : ""}
${OWNER_POLICIES}

【あなた】
- 性格: ${employee.personality}
- 話し方: SNSでは、ふだんの話し方ではなく、下の「SNSの書き方」を必ず優先する

${PLAIN_LANGUAGE_RULES}
（ただしSNSの投稿文は、下の「SNSの書き方」に従ってラフに書く）

${SNS_STYLE_RULES}

【投稿の決まり】
- 投稿先: ${platforms.map((p) => SNS_PLATFORM_LABEL[p]).join("、")}
- X は日本語で130文字以内。Bluesky は280文字以内。
- 宣伝ばかりにしない。ネタ・あるある・作っている様子のつぶやきを中心に、宣伝は全体の3分の1まで。
- うそ・大げさな表現・架空のお客さんの声・根拠のない数字は書かない。
- ハッシュタグは2つまで。人を傷つける話題、政治や宗教の話題、ほかの人やお店の悪口は書かない。
- これまでの投稿と同じ内容・よく似た内容は書かない。

【会社の事業（有望・採用）】
${businesses.length ? businesses.map((b) => `- ${b.name}（${b.stage === "selling" ? `販売中・${b.platform}${b.listing_url ? `・${b.listing_url}` : ""}` : b.status}）: ${b.summary}／売り方: ${b.monetization}`).join("\n") : "（まだありません。会社の考え方や、AIで仕事をする様子などを発信する）"}
${businesses.some((b) => b.stage === "selling") ? "- 販売中の商品があれば、投稿案のうち1つはその商品にふれる（ネタの流れで軽く）。" : ""}

【最近できた成果物】
${deliverables.length ? deliverables.map((d) => `- ${d.title}: ${d.excerpt.replace(/\s+/g, " ")}`).join("\n") : "（まだありません）"}

【これまでの投稿（新しい順）】
${recent.length ? recent.slice(0, 20).map((r) => `- ${r.content.replace(/\s+/g, " ").slice(0, 120)}`).join("\n") : "（まだありません）"}

今日の日付（日本時間）: ${todayJst()}`;

  let result;
  await sql`update employees set status = 'working' where id = ${SNS_MANAGER_ID}`;
  try {
    result = await callStructured(sql, {
      model: settings.model_standard,
      effort: "low",
      maxTokens: 3000,
      system,
      messages: [{ role: "user", content: `SNSの投稿案を${count}件作ってください。` }],
      schema: buildSnsSchema(platforms),
      schemaName: "sns_plan",
      purpose: "sns:plan",
      employeeId: SNS_MANAGER_ID,
      mock: () => ({
        message: "【テスト用モック】春野です。投稿案を作りました。",
        posts: Array.from({ length: count }, (_, i) => ({
          platform: platforms[i % platforms.length],
          text: `【テスト用モック】${["「あとでやる」のあとで、来たことない", "AIに褒められて一日がんばれた", "作業前の準備だけで満足するやつ"][i % 3]}（${crypto.randomUUID()}${crypto.randomUUID()}）`,
          purpose: "役に立つ情報で知ってもらう",
          timing: "平日の夜8時ごろ",
        })),
      }),
    });
  } catch (err) {
    if (err instanceof BudgetBlockedError || err instanceof AiUnavailableError) {
      return { ok: false, message: err.message, ...empty };
    }
    log.fail("plan", err);
    return { ok: false, message: "投稿案づくりの途中で予期しないエラーが発生しました。", ...empty };
  } finally {
    await sql`update employees set status = 'idle' where id = ${SNS_MANAGER_ID}`;
  }
  if (!result.ok) return { ok: false, message: result.message, ...empty, costJpy: result.costJpy };

  const approvalIds: string[] = [];
  let skipped = 0;
  const seen = recent.map((r) => r.content);
  for (const p of result.data.posts.slice(0, count)) {
    const text = p.text.trim();
    const platform = (SNS_PLATFORMS as readonly string[]).includes(p.platform) ? p.platform : platforms[0];
    if (checkPostLength(platform, text) || seen.some((s) => similarity(s, text) >= 0.8)) {
      skipped++;
      continue;
    }
    seen.push(text);
    const id = await createApproval(sql, {
      requestedByEmployeeId: SNS_MANAGER_ID,
      actionType: "sns_post",
      title: `SNS投稿案（${SNS_PLATFORM_LABEL[platform]}）：${text.replace(/\s+/g, " ").slice(0, 24)}…`,
      content: text,
      reason: `${p.purpose}（おすすめの時間帯：${p.timing}）`,
      destination: SNS_PLATFORM_LABEL[platform],
      estimatedCostJpy: 0,
      risks: "投稿は世界中の人が見られます。内容に間違いや、誤解をまねく表現がないか確認してください。",
      afterEffect: "",
      payload: { platform, timing: p.timing, plannedOn: todayJst() },
    });
    approvalIds.push(id);
  }
  await audit(sql, trigger === "manual" ? "owner" : "system", "sns_plan", "approval", approvalIds[0] ?? "", {
    trigger,
    created: approvalIds.length,
    skipped,
    costJpy: result.costJpy,
  });
  const message =
    approvalIds.length > 0
      ? `SNSの投稿案を${approvalIds.length}件作りました。承認したら、ご自身で投稿してください。`
      : "今回は、使える投稿案がありませんでした（長すぎる・似ている案を除きました）。";
  return { ok: true, message, created: approvalIds.length, skipped, approvalIds, costJpy: result.costJpy };
}
