"use client";

import { useEffect, useState } from "react";
import {
  generateVapidKeysAction,
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestNotificationAction,
} from "@/app/actions/notify";
import { Icon } from "@/components/Icon";
import { showToast } from "@/components/Toaster";

function b64ToUint8(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function toB64Url(buf: ArrayBuffer | null) {
  if (!buf) return "";
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Status = "checking" | "unsupported" | "denied" | "off" | "on";

/** この端末（iPhone）で通知を受け取るための設定 */
export function PushSetup({ configured, publicKey, deviceCount }: { configured: boolean; publicKey: string | null; deviceCount: number }) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let next: Status = "unsupported";
      if (supported) {
        if (Notification.permission === "denied") next = "denied";
        else {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = await reg?.pushManager.getSubscription();
          next = sub ? "on" : "off";
        }
      }
      if (!cancelled) setStatus(next);
    })().catch(() => !cancelled && setStatus("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = async () => {
    if (!publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        showToast("通知が許可されませんでした", "error");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) });
      const r = await savePushSubscriptionAction({
        endpoint: sub.endpoint,
        p256dh: toB64Url(sub.getKey("p256dh")),
        auth: toB64Url(sub.getKey("auth")),
        label: /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : "この端末",
      });
      if (!r.ok) throw new Error(r.error);
      setStatus("on");
      showToast(r.message ?? "登録しました");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "登録できませんでした", "error");
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
      showToast("この端末の通知を止めました", "info");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    const r = await sendTestNotificationAction();
    setBusy(false);
    if (r.ok) showToast(r.message ?? "送りました");
    else showToast(r.error ?? "送れませんでした", "error");
  };

  if (!configured) {
    return (
      <div className="space-y-3 text-sm">
        <p className="leading-relaxed">
          通知を使うには、最初に1回だけ「通知の鍵」を作って、Vercel に登録する必要があります。
        </p>
        {!keys ? (
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await generateVapidKeysAction();
              setBusy(false);
              if (r.ok && r.publicKey && r.privateKey) setKeys({ publicKey: r.publicKey, privateKey: r.privateKey });
              else showToast(r.error ?? "作れませんでした", "error");
            }}
          >
            通知の鍵を作る
          </button>
        ) : (
          <div className="space-y-2.5">
            <p className="rounded-[12px] bg-accent-soft px-3 py-2 text-[13px] text-accent">
              下の2つを Vercel の環境変数に登録してください。この画面を閉じると、もう表示されません（その場合は、もう一度作ればOKです）。
            </p>
            {[
              { name: "VAPID_PUBLIC_KEY", value: keys.publicKey },
              { name: "VAPID_PRIVATE_KEY", value: keys.privateKey },
            ].map((k) => (
              <div key={k.name} className="rounded-[12px] bg-surface-2 p-3">
                <p className="text-[12px] font-semibold">名前（Key）：{k.name}</p>
                <p className="mt-1 font-mono text-[11px] break-all text-muted">{k.value}</p>
                <button
                  type="button"
                  className="btn-tinted mt-2 w-full"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(k.value);
                      showToast(`${k.name} の値をコピーしました`);
                    } catch {
                      showToast("コピーできませんでした", "error");
                    }
                  }}
                >
                  値をコピー
                </button>
              </div>
            ))}
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
              <li>Vercel → このプロジェクト → Settings → Environment Variables を開く</li>
              <li>上の2つを、それぞれ「名前」と「値」で追加する（Production にチェック）</li>
              <li>Deployments → いちばん上の「…」→ Redeploy を押す</li>
              <li>数分後、この画面を開き直すと「この端末で通知を受け取る」ボタンが出ます</li>
            </ol>
            <p className="text-xs text-muted">※ VAPID_PRIVATE_KEY は秘密の値です。他の人に見せないでください。</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-center gap-2">
        <Icon name="bell" size={18} stroke={2} className="text-brand" />
        この端末：
        {status === "checking" && <span className="text-muted">確認中…</span>}
        {status === "on" && <b className="text-success">通知を受け取ります</b>}
        {status === "off" && <b className="text-muted">受け取っていません</b>}
        {status === "denied" && <b className="text-danger">通知がブロックされています</b>}
        {status === "unsupported" && <b className="text-muted">この画面からは使えません</b>}
      </p>
      {status === "off" && (
        <button type="button" className="btn-primary w-full" disabled={busy} onClick={subscribe}>
          この端末で通知を受け取る
        </button>
      )}
      {status === "on" && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-tinted" disabled={busy} onClick={test}>
            テスト通知
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={unsubscribe}>
            通知を止める
          </button>
        </div>
      )}
      {status === "unsupported" && (
        <p className="text-xs leading-relaxed text-muted">
          iPhone では、Safari の「共有」→「ホーム画面に追加」で追加したアプリを開いたときだけ通知を使えます（iOS 16.4 以上）。ホーム画面のアプリからこの画面を開いてください。
        </p>
      )}
      {status === "denied" && (
        <p className="text-xs leading-relaxed text-muted">
          iPhone の「設定」→「通知」→ このアプリ で、通知を許可してください。
        </p>
      )}
      <p className="text-xs text-muted">通知を受け取る端末：{deviceCount}台</p>
    </div>
  );
}
