"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { runSnsPlanning } from "@/lib/autonomy/sns";
import { SNS_PLAN_OPTIONS, SNS_PLATFORMS } from "@/lib/constants";
import { audit } from "@/lib/repo/audit";
import { kickNotifications } from "@/lib/notify/trigger";
import type { ActionState } from "@/components/forms";

const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });

/** 「今すぐ投稿案を作る」 */
export async function planSnsNowAction(): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const r = await runSnsPlanning(sql, "manual");
    kickNotifications();
    refresh();
    return r.ok ? { ok: true, message: r.message, ts: Date.now() } : { ok: false, error: r.message, ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function updateSnsSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const freq = String(fd.get("sns_plan_frequency") ?? "off");
    if (!SNS_PLAN_OPTIONS.some((o) => o.id === freq)) throw new Error("頻度が正しくありません");
    const perPlan = Math.round(Number(fd.get("sns_posts_per_plan")));
    if (!(perPlan >= 1 && perPlan <= 7)) throw new Error("1回に作る数は1〜7件にしてください");
    const platforms = SNS_PLATFORMS.filter((p) => fd.get(`platform_${p}`) === "on");
    if (platforms.length === 0) throw new Error("投稿案を作るSNSを1つ以上選んでください");
    const sql = await getDb();
    await sql`
      update company_settings set sns_plan_frequency = ${freq}, sns_posts_per_plan = ${perPlan},
        sns_platforms = ${platforms}::text[], updated_at = now()
      where id = 1`;
    await audit(sql, "user", "update_sns_settings", "company_settings", "1", { freq, perPlan, platforms });
    refresh();
    return { ok: true, message: "SNS運用の設定を保存しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}
