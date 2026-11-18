// AI Media Company の自動運営のテスト（AIはテスト用のモック。本物の記事・投稿は作らない）
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { mockHooks } from "@/lib/ai/client";
import { decideNext, runMediaEngine, QUALITY_PASS } from "@/lib/mediaco/engine";
import { modelForTier, tierFor, CHEAP_MODEL } from "@/lib/mediaco/budget";
import { startJob, finishJob } from "@/lib/mediaco/jobs";
import { normalizeScores } from "@/lib/mediaco/schemas";
import { dashboardNumbers, getActiveBrand, listArticles, markArticlePublished, recordArticleMetrics, recordPost } from "@/lib/mediaco/repo";
import { decideApproval } from "@/lib/repo/approvals";
import { getSettings } from "@/lib/repo/settings";

// 日本時間の正午
const at = (date: string) => new Date(`${date}T03:00:00Z`);
const MONDAY = "2030-04-08";

async function resetMedia() {
  const sql = await getDb();
  await sql`delete from media_jobs`;
  await sql`delete from media_posts`;
  await sql`delete from media_articles`;
  await sql`delete from media_brands`;
  await sql`delete from media_genres`;
  await sql`delete from media_research_runs`;
  await sql`update company_settings set media_enabled = true, notify_approvals = true, emergency_stop = false, web_research_enabled = true,
    media_articles_per_day = 1, media_posts_per_day = 2, media_lease_until = null, media_lease_owner = '',
    last_media_plan_on = null, last_media_posts_on = null, last_media_weekly_on = null, last_media_research_on = null,
    last_media_monthly_on = '', media_insights = ''`;
}

