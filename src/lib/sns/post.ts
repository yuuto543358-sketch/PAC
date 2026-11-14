import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { SNS_PLATFORMS, type SnsPlatform } from "@/lib/constants";

// SNSへの投稿（経営者が承認したものだけ）。
// 鍵（パスワードのようなもの）は Vercel の環境変数にだけ保存し、画面には出しません。
// ・X      : X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET（X の開発者ページで発行）
// ・Bluesky: BLUESKY_HANDLE / BLUESKY_APP_PASSWORD（Bluesky の「アプリパスワード」）

/**
 * X の投稿料金の目安（米ドル）。2026年11月に調べた時点で、X の API は「使った分だけ払う」方式で、
 * 1投稿あたり約0.015ドル、リンク入りは約0.20ドルとされています（公式ページは未確認のため、多めに見る）。
 */
export const X_POST_USD = 0.015;
export const X_LINK_POST_USD = 0.2;

export function isPlatformConfigured(p: SnsPlatform): boolean {
  if (p === "x") {
    return Boolean(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET);
  }
  return Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD);
}

export function configuredPlatforms(): SnsPlatform[] {
  return SNS_PLATFORMS.filter(isPlatformConfigured);
}

/** 承認依頼から、どのSNSに投稿するかを決める（payload.platform が優先。なければ「実行先」の文字から） */
export function platformOf(a: { payload: Record<string, unknown> | null; destination: string }): SnsPlatform | null {
  const p = a.payload?.platform;
  if (typeof p === "string" && (SNS_PLATFORMS as readonly string[]).includes(p)) return p as SnsPlatform;
  const d = a.destination.toLowerCase();
  if (/bluesky|bsky|ブルースカイ/.test(d)) return "bluesky";
  if (/(^|[^a-z])x([^a-z]|$)|twitter|ツイッター|エックス/.test(d)) return "x";
  return null;
}

const URL_RE = /https?:\/\/[^\s<>"'）」]+/g;

export function hasLink(text: string) {
  return new RegExp(URL_RE.source).test(text);
}

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

/** 1投稿にかかる費用の目安（円） */
export function postCostJpy(platform: SnsPlatform | null, text: string, usdJpyRate: number): number {
  if (platform !== "x") return 0;
  const usd = hasLink(text) ? X_LINK_POST_USD : X_POST_USD;
  return Math.round(usd * usdJpyRate * 100) / 100;
}

type Fetch = typeof fetch;
export type PostResult = { url: string; id: string };

// ----- X（OAuth 1.0a の署名つきで投稿） -----

function pct(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function oauth1Header(
  method: string,
  url: string,
  keys: { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string },
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString(),
): string {
  const params: Record<string, string> = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: keys.token,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${pct(url)}&${pct(paramString)}`;
  const signature = createHmac("sha1", `${pct(keys.consumerSecret)}&${pct(keys.tokenSecret)}`).update(base).digest("base64");
  const all = { ...params, oauth_signature: signature };
  return `OAuth ${Object.keys(all)
    .sort()
    .map((k) => `${pct(k)}="${pct(all[k as keyof typeof all])}"`)
    .join(", ")}`;
}

async function readError(res: Response) {
  const body = await res.text().catch(() => "");
  return `${res.status} ${body.slice(0, 300)}`;
}

export async function postToX(text: string, fetchImpl: Fetch = fetch): Promise<PostResult> {
  const url = "https://api.x.com/2/tweets";
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: oauth1Header("POST", url, {
        consumerKey: process.env.X_API_KEY!,
        consumerSecret: process.env.X_API_SECRET!,
        token: process.env.X_ACCESS_TOKEN!,
        tokenSecret: process.env.X_ACCESS_TOKEN_SECRET!,
      }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error(`Xの鍵が正しくないか、投稿の権限がありません（${await readError(res)}）`);
    if (res.status === 402 || res.status === 429) throw new Error(`Xの利用残高が足りないか、投稿の回数制限です（${await readError(res)}）`);
    throw new Error(`Xへの投稿に失敗しました（${await readError(res)}）`);
  }
  const json = (await res.json()) as { data?: { id?: string } };
  const id = json.data?.id;
  if (!id) throw new Error("Xから投稿の番号が返ってきませんでした");
  return { id, url: `https://x.com/i/web/status/${id}` };
}

// ----- Bluesky -----

/** 本文のURLを、Bluesky でリンクとして押せるようにする（位置はUTF-8のバイト数で数える） */
export function linkFacets(text: string) {
  const enc = new TextEncoder();
  const facets: { index: { byteStart: number; byteEnd: number }; features: { $type: string; uri: string }[] }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    const byteEnd = byteStart + enc.encode(m[0]).length;
    facets.push({ index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  return facets;
}

export async function postToBluesky(text: string, fetchImpl: Fetch = fetch): Promise<PostResult> {
  const host = "https://bsky.social";
  const s = await fetchImpl(`${host}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: process.env.BLUESKY_HANDLE, password: process.env.BLUESKY_APP_PASSWORD }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!s.ok) throw new Error(`Blueskyにログインできませんでした。ハンドルとアプリパスワードを確認してください（${await readError(s)}）`);
  const session = (await s.json()) as { accessJwt: string; did: string; handle: string };
  const facets = linkFacets(text);
  const r = await fetchImpl(`${host}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        langs: ["ja"],
        ...(facets.length ? { facets } : {}),
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Blueskyへの投稿に失敗しました（${await readError(r)}）`);
  const rec = (await r.json()) as { uri: string };
  const rkey = rec.uri.split("/").pop() ?? "";
  return { id: rec.uri, url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
}

export async function postTo(platform: SnsPlatform, text: string, fetchImpl: Fetch = fetch): Promise<PostResult> {
  const problem = checkPostLength(platform, text);
  if (problem) throw new Error(problem);
  return platform === "x" ? postToX(text, fetchImpl) : postToBluesky(text, fetchImpl);
}
