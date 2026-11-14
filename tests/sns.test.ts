// SNS運用・note記事のテスト（本物のSNSには投稿しない）
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { createApproval, decideApproval, executeApprovedAction, getApproval } from "@/lib/repo/approvals";
import {
  checkPostLength,
  linkFacets,
  oauth1Header,
  platformOf,
  postCostJpy,
  postToBluesky,
  postToX,
  xWeightedLength,
} from "@/lib/sns/post";
import { runSnsPlanning } from "@/lib/autonomy/sns";
import { runScheduledJobs } from "@/lib/autonomy/scheduler";
import { splitNoteArticle } from "@/app/(app)/tasks/[id]/deliverables/[version]/OutputButtons";

const X_ENV = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];
const uniq = () => crypto.randomUUID();

function setX(on: boolean) {
  for (const k of X_ENV) {
    if (on) process.env[k] = `test-${k}`;
    else delete process.env[k];
  }
}

beforeAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  const sql = await getDb();
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, monthly_target_jpy = 100000,
    daily_limit_jpy = 100000, max_calls_per_day = 2000, max_calls_per_minute = 60`;
  await sql`update company_settings set emergency_stop = false, sns_plan_frequency = 'off', sns_posts_per_plan = 2,
    sns_monthly_post_limit = 60, last_sns_plan_on = null, autorun_frequency = 'off'`;
  await sql.begin(async (tx) => {
    await tx`alter table api_usage disable trigger api_usage_guard`;
    await tx`update api_usage set created_at = created_at - interval '2 minutes' where created_at > now() - interval '2 minutes'`;
    await tx`alter table api_usage enable trigger api_usage_guard`;
  });
});
afterEach(() => {
  setX(false);
  delete process.env.BLUESKY_HANDLE;
  delete process.env.BLUESKY_APP_PASSWORD;
});
afterAll(async () => {
  const sql = await getDb();
  await sql`update company_settings set sns_plan_frequency = 'off', last_sns_plan_on = null`;
  await closeDb();
});

describe("投稿の文字数・費用・宛先", () => {
  it("X は日本語1文字=2、URL=23で数える", () => {
    expect(xWeightedLength("あ".repeat(140))).toBe(280);
    expect(checkPostLength("x", "あ".repeat(140))).toBeNull();
    expect(checkPostLength("x", "あ".repeat(141))).toMatch(/上限/);
    expect(xWeightedLength("abc https://example.com/very/long/path")).toBe(4 + 23);
    expect(checkPostLength("bluesky", "あ".repeat(300))).toBeNull();
    expect(checkPostLength("bluesky", "あ".repeat(301))).toMatch(/上限/);
    expect(checkPostLength("x", "  ")).toMatch(/空/);
  });

  it("Xはリンク入りだと費用が高い。Blueskyは0円", () => {
    expect(postCostJpy("x", "こんにちは", 150)).toBeCloseTo(2.25, 2);
    expect(postCostJpy("x", "見てね https://note.com/x", 150)).toBeCloseTo(30, 2);
    expect(postCostJpy("bluesky", "見てね https://note.com/x", 150)).toBe(0);
  });

  it("どのSNSかを決める", () => {
    expect(platformOf({ payload: { platform: "bluesky" }, destination: "X" })).toBe("bluesky");
    expect(platformOf({ payload: null, destination: "X（旧Twitter）" })).toBe("x");
    expect(platformOf({ payload: null, destination: "Twitter" })).toBe("x");
    expect(platformOf({ payload: null, destination: "Bluesky" })).toBe("bluesky");
    expect(platformOf({ payload: null, destination: "Instagram" })).toBeNull();
  });
});

describe("SNSへの投稿（通信は偽物）", () => {
  it("X：OAuth 1.0a の署名つきで投稿し、投稿のURLを返す", async () => {
    setX(true);
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: { id: "123", text: "x" } }), { status: 201 });
    }) as unknown as typeof fetch;
    const r = await postToX("テスト投稿", fake);
    expect(r.url).toBe("https://x.com/i/web/status/123");
    expect(calls[0].url).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "テスト投稿" });
    expect(String((calls[0].init.headers as Record<string, string>).Authorization)).toMatch(/^OAuth .*oauth_signature="/);
  });

  it("X：署名の計算が正しい", () => {
    const keys = { consumerKey: "ck", consumerSecret: "cs", token: "tk", tokenSecret: "ts" };
    const h = oauth1Header("POST", "https://api.x.com/2/tweets", keys, "nonce1", "1700000000");
    const base =
      "POST&" +
      encodeURIComponent("https://api.x.com/2/tweets") +
      "&" +
      encodeURIComponent("oauth_consumer_key=ck&oauth_nonce=nonce1&oauth_signature_method=HMAC-SHA1&oauth_timestamp=1700000000&oauth_token=tk&oauth_version=1.0");
    const sig = createHmac("sha1", "cs&ts").update(base).digest("base64");
    expect(h).toContain(`oauth_signature="${encodeURIComponent(sig)}"`);
  });

  it("X：残高不足などのときは分かりやすいエラー", async () => {
    setX(true);
    const fake = (async () => new Response('{"title":"CreditsDepleted"}', { status: 402 })) as unknown as typeof fetch;
    await expect(postToX("テスト", fake)).rejects.toThrow(/残高/);
  });

  it("Bluesky：ログインして投稿し、リンクを押せるようにする", async () => {
    process.env.BLUESKY_HANDLE = "me.bsky.social";
    process.env.BLUESKY_APP_PASSWORD = "app-pass";
    const bodies: Record<string, unknown>[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (url.endsWith("createSession")) return new Response(JSON.stringify({ accessJwt: "jwt", did: "did:plc:abc", handle: "me.bsky.social" }));
      return new Response(JSON.stringify({ uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz", cid: "c" }));
    }) as unknown as typeof fetch;
    const text = "記事を書きました https://note.com/abc";
    const r = await postToBluesky(text, fake);
    expect(r.url).toBe("https://bsky.app/profile/me.bsky.social/post/3kxyz");
    const record = (bodies[1] as { record: { text: string; facets: unknown[] } }).record;
    expect(record.text).toBe(text);
    expect(record.facets).toEqual(linkFacets(text));
    // 日本語はUTF-8で1文字3バイト。「記事を書きました 」= 8文字×3 + 1 = 25バイト目から
    expect(linkFacets(text)[0].index).toEqual({ byteStart: 25, byteEnd: 25 + "https://note.com/abc".length });
  });
});

describe("承認と投稿", () => {
  async function newSnsApproval(content = `テスト投稿 ${uniq()}`, destination = "X") {
    const sql = await getDb();
    const id = await createApproval(sql, {
      requestedByEmployeeId: "creative",
      actionType: "sns_post",
      title: "SNS投稿案",
      content,
      reason: "",
      destination,
      estimatedCostJpy: 999,
      risks: "",
      afterEffect: "AIが書いた説明",
    });
    return { sql, id, a: (await getApproval(sql, id))! };
  }

  it("SNSの承認依頼は、宛先・費用・説明をアプリが決める", async () => {
    const { a } = await newSnsApproval("見てね https://note.com/x");
    expect(a.payload.platform).toBe("x");
    expect(a.destination).toBe("X（旧Twitter）");
    expect(a.estimated_cost_jpy).toBeGreaterThan(20); // リンク入りは約30円（AIの999円ではない）
    expect(a.estimated_cost_jpy).toBeLessThan(50);
    expect(a.after_effect).toMatch(/アプリが自動で投稿/);
  });

  it("長すぎる投稿は、注意が書かれる", async () => {
    const { a } = await newSnsApproval("あ".repeat(200));
    expect(a.risks).toMatch(/上限/);
  });

  it("SNSの設定がなければ、承認しても投稿しない（あなたがコピーして投稿）", async () => {
    const { sql, id, a } = await newSnsApproval();
    await decideApproval(sql, id, "approve", "", a.content_hash);
    const r = await executeApprovedAction(sql, id);
    expect(r).toMatchObject({ ok: false, reason: "not_implemented" });
    expect((await getApproval(sql, id))!.status).toBe("approved");
  });

  it("設定があれば、承認後に投稿する（テスト用モードでは本物には投稿しない）。二重には投稿しない", async () => {
    setX(true);
    const { sql, id, a } = await newSnsApproval();
    const r0 = await executeApprovedAction(sql, id);
    expect(r0).toMatchObject({ ok: false, reason: "not_approved" });
    await decideApproval(sql, id, "approve", "", a.content_hash);
    const [r1, r2] = await Promise.all([executeApprovedAction(sql, id), executeApprovedAction(sql, id)]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    expect((await getApproval(sql, id))!.status).toBe("executed");
  });

  it("今月の上限に達していたら投稿しない", async () => {
    setX(true);
    const { sql, id, a } = await newSnsApproval();
    await sql`update company_settings set sns_monthly_post_limit = 0`;
    await decideApproval(sql, id, "approve", "", a.content_hash);
    const r = await executeApprovedAction(sql, id);
    expect(r).toMatchObject({ ok: false, reason: "limit" });
    expect((await getApproval(sql, id))!.status).toBe("approved");
  });
});

describe("SNS担当の投稿案づくり", () => {
  it("設定した数だけ、投稿案を承認依頼として作る", async () => {
    const sql = await getDb();
    const r = await runSnsPlanning(sql, "manual");
    expect(r.ok).toBe(true);
    expect(r.created).toBe(2);
    for (const id of r.approvalIds) {
      const a = (await getApproval(sql, id))!;
      expect(a.action_type).toBe("sns_post");
      expect(a.status).toBe("pending");
      expect(a.requested_by_employee_id).toBe("creative");
      expect(a.payload.platform).toBe("x");
    }
  });

  it("緊急停止中は作らない", async () => {
    const sql = await getDb();
    await sql`update company_settings set emergency_stop = true`;
    const r = await runSnsPlanning(sql, "manual");
    expect(r.ok).toBe(false);
  });

  it("定期実行：仕事探しの頻度が「停止」でも、SNSの設定で動く。同じ日に2回は作らない", async () => {
    const sql = await getDb();
    await sql`update company_settings set sns_plan_frequency = 'daily'`;
    const day = new Date("2030-03-05T00:00:00Z");
    const r1 = await runScheduledJobs(sql, day);
    expect(r1.ran).toEqual(["sns_plan"]);
    expect(r1.sns?.created).toBe(2);
    const r2 = await runScheduledJobs(sql, day);
    expect(r2.ran).toEqual([]);
  });
});

describe("note記事（貼り付け用）", () => {
  it("タイトル・値段・無料部分・有料部分・ハッシュタグに分ける", () => {
    const md = `# 小さく始める副業のはじめかた
値段: 500円

## 無料で読める部分
ここは誰でも読めます。

## 有料部分
ここからは有料です。
- ポイント1

## ハッシュタグ
#副業 #はじめかた`;
    expect(splitNoteArticle(md)).toEqual({
      title: "小さく始める副業のはじめかた",
      price: "500円",
      free: "ここは誰でも読めます。",
      paid: "ここからは有料です。\n- ポイント1",
      tags: "#副業 #はじめかた",
    });
  });
});
