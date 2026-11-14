import "server-only";
import webpush from "web-push";
import type { Db, Sql } from "@/lib/db";
import { createStepLogger } from "@/lib/log";

// iPhone のホーム画面アプリへの「プッシュ通知」。
// 1. 知らせたいことが起きたら、まず「順番待ちの表（notifications）」に入れる（同じ通知は二重に入らない）
// 2. あとで dispatchNotifications がまとめて送る
// 通知の中身は短いお知らせだけで、会社の詳しい情報は入れません（タップするとアプリが開きます）。

export type NotificationKind = "approval" | "question" | "budget" | "report" | "test";

/** 通知の鍵（VAPID）が設定されているか */
export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && vapidSubject());
}

/** 画面に渡してよい「公開用の鍵」（秘密ではありません） */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function vapidSubject(): string | null {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : null;
}

/** 通知の鍵を新しく作る（設定画面で、Vercel に貼りつけてもらうため） */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}

type Enqueue = { kind: NotificationKind; title: string; body?: string; url?: string; dedupeKey?: string | null };

/**
 * 通知を順番待ちに入れる。経営者の設定（通知のオン・オフ）に従う。
 * 予算の通知は「予算の通知」、それ以外は「承認・質問・報告の通知」の設定で決まる。
 */
export async function enqueueNotification(db: Db, n: Enqueue) {
  const [s] = await db<{ notify_approvals: boolean; notify_budget: boolean }[]>`
    select notify_approvals, notify_budget from company_settings where id = 1`;
  if (!s) return;
  if (n.kind === "budget" ? !s.notify_budget : n.kind !== "test" && !s.notify_approvals) return;
  await db`
    insert into notifications (kind, title, body, url, dedupe_key)
    values (${n.kind}, ${n.title.slice(0, 80)}, ${(n.body ?? "").slice(0, 160)}, ${safePath(n.url)}, ${n.dedupeKey ?? null})
    on conflict (dedupe_key) do nothing`;
}

/** 通知をタップしたときに開く場所。アプリの中のページだけにする */
function safePath(url: string | undefined): string {
  if (!url || !url.startsWith("/") || url.startsWith("//")) return "/";
  return url.slice(0, 300);
}

type Sender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<{ statusCode: number }>;

function defaultSender(): Sender {
  webpush.setVapidDetails(vapidSubject()!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  return (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 24, urgency: "normal" });
}

export type DispatchResult = { sent: number; skipped: number; failed: number };

/**
 * 順番待ちの通知を送る。鍵が未設定、または受け取る端末が1台もなければ「送らない（skipped）」にする。
 * 同時に2か所で動いても同じ通知を二重に送らないよう、送る前に「送信済み」にしてから送る。
 */
export async function dispatchNotifications(sql: Sql, sender?: Sender): Promise<DispatchResult> {
  const log = createStepLogger("push");
  const result: DispatchResult = { sent: 0, skipped: 0, failed: 0 };
  const subs = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
    select id, endpoint, p256dh, auth from push_subscriptions order by created_at`;
  const usable = Boolean(sender) || isPushConfigured();
  if (!usable || subs.length === 0) {
    const rows = await sql`
      update notifications set status = 'skipped', error = ${usable ? "受け取る端末がありません" : "通知の鍵が未設定です"}
      where status = 'pending' returning id`;
    result.skipped = rows.length;
    return result;
  }
  const claimed = await sql<{ id: number; kind: string; title: string; body: string; url: string }[]>`
    update notifications set status = 'sent', attempts = attempts + 1, sent_at = now()
    where id in (select id from notifications where status = 'pending' order by created_at limit 20 for update skip locked)
    returning id, kind, title, body, url`;
  if (claimed.length === 0) return result;
  const send = sender ?? defaultSender();
  for (const n of claimed) {
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.kind });
    let ok = 0;
    let lastError = "";
    for (const s of subs) {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        ok++;
        await sql`update push_subscriptions set last_success_at = now(), failures = 0 where id = ${s.id}`;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode ?? 0;
        lastError = `${status || "通信エラー"}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
        if (status === 404 || status === 410) {
          // その端末で通知がオフにされた・アプリが消された。受け取り先から外す
          await sql`delete from push_subscriptions where id = ${s.id}`;
        } else {
          await sql`update push_subscriptions set failures = failures + 1 where id = ${s.id}`;
        }
      }
    }
    if (ok > 0) result.sent++;
    else {
      result.failed++;
      await sql`update notifications set status = 'failed', error = ${lastError} where id = ${n.id}`;
    }
  }
  log.step("dispatched", result);
  return result;
}

export async function savePushSubscription(
  db: Db,
  sub: { endpoint: string; p256dh: string; auth: string; label: string },
) {
  let url: URL;
  try {
    url = new URL(sub.endpoint);
  } catch {
    throw new Error("通知の受け取り先が正しくありません");
  }
  if (url.protocol !== "https:") throw new Error("通知の受け取り先が正しくありません");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(sub.p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(sub.auth)) {
    throw new Error("通知の鍵が正しくありません");
  }
  await db`
    insert into push_subscriptions (endpoint, p256dh, auth, device_label)
    values (${sub.endpoint.slice(0, 1000)}, ${sub.p256dh}, ${sub.auth}, ${sub.label.slice(0, 100)})
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
      device_label = excluded.device_label, failures = 0`;
}

export async function deletePushSubscription(db: Db, endpoint: string) {
  await db`delete from push_subscriptions where endpoint = ${endpoint}`;
}

export async function countPushSubscriptions(db: Db): Promise<number> {
  const [r] = await db<{ n: number }[]>`select count(*)::int as n from push_subscriptions`;
  return r.n;
}