beforeAll(async () => {
  await closeDb();
  await resetMedia();
});
beforeEach(async () => {
  const sql = await getDb();
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, monthly_target_jpy = 100000,
    daily_limit_jpy = 100000, max_calls_per_day = 2000, max_calls_per_minute = 60`;
  mockHooks.failNext = 0;
  await sql.begin(async (tx) => {
    await tx`alter table api_usage disable trigger api_usage_guard`;
    await tx`update api_usage set created_at = created_at - interval '2 minutes' where created_at > now() - interval '2 minutes'`;
    await tx`alter table api_usage enable trigger api_usage_guard`;
  });
});
afterAll(async () => {
  const sql = await getDb();
  await sql`update company_settings set media_enabled = false`;
  await closeDb();
});

describe("フェーズ1〜5：市場調査 → ジャンル選定 → ブランド → 記事 → Xの投稿案", () => {
  it("はじめて動かすと、自分で市場を調べてジャンルを選び、ブランドを作り、記事と投稿案まで作る", async () => {
    const sql = await getDb();
    const r = await runMediaEngine(sql, { now: at(MONDAY), maxSteps: 30 });
    expect(r.status).toBe("ran");
    const kinds = r.steps.map((s) => s.kind);
    expect(kinds.slice(0, 6)).toEqual(["research.screen", "research.deep", "research.deep", "research.deep", "research.select", "brand.design"]);
    expect(kinds).toEqual(expect.arrayContaining(["article.plan", "article.research", "article.write", "article.check", "posts.create"]));
    expect(r.steps.every((s) => s.status === "done")).toBe(true);

    // 市場調査：複数ジャンルを100点満点で評価し、上位3つを深掘りして1つを選ぶ
    const [run] = await sql<{ id: string; status: string; selected_genre_id: string }[]>`select id, status, selected_genre_id from media_research_runs where kind = 'initial'`;
    expect(run.status).toBe("done");
    const screened = await sql<{ name: string; total: number; sources: unknown[]; researched_on: Date }[]>`
      select name, total, sources, researched_on from media_genres where run_id = ${run.id} and stage = 'screened' order by total desc`;
    expect(screened.length).toBe(8);
    expect(screened.every((g) => g.total >= 0 && g.total <= 100 && g.researched_on)).toBe(true);
    expect(screened[0].sources.length).toBeGreaterThan(0); // 情報源が残る
    const deep = await sql<{ name: string; total: number; selected: boolean }[]>`
      select name, total, selected from media_genres where run_id = ${run.id} and stage = 'deep' order by total desc`;
    expect(deep.map((d) => d.name).sort()).toEqual(screened.slice(0, 3).map((g) => g.name).sort());
    expect(deep[0].selected).toBe(true);
    expect(deep.filter((d) => d.selected)).toHaveLength(1);

    // ブランド
    const brand = (await getActiveBrand(sql))!;
    expect(brand.genre).toBe(deep[0].name);
    expect(brand.name).toBeTruthy();
    expect(brand.x_bio).toBeTruthy();
    expect(brand.products.length).toBeGreaterThan(0);

    // 記事：企画 → 情報源 → 執筆 → 品質検査 → 完成（公開待ち）
    const [a] = await listArticles(sql);
    expect(a.status).toBe("ready");
    expect(a.title).toBeTruthy();
    expect(a.body).toContain("## 参考にした情報");
    expect(a.sources.length).toBeGreaterThan(0);
    expect(a.quality_score).toBeGreaterThanOrEqual(QUALITY_PASS);
    expect(a.written_on).toBeTruthy();
    expect(a.cost_jpy).toBeGreaterThan(0);

    // X の投稿案：承認依頼になる（投稿は経営者）
    const posts = await sql<{ status: string; approval_id: string; text: string }[]>`select status, approval_id, text from media_posts`;
    expect(posts.length).toBe(2);
    const approvals = await sql<{ action_type: string; status: string }[]>`select action_type, status from approvals where id in ${sql(posts.map((p) => p.approval_id))}`;
    expect(approvals.every((x) => x.action_type === "sns_post" && x.status === "pending")).toBe(true);

    // 仕事の記録：部署・状態・開始・終了・費用
    const jobs = await sql<{ department: string; status: string; started_at: Date; finished_at: Date | null }[]>`select department, status, started_at, finished_at from media_jobs`;
    expect(jobs.length).toBe(r.steps.length);
    expect(jobs.every((j) => j.status === "done" && j.finished_at)).toBe(true);
    expect(new Set(jobs.map((j) => j.department))).toEqual(new Set(["市場調査部", "事業開発部", "編集制作部", "監査・品質管理部", "マーケティング部"]));
    // AIの費用はメディアの仕事として記録される
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from api_usage where purpose like 'media:%'`;
    expect(n).toBeGreaterThanOrEqual(10);

    // 記事ができたら、経営者に通知する（タップすると記事が開く）
    const notes = await sql<{ title: string; url: string }[]>`select title, url from notifications where dedupe_key = ${`article-ready:${a.id}`}`;
    expect(notes).toEqual([{ title: "記事ができました", url: `/media/articles/${a.id}` }]);

    // 同じ日にもう一度動かしても、二重には作らない
    const r2 = await runMediaEngine(sql, { now: at(MONDAY), maxSteps: 10 });
    expect(r2.steps).toEqual([]);
  });

  it("品質検査で直す点があれば1回だけ直して完成にする（直した版はもう一度検査しない）", async () => {
    const sql = await getDb();
    const brand = (await getActiveBrand(sql))!;
    const [row] = await sql<{ id: string }[]>`
      insert into media_articles (brand_id, theme, target, reader_pain, kind, price_jpy, status, title, body, research_notes)
      values (${brand.id}, '[mock:revise] 直しのテスト', '読者', '悩み', 'paid', 300, 'drafted', '直しのテスト', '# 直しのテスト', '調べた情報')
      returning id`;
    await runMediaEngine(sql, { now: at(MONDAY), maxSteps: 3 });
    const [a] = await sql<{ status: string; revisions: number; quality_score: number; body: string }[]>`select status, revisions, quality_score, body from media_articles where id = ${row.id}`;
    expect(a.status).toBe("ready");
    expect(a.revisions).toBe(1);
    expect(a.body).toContain("修正版");
    const checks = await sql`select 1 from media_jobs where ref_id = ${row.id} and kind = 'article.check'`;
    expect(checks).toHaveLength(1);
    // 直して完成したときも通知する（1回だけ）
    expect(await sql`select 1 from notifications where dedupe_key = ${`article-ready:${row.id}`}`).toHaveLength(1);
  });

  it("AIが失敗しても止まらない：記録にエラーを残し、次の実行で続きから進める", async () => {
    const sql = await getDb();
    const brand = (await getActiveBrand(sql))!;
    const [row] = await sql<{ id: string }[]>`
      insert into media_articles (brand_id, theme, status) values (${brand.id}, '失敗のテスト', 'planned') returning id`;
    mockHooks.failNext = 1;
    const r1 = await runMediaEngine(sql, { now: at(MONDAY), maxSteps: 1 });
    expect(r1.steps[0]).toMatchObject({ kind: "article.research", status: "failed" });
    const [j] = await sql<{ status: string; error: string }[]>`select status, error from media_jobs where ref_id = ${row.id} and status = 'failed'`;
    expect(j.error).toBeTruthy();
    const [a1] = await sql<{ failures: number; status: string }[]>`select failures, status from media_articles where id = ${row.id}`;
    expect(a1).toMatchObject({ failures: 1, status: "planned" });
    await runMediaEngine(sql, { now: at(MONDAY), maxSteps: 4 });
    const [a2] = await sql<{ status: string }[]>`select status from media_articles where id = ${row.id}`;
    expect(a2.status).toBe("ready");
  });
});

