// SNS運用・note記事のテスト（本物のSNSには投稿しない）
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { OWNER_POSTS_AFTER_EFFECT } from "@/lib/constants";
import { createApproval, decideApproval, executeApprovedAction, getApproval } from "@/lib/repo/approvals";
import { checkPostLength, composeUrl, platformOf, xWeightedLength } from "@/lib/sns/post";
import { runSnsPlanning } from "@/lib/autonomy/sns";
import { runScheduledJobs } from "@/lib/autonomy/scheduler";
import { splitNoteArticle } from "@/app/(app)/tasks/[id]/deliverables/[version]/OutputButtons";

const uniq = () => crypto.randomUUID();

beforeAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  const sql = await getDb();
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, monthly_target_jpy = 100000,
    daily_limit_jpy = 100000, max_calls_per_day = 2000, max_calls_per_minute = 60`;
  await sql`update company_settings set emergency_stop = false, sns_plan_frequency = 'off', sns_posts_per_plan = 2,
    sns_platforms = '{x}', last_sns_plan_on = null, autorun_frequency = 'off'`;
  // ライフの定期処理はこのテストの対象外（質問は停止、分析は実行済みの扱い）
  await sql`update company_settings set life_question_frequency = 'off', last_life_analysis_on = '2099-12-31', last_life_review_on = '2099-12-31', life_nudge_enabled = false, life_prep_enabled = false, life_research_enabled = false`;
  await sql.begin(async (tx) => {
    await tx`alter table api_usage disable trigger api_usage_guard`;
    await tx`update api_usage set created_at = created_at - interval '2 minutes' where created_at > now() - interval '2 minutes'`;
    await tx`alter table api_usage enable trigger api_usage_guard`;
  });
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

  it("文章が入った投稿画面を開くリンク（投稿はしない）", () => {
    expect(composeUrl("x", "こんにちは #テスト")).toBe(`https://x.com/intent/post?text=${encodeURIComponent("こんにちは #テスト")}`);
    expect(composeUrl("bluesky", "a&b")).toBe("https://bsky.app/intent/compose?text=a%26b");
  });

  it("どのSNSかを決める", () => {
    expect(platformOf({ payload: { platform: "bluesky" }, destination: "X" })).toBe("bluesky");
    expect(platformOf({ payload: null, destination: "X（旧Twitter）" })).toBe("x");
    expect(platformOf({ payload: null, destination: "Twitter" })).toBe("x");
    expect(platformOf({ payload: null, destination: "Bluesky" })).toBe("bluesky");
    expect(platformOf({ payload: null, destination: "Instagram" })).toBeNull();
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

  it("SNSの承認依頼は、宛先と説明をアプリが決める（費用0円・アプリは投稿しない）", async () => {
    const { a } = await newSnsApproval("見てね https://note.com/x");
    expect(a.payload.platform).toBe("x");
    expect(a.destination).toBe("X（旧Twitter）");
    expect(a.estimated_cost_jpy).toBe(0);
    expect(a.after_effect).toBe(OWNER_POSTS_AFTER_EFFECT);
  });

  it("長すぎる投稿は、注意が書かれる", async () => {
    const { a } = await newSnsApproval("あ".repeat(200));
    expect(a.risks).toMatch(/上限/);
  });

  it("承認しても、アプリは投稿しない（投稿の仕組みを渡されても実行しない）", async () => {
    const { sql, id, a } = await newSnsApproval();
    await decideApproval(sql, id, "approve", "", a.content_hash);
    let posted = 0;
    const r = await executeApprovedAction(sql, id, { sns_post: async () => { posted++; return { summary: "posted" }; } });
    expect(r).toMatchObject({ ok: false, reason: "not_implemented" });
    expect(posted).toBe(0);
    expect((await getApproval(sql, id))!.status).toBe("approved");
  });
});

describe("SNS担当の投稿案づくり", () => {
  it("選んだSNS向けに、設定した数だけ投稿案を承認依頼として作る", async () => {
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
    await sql`update company_settings set sns_platforms = '{bluesky}'`;
    const r2 = await runSnsPlanning(sql, "manual");
    for (const id of r2.approvalIds) expect((await getApproval(sql, id))!.payload.platform).toBe("bluesky");
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
