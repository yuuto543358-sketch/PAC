"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import {
  deletePushSubscription,
  dispatchNotifications,
  enqueueNotification,
  generateVapidKeys,
  isPushConfigured,
  savePushSubscription,
} from "@/lib/notify";
import type { ActionState } from "@/components/forms";

const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });

/** この端末を、通知の受け取り先として登録する */
export async function savePushSubscriptionAction(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
}): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await savePushSubscription(sql, input);
    await audit(sql, "user", "push_subscribed", "push_subscription", "", { label: input.label });
    refresh();
    return { ok: true, message: "この端末で通知を受け取れるようになりました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function removePushSubscriptionAction(endpoint: string): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await deletePushSubscription(sql, endpoint);
    await audit(sql, "user", "push_unsubscribed", "push_subscription", "");
    refresh();
    return { ok: true, message: "この端末の通知を止めました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function sendTestNotificationAction(): Promise<ActionState> {
  try {
    await assertAuth();
    if (!isPushConfigured()) throw new Error("通知の鍵がまだ設定されていません");
    const sql = await getDb();
    await enqueueNotification(sql, { kind: "test", title: "テスト通知", body: "通知はこのように届きます。", url: "/settings#notify" });
    const r = await dispatchNotifications(sql);
    if (r.sent === 0) {
      throw new Error(r.failed > 0 ? "通知を送れませんでした。もう一度「この端末で通知を受け取る」を押してください" : "受け取る端末がありません");
    }
    return { ok: true, message: "テスト通知を送りました。数秒で届きます", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function updateNotifySettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const approvals = fd.get("notify_approvals") === "on";
    const budget = fd.get("notify_budget") === "on";
    const sql = await getDb();
    await sql`update company_settings set notify_approvals = ${approvals}, notify_budget = ${budget}, updated_at = now() where id = 1`;
    await audit(sql, "user", "update_notify", "company_settings", "1", { approvals, budget });
    refresh();
    return { ok: true, message: "通知の設定を保存しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 通知の鍵を作る（まだ設定されていないときだけ）。
 * 作った鍵はデータベースにも保存しません。表示された2つの値を、経営者が Vercel の環境変数に貼りつけます。
 */
export async function generateVapidKeysAction(): Promise<{ ok: boolean; publicKey?: string; privateKey?: string; error?: string }> {
  try {
    await assertAuth();
    if (isPushConfigured()) return { ok: false, error: "通知の鍵はすでに設定されています" };
    const sql = await getDb();
    await audit(sql, "user", "vapid_keys_generated", "company_settings", "1");
    return { ok: true, ...generateVapidKeys() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "処理に失敗しました" };
  }
}