describe("経営者が公開・記録する（外部には何も送らない）", () => {
  it("note に公開したURLと、閲覧数・販売数・売上を記録すると、売上はお金の記録にも入る", async () => {
    const sql = await getDb();
    const [a] = await sql<{ id: string }[]>`select id from media_articles where status = 'ready' order by created_at limit 1`;
    await expect(markArticlePublished(sql, a.id, "https://example.com/x")).rejects.toThrow(/note/);
    await markArticlePublished(sql, a.id, "https://note.com/test_media/n/n0123456789ab");
    const before = await dashboardNumbers(sql);
    const r = await recordArticleMetrics(sql, a.id, { views: 120, likes: 8, sales: 2, revenueJpy: 600 });
    expect(r.addedIncome).toBe(600);
    const after = await dashboardNumbers(sql);
    expect(after.monthRevenue - before.monthRevenue).toBe(600);
    expect(after.articles.sales - before.articles.sales).toBe(2);
    // 売上は減らせない（作り話の数字を入れないように、増えた分だけを記録する）
    await expect(recordArticleMetrics(sql, a.id, { views: 120, likes: 8, sales: 2, revenueJpy: 100 })).rejects.toThrow(/減らせません/);
  });

  it("Xの投稿は、承認したものだけ「投稿済み」にできる", async () => {
    const sql = await getDb();
    const [p] = await sql<{ id: string; approval_id: string }[]>`select id, approval_id from media_posts order by created_at limit 1`;
    await expect(recordPost(sql, p.id, { url: "", impressions: 0, likes: 0, reposts: 0, clicks: 0 })).rejects.toThrow(/承認/);
    const [ap] = await sql<{ content_hash: string }[]>`select content_hash from approvals where id = ${p.approval_id}`;
    await decideApproval(sql, p.approval_id, "approve", "", ap.content_hash);
    await recordPost(sql, p.id, { url: "https://x.com/test/status/1", impressions: 300, likes: 5, reposts: 1, clicks: 4 });
    const [row] = await sql<{ status: string; impressions: number }[]>`select status, impressions from media_posts where id = ${p.id}`;
    expect(row).toEqual({ status: "posted", impressions: 300 });
  });
});

describe("フェーズ6・7：週の分析と月の経営会議", () => {
  it("翌週の月曜：経営分析部が分析して改善点を次の企画に渡し、市場調査も更新する", async () => {
    const sql = await getDb();
    const r = await runMediaEngine(sql, { now: at("2030-04-15"), maxSteps: 3 });
    expect(r.steps.map((s) => s.kind).slice(0, 2)).toEqual(["analysis.weekly", "research.weekly"]);
    const [rep] = await sql<{ content: string }[]>`select content from reports where report_type = 'media_weekly' order by created_at desc limit 1`;
    expect(rep.content).toContain("この1週間の数字");
    expect((await getSettings(sql)).media_insights).toBeTruthy();
    const [w] = await sql<{ status: string }[]>`select status from media_research_runs where kind = 'weekly' order by started_at desc limit 1`;
    expect(w.status).toBe("done");
  });

  it("翌月：CEOが経営会議をする。データが少ないうちは、AIが望んでもジャンルを変えない", async () => {
    const sql = await getDb();
    const r = await runMediaEngine(sql, { now: at("2030-05-01"), maxSteps: 1 });
    expect(r.steps[0]).toMatchObject({ kind: "ceo.monthly", status: "done" });
    const [rep] = await sql<{ content: string }[]>`select content from reports where report_type = 'media_monthly' order by created_at desc limit 1`;
    expect(rep.content).toContain("十分なデータがない");
    expect(await sql`select 1 from media_research_runs where kind = 'rerun'`).toHaveLength(0);
    // 同じ月に2回はしない
    const r2 = await runMediaEngine(sql, { now: at("2030-05-01"), maxSteps: 1 });
    expect(r2.steps.map((s) => s.kind)).not.toContain("ceo.monthly");
  });
});

