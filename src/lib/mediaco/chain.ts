import "server-only";
import type { Sql } from "@/lib/db";
import { createStepLogger } from "@/lib/log";
import { dispatchNotifications } from "@/lib/notify";
import { runMediaEngine, type EngineResult } from "./engine";

// 1回の実行（約3分）で終わらなかったメディアの仕事を、次の実行につないで続ける。
// 以前は、時間のかかる仕事（執筆・修正など）が残り時間に収まらないと、そこで止まり、次の自動実行（数時間後）まで待っていた。
// - 次の実行は、このアプリ自身の /api/cron/media を呼んで始める（合言葉 CRON_SECRET が必要。外からは動かせない）
// - つなぐのは1回のきっかけにつき最大 MAX_CHAIN_HOPS 回まで（費用をかけすぎない）。予算の上限・緊急停止は、毎回いつもどおり確かめる

export const MAX_CHAIN_HOPS = 8;

/** 続きがあって、すぐ次につないでよいか（失敗ばかり・予算で止まった・やることがない、ならつながない） */
export function shouldContinue(r: EngineResult | null | undefined): boolean {
  return Boolean(r && r.status === "ran" && r.more && !r.stoppedReason && r.steps.some((s) => s.status === "done"));
}

/** 次の実行を呼ぶ先。本番では Vercel の本番のアドレスを使い、なければ今のアクセス先を使う */
export function chainOrigin(fallback: string | null): string | null {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return fallback;
}

/** 次の実行を始めてもらう（相手はすぐ「受け付けた」と返し、裏で仕事を進める） */
export async function kickMediaChain(origin: string | null, hop: number): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin || hop > MAX_CHAIN_HOPS) return false;
  try {
    const res = await fetch(`${origin}/api/cron/media?hop=${hop}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    return res.status === 202;
  } catch (err) {
    createStepLogger("media").fail("chain kick", err);
    return false;
  }
}

/** メディアの仕事を1回進め、続きがあれば次の実行につなぐ */
export async function runMediaChainStep(sql: Sql, opts: { origin: string | null; hop: number; trigger: string }): Promise<EngineResult> {
  const r = await runMediaEngine(sql, { maxSteps: 6, deadlineMs: 190_000, trigger: opts.trigger });
  try {
    // 記事ができた・承認のお願いなどの通知を送る
    await dispatchNotifications(sql);
  } catch (err) {
    createStepLogger("media").fail("notify", err);
  }
  if (shouldContinue(r)) await kickMediaChain(opts.origin, opts.hop + 1);
  return r;
}
