"use client";

import { Icon } from "@/components/Icon";
import { showToast } from "@/components/Toaster";

/** 宛先の文字から、メールアドレスを1つ取り出す（なければ空） */
export function findEmail(text: string): string {
  const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : "";
}

/**
 * メール・メッセージを「あなたが自分で送る」ための道具。
 * アプリからは何も送信しません（コピーするか、iPhone のメールアプリを開くだけ）。
 */
export function SelfSendPanel({ subject, body, destination }: { subject: string; body: string; destination: string }) {
  const email = findEmail(destination);
  // iPhone のメールアプリで、宛先・件名・本文が入った状態で開く（送信ボタンはあなたが押す）
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label}をコピーしました`);
    } catch {
      showToast("コピーできませんでした", "error");
    }
  };
  return (
    <div className="card space-y-3 p-4">
      <p className="text-[14px] leading-relaxed">
        <b>このメール（メッセージ）は、あなたが自分で送ります。</b>
        アプリが勝手に送ることはありません。下のボタンで本文をコピーするか、メールアプリを開いて送ってください。
      </p>
      {destination && (
        <p className="rounded-[12px] bg-surface-2 px-3 py-2 text-[13px]">
          <span className="font-semibold">送り先：</span>
          {destination}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-tinted" onClick={() => copy(body, "本文")}>
          <Icon name="document" size={18} stroke={2} />
          本文をコピー
        </button>
        <a href={mailto} className="btn-secondary px-3">
          <Icon name="send" size={18} stroke={2} />
          <span className="whitespace-nowrap">メールアプリで開く</span>
        </a>
      </div>
      {!email && (
        <p className="text-xs text-muted">
          送り先にメールアドレスが書かれていないため、メールアプリでは宛先が空のまま開きます。LINE などで送るときは「本文をコピー」を使ってください。
        </p>
      )}
    </div>
  );
}

/** メール以外の外部への操作（SNS投稿など）。アプリは実行しないので、内容をコピーして経営者が自分で行う */
export function OwnerDoPanel({ body }: { body: string }) {
  return (
    <div className="card space-y-3 p-4">
      <p className="text-[14px] leading-relaxed">
        <b>このアプリには、外部で自動的に実行する機能はありません。</b>
        必要なら、下のボタンで内容をコピーして、あなたが行ってください（SNSへの投稿、サービスへの登録など）。
      </p>
      <button
        type="button"
        className="btn-tinted w-full"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(body);
            showToast("内容をコピーしました");
          } catch {
            showToast("コピーできませんでした", "error");
          }
        }}
      >
        <Icon name="document" size={18} stroke={2} />
        内容をコピー
      </button>
    </div>
  );
}

/** SNSへの投稿は、あなたが自分で行う。文章が入った投稿画面を開くか、コピーして使う */
export function SelfPostPanel({ body, composeUrl, platformLabel }: { body: string; composeUrl: string | null; platformLabel: string }) {
  return (
    <div className="card space-y-3 p-4">
      <p className="text-[14px] leading-relaxed">
        <b>投稿は、あなたが行います。</b>アプリがSNSに投稿することはありません。
        {composeUrl ? `「${platformLabel}で開く」を押すと、文章が入った投稿画面が開きます。内容を見て、投稿ボタンを押してください。` : "下のボタンで文章をコピーして、SNSに貼りつけてください。"}
      </p>
      <div className={`grid gap-2 ${composeUrl ? "grid-cols-2" : "grid-cols-1"}`}>
        {composeUrl && (
          <a href={composeUrl} target="_blank" rel="noopener noreferrer" className="btn-primary px-3">
            <Icon name="send" size={18} stroke={2} />
            <span className="whitespace-nowrap">{platformLabel}で開く</span>
          </a>
        )}
        <button
          type="button"
          className="btn-tinted"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(body);
              showToast("文章をコピーしました");
            } catch {
              showToast("コピーできませんでした", "error");
            }
          }}
        >
          <Icon name="document" size={18} stroke={2} />
          文章をコピー
        </button>
      </div>
    </div>
  );
}
