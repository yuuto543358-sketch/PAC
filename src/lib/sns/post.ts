import { SNS_PLATFORMS, type SnsPlatform } from "@/lib/constants";

// SNSの投稿は、経営者が自分で行う（経営者の方針）。アプリはSNSに投稿しません。
// ここにあるのは、投稿案の文字数チェックと、「Xで開く」「Blueskyで開く」のリンクを作る道具だけです。
// （リンクを開くと、文章が入った状態の投稿画面が開きます。投稿ボタンは経営者が押します）

/** 承認依頼から、どのSNS向けかを決める（payload.platform が優先。なければ「実行先」の文字から） */
export function platformOf(a: { payload: Record<string, unknown> | null; destination: string }): SnsPlatform | null {
  const p = a.payload?.platform;
  if (typeof p === "string" && (SNS_PLATFORMS as readonly string[]).includes(p)) return p as SnsPlatform;
  const d = a.destination.toLowerCase();
  if (/bluesky|bsky|ブルースカイ/.test(d)) return "bluesky";
  if (/(^|[^a-z])x([^a-z]|$)|twitter|ツイッター|エックス/.test(d)) return "x";
  return null;
}

const URL_RE = /https?:\/\/[^\s<>"'）」]+/g;

/** X の文字数の数え方（日本語は1文字=2、URLは23として数える）。上限は280 */
export function xWeightedLength(text: string): number {
  let n = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    n += 23;
    return "";
  });
  for (const ch of withoutUrls) {
    const c = ch.codePointAt(0)!;
    const light = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** Bluesky の文字数（見た目の1文字ずつ）。上限は300 */
export function graphemeLength(text: string): number {
  return [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)].length;
}

export function checkPostLength(platform: SnsPlatform, text: string): string | null {
  if (!text.trim()) return "投稿する文章が空です";
  if (platform === "x" && xWeightedLength(text) > 280) return "Xの文字数の上限（日本語なら約140文字）を超えています";
  if (platform === "bluesky" && graphemeLength(text) > 300) return "Blueskyの文字数の上限（300文字）を超えています";
  return null;
}

/** 文章が入った状態の投稿画面を開くリンク（投稿はしない。開いた画面で経営者が投稿ボタンを押す） */
export function composeUrl(platform: SnsPlatform, text: string): string {
  const t = encodeURIComponent(text);
  return platform === "x" ? `https://x.com/intent/post?text=${t}` : `https://bsky.app/intent/compose?text=${t}`;
}
