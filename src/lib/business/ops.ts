import "server-only";
import { z } from "zod";
import type { Sql } from "@/lib/db";
import { AiUnavailableError, BudgetBlockedError, callStructured } from "@/lib/ai/client";
import { FIXED_COMPANY_PRINCIPLES, OWNER_POLICIES, PLAIN_LANGUAGE_RULES } from "@/lib/ai/prompts";
import { audit } from "@/lib/repo/audit";
import { listBusinessProjects } from "@/lib/repo/business";
import { businessMoney } from "@/lib/repo/ledger";
import { getSettings } from "@/lib/repo/settings";
import { enqueueNotification } from "@/lib/notify";
import { startImprovement } from "./pipeline";

// 運営：販売中の事業を、毎週（金曜）事業開発担当が見て「運営レポート」を書く。
// 売上は経営者が記録した数字だけを使う。改善が必要なら、2週間に1回まで「運営の改善」の業務を自動で始める。

export const OpsSchema = z.object({
  summary: z.string().describe("今週の運営のまとめ（250字以内。数字はもらったものだけ）"),
  health: z.enum(["good", "ok", "bad"]).describe("調子：good=順調／ok=ふつう／bad=てこ入れが必要"),
  improvement: z
    .object({
      what: z.string().describe("改善すること（15字以内。例：説明文の見直し、宣伝の強化、値段の見直し、次の商品）"),
      detail: z.string().describe("具体的に何をどう改善するか（根拠つき）"),
    })
    .nullable()
    .describe("いちばん効果がありそうな改善1つ。不要なら null"),
});

const IMPROVE_INTERVAL_DAYS = 14;

export async function runOpsReviews(sql: Sql, trigger: "manual" | "scheduled"): Promise<{ reports: number; tasks: string[] }> {
  const settings = await getSettings(sql);
  const selling = (await listBusinessProjects(sql, { status: "adopted" })).filter((b) => b.stage === "selling");
  const out = { reports: 0, tasks: [] as string[] };
  if (selling.length === 0 || settings.emergency_stop) return out;
  for (const b of selling.slice(0, 5)) {
    const money = await businessMoney(sql, b.id);
    const [recent] = await sql<{ w: number; m: number; n7: number }[]>`
      select
        coalesce(sum(amount_jpy) filter (where kind = 'income' and occurred_on >= (now() at time zone 'Asia/Tokyo')::date - 7), 0)::float8 as w,
        coalesce(sum(amount_jpy) filter (where kind = 'income' and occurred_on >= (now() at time zone 'Asia/Tokyo')::date - 30), 0)::float8 as m,
        count(*) filter (where kind = 'income' and occurred_on >= (now() at time zone 'Asia/Tokyo')::date - 7)::int as n7
      from ledger_entries where business_project_id = ${b.id} and voided_at is null`;
    const days = b.launched_at ? Math.floor((Date.now() - new Date(b.launched_at).getTime()) / 86_400_000) : 0;
    const facts = {
      事業: b.name,
      売る場所: b.platform,
      販売ページ: b.listing_url,
      販売開始から: `${days}日`,
      直近7日の売上: recent.w,
      直近7日の売上の記録件数: recent.n7,
      直近30日の売上: recent.m,
      これまでの売上: money.income,
      これまでの費用: money.expense,
      AIの利用料: Math.round(money.api),
    };
    let summary = "";
    let improvement: { what: string; detail: string } | null = null;
    try {
      const r = await callStructured(sql, {
        model: settings.model_standard,
        effort: "low",
        maxTokens: 1500,
        system: `あなたは「${settings.company_name}」の事業開発担当です。販売中の事業の運営を見て、毎週の運営レポートを書きます。
【会社の基本原則（変更不可）】
${FIXED_COMPANY_PRINCIPLES}
${OWNER_POLICIES}
${PLAIN_LANGUAGE_RULES}
【ルール】
- 売上は、経営者が記録した数字だけ（下）。記録がない＝売れていない、とは限らない（記録し忘れの可能性も書く）。数字を作らない。
- 改善は、いちばん効果がありそうなもの1つだけ。販売ページの書きかえ・値段の変更・投稿は、経営者が自分で行う前提で。`,
        messages: [{ role: "user", content: JSON.stringify(facts) }],
        schema: OpsSchema,
        schemaName: "business_ops_review",
        purpose: "business:ops",
        employeeId: "bizdev",
        mock: () => ({
          summary: `【テスト用モック】販売開始から${days}日。直近7日の売上は${recent.w}円です。`,
          health: (recent.w > 0 ? "ok" : "bad") as "ok" | "bad",
          improvement: recent.w > 0 ? null : { what: "宣伝の強化", detail: "まだ売上の記録がないため、宣伝の投稿を増やす（推測）" },
        }),
      });
      if (!r.ok) continue;
      summary = r.data.summary;
      improvement = r.data.improvement;
      const health = { good: "順調", ok: "ふつう", bad: "てこ入れが必要" }[r.data.health];
      await sql`
        insert into reports (report_type, title, content, employee_id, period_start, period_end)
        values ('bizdev', ${`運営レポート：${b.name}（${health}）`.slice(0, 200)},
          ${`${summary}\n\n## 数字（経営者の記録から）\n${Object.entries(facts).map(([k, v]) => `- ${k}：${typeof v === "number" ? v.toLocaleString("ja-JP") : v}`).join("\n")}${improvement ? `\n\n## 次の改善\n- ${improvement.what}：${improvement.detail}` : ""}`},
          'bizdev', ((now() at time zone 'Asia/Tokyo')::date - 7), (now() at time zone 'Asia/Tokyo')::date)`;
      out.reports++;
    } catch (err) {
      if (err instanceof BudgetBlockedError || err instanceof AiUnavailableError) break;
      throw err;
    }
    // 改善の業務（自動で進める設定のとき・2週間に1回まで・進行中の業務がないとき）
    const tooSoon = b.last_improve_at && Date.now() - new Date(b.last_improve_at).getTime() < IMPROVE_INTERVAL_DAYS * 86_400_000;
    const busy = b.stage_task_id && b.stage_task_status && !["completed", "rejected", "failed"].includes(b.stage_task_status);
    if (improvement && b.auto_advance && !tooSoon && !busy) {
      const id = await startImprovement(sql, b.id, improvement.what, improvement.detail);
      if (id) out.tasks.push(id);
    }
  }
  if (out.reports && trigger === "scheduled") {
    await enqueueNotification(sql, {
      kind: "report",
      title: "事業開発担当から運営レポートが届きました",
      body: `販売中の事業 ${out.reports}件${out.tasks.length ? `・改善の業務 ${out.tasks.length}件` : ""}`,
      url: "/reports",
    });
  }
  await audit(sql, trigger === "manual" ? "owner" : "system", "business_ops_review", "business_project", "", out);
  return out;
}
