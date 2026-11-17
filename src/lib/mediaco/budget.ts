import "server-only";
import type { Db } from "@/lib/db";
import { getSpendSummary } from "@/lib/budget";
import { getBudget } from "@/lib/repo/settings";
import { getPricing } from "@/lib/pricing";

// メディア事業のAI予算のルール（経営者の指示）
// - 80% に達したら：安いモデルを優先する
// - 95% に達したら：大事でない仕事（新しい記事の企画・X の投稿案・毎週の市場調査の更新）を止める
// - 100% に達したら：AI の新しい呼び出しを止める（src/lib/budget.ts の上限で必ず止まる）

export type BudgetTier = "normal" | "saving" | "critical" | "stopped";
export const TIER_LABEL: Record<BudgetTier, string> = {
  normal: "ふつう",
  saving: "節約中（安いモデルを使う）",
  critical: "大事な仕事だけ（95%以上）",
  stopped: "停止（上限に達した）",
};
/** 予算が少ないときに使う、いちばん安い文章のモデル */
export const CHEAP_MODEL = "gpt-5-nano";

export function tierFor(usedRatio: number): BudgetTier {
  if (usedRatio >= 1) return "stopped";
  if (usedRatio >= 0.95) return "critical";
  if (usedRatio >= 0.8) return "saving";
  return "normal";
}

export async function getBudgetTier(db: Db) {
  const [spend, budget] = await Promise.all([getSpendSummary(db), getBudget(db)]);
  const limit = Math.min(Number(budget.monthly_limit_jpy), Number(budget.emergency_stop_jpy));
  const ratio = limit > 0 ? spend.monthJpy / limit : 1;
  return { tier: tierFor(ratio), ratio, monthJpy: spend.monthJpy, todayJpy: spend.todayJpy, limitJpy: limit };
}

/** 予算の状態に合わせて使うモデル */
export function modelForTier(tier: BudgetTier, standard: string): string {
  if ((tier === "saving" || tier === "critical") && getPricing(CHEAP_MODEL)) return CHEAP_MODEL;
  return standard;
}

/** 大事でない仕事か（95%以上で止める） */
export function isLowPriority(kind: string): boolean {
  return ["article.plan", "posts.create", "research.weekly"].includes(kind);
}