describe("予算のルールと、二重実行の防止", () => {
  it("80%で安いモデル、95%で大事でない仕事を止め、100%で止まる", async () => {
    expect(tierFor(0.5)).toBe("normal");
    expect(tierFor(0.8)).toBe("saving");
    expect(tierFor(0.96)).toBe("critical");
    expect(tierFor(1)).toBe("stopped");
    expect(modelForTier("normal", "gpt-5-mini")).toBe("gpt-5-mini");
    expect(modelForTier("saving", "gpt-5-mini")).toBe(CHEAP_MODEL);
    const sql = await getDb();
    const s = await getSettings(sql);
    // 95%以上：新しい記事の企画と投稿案はしない（途中の記事がなければ、何もしない）
    await sql`update company_settings set last_media_posts_on = null`;
    const inProgress = await sql<{ id: string }[]>`select id from media_articles where status in ('planned','researched','drafted','checked')`;
    if (inProgress.length) {
      const next = await decideNext(sql, s, "critical", at("2030-05-02"));
      expect(next?.kind).toMatch(/^article\./); // 途中の記事は、95%を超えても仕上げる
      await sql`update media_articles set status = 'rejected' where id in ${sql(inProgress.map((a) => a.id))}`;
    }
    expect(await decideNext(sql, { ...s, last_media_posts_on: null }, "critical", at("2030-05-02"))).toBeNull();
    const normal = await decideNext(sql, { ...s, last_media_posts_on: null }, "normal", at("2030-05-02"));
    // ふつうの予算なら、95%で止めていた仕事（市場調査の更新・記事の企画など）をする
    expect(["research.weekly", "article.plan", "posts.create"]).toContain(normal?.kind);
  });

  it("上限に達していると、AIは動かない", async () => {
    const sql = await getDb();
    await sql`update budgets set monthly_limit_jpy = 0.01, emergency_stop_jpy = 0.01`;
    const r = await runMediaEngine(sql, { now: at("2030-05-02"), maxSteps: 3 });
    expect(r.steps).toEqual([]);
    expect(r.stoppedReason).toMatch(/上限/);
  });

  it("同時に2か所で動かない（鍵）・同じ仕事は二重に記録しない", async () => {
    const sql = await getDb();
    await sql`update company_settings set media_lease_until = now() + interval '1 minute', media_lease_owner = 'other'`;
    expect((await runMediaEngine(sql, { now: at("2030-05-02") })).status).toBe("busy");
    await sql`update company_settings set media_lease_until = null, media_lease_owner = ''`;
    const j1 = await startJob(sql, { kind: "test", dept: "ceo", dedupeKey: "test:dedupe" });
    const j2 = await startJob(sql, { kind: "test", dept: "ceo", dedupeKey: "test:dedupe" });
    expect(j1).not.toBeNull();
    expect(j2).toBeNull();
    await finishJob(sql, j1!, { status: "done" });
  });

  it("点数は満点の範囲におさめて合計する（AIが範囲外の点をつけても直す）", () => {
    const { scores, total } = normalizeScores({ reader_demand: 50, paid_demand: -3, differentiation: 15, topic_richness: 15, ai_fit: 10, acquisition: 10, cost: 10 });
    expect(scores.reader_demand).toBe(20);
    expect(scores.paid_demand).toBe(0);
    expect(total).toBe(80);
  });
});
