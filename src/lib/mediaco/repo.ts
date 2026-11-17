import "server-only";
import type { Db, Sql } from "@/lib/db";
import { begin } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { addLedgerEntry } from "@/lib/repo/ledger";
import { jstDateParts } from "@/lib/format";
import type { QualityOutput, Scores } from "./schemas";

// AI Media Company のデータの読み書き（画面とテストから使う）

export type Brand = {
  id: string;
  genre: string;
  name: string;
  concept: string;
  target_reader: string;
  themes: string[];
  tone: string;
  profile: string;
  icon_prompt: string;
  note_bio: string;
  x_bio: string;
  note_url: string;
  x_handle: string;
  products: { name: string; kind: "free" | "paid"; price_jpy: number; description: string }[];
  status: string;
  created_at: Date;
};

export type Genre = {
  id: string;
  run_id: string;
  name: string;
  demand_evidence: string;
  reader_pains: string;
  competitors: string;
  paid_demand: string;
  monetization: string;
  sustainability: string;
  ai_fit: string;
  scores: Scores;
  total: number;
  facts: string;
  guesses: string;
  sources: { url: string; title: string }[];
  researched_on: string;
  stage: "screened" | "deep";
  selected: boolean;
  reason: string;
};

export type ResearchRun = { id: string; kind: string; status: string; summary: string; selected_genre_id: string | null; started_at: Date; finished_at: Date | null };

export type Article = {
  id: string;
  brand_id: string;
  genre: string;
  theme: string;
  target: string;
  reader_pain: string;
  kind: "free" | "paid";
  price_jpy: number;
  profit_score: number;
  title: string;
  body: string;
  research_notes: string;
  sources: { url: string; title: string }[];
  quality: Partial<QualityOutput> & { revised?: boolean };
  quality_score: number | null;
  status: string;
  revisions: number;
  failures: number;
  last_error: string;
  published_url: string;
  published_at: Date | null;
  views: number;
  likes: number;
  sales: number;
  revenue_jpy: number;
  written_on: string | null;
  cost_jpy: number;
  created_at: Date;
};

export type Post = {
  id: string;
  article_id: string | null;
  kind: string;
  text: string;
  scheduled_for: Date | null;
  approval_id: string | null;
  approval_status: string | null;
  channel: string;
  status: string;
  posted_at: Date | null;
  post_url: string;
  impressions: number;
  likes: number;
  reposts: number;
  clicks: number;
  created_at: Date;
};

export type MediaJob = {
  id: string;
  kind: string;
  department: string;
  employee_id: string | null;
  employee_name: string | null;
  status: string;
  summary: string;
  error: string;
  cost_jpy: number;
  started_at: Date;
  finished_at: Date | null;
};

export const ARTICLE_STATUS_LABEL: Record<string, string> = {
  planned: "企画",
  researched: "情報源を調査済み",
  drafted: "執筆済み",
  checked: "修正待ち",
  ready: "完成（公開待ち）",
  published: "公開済み",
  rejected: "取りやめ",
  failed: "失敗",
};

export const POST_KIND_LABEL: Record<string, string> = {
  info: "有益な情報",
  summary: "記事の要約",
  problem: "問題提起",
  solution: "悩みの解決",
  knowhow: "ノウハウ",
  promo: "記事の紹介",
};

export const JOB_KIND_LABEL: Record<string, string> = {
  "research.screen": "複数ジャンルの市場調査",
  "research.deep": "ジャンルの深掘り調査",
  "research.select": "ジャンルの選定",
  "research.weekly": "市場調査の更新",
  "brand.design": "メディアブランドの設計",
  "article.plan": "記事の企画",
  "article.research": "情報源の調査",
  "article.write": "記事の執筆",
  "article.check": "品質検査",
  "article.revise": "指摘の修正",
  "posts.create": "Xの投稿案",
  "analysis.weekly": "週の成果分析",
  "ceo.monthly": "月の経営会議",
};

const num = (v: unknown) => Number(v) || 0;

export async function getActiveBrand(db: Db): Promise<Brand | null> {
  const [b] = await db<Brand[]>`select * from media_brands where status = 'active' order by created_at desc limit 1`;
  return b ?? null;
}

export async function listResearchRuns(db: Db, limit = 10): Promise<ResearchRun[]> {
  return db<ResearchRun[]>`select * from media_research_runs order by started_at desc limit ${limit}`;
}

export async function listGenres(db: Db, runId: string): Promise<Genre[]> {
  return db<Genre[]>`
    select *, to_char(researched_on, 'YYYY-MM-DD') as researched_on from media_genres where run_id = ${runId}
    order by (stage = 'deep') desc, total desc, created_at`;
}

export async function listArticles(db: Db, opts: { status?: string; limit?: number } = {}): Promise<Article[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const rows = opts.status
    ? await db<Article[]>`select *, to_char(written_on, 'YYYY-MM-DD') as written_on from media_articles where status = ${opts.status} order by created_at desc limit ${limit}`
    : await db<Article[]>`select *, to_char(written_on, 'YYYY-MM-DD') as written_on from media_articles order by created_at desc limit ${limit}`;
  return rows.map((r) => ({ ...r, cost_jpy: num(r.cost_jpy) }));
}

export async function getArticle(db: Db, id: string): Promise<Article | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db<Article[]>`select *, to_char(written_on, 'YYYY-MM-DD') as written_on from media_articles where id = ${id}`;
  return r ? { ...r, cost_jpy: num(r.cost_jpy) } : null;
}

export async function listPosts(db: Db, limit = 60): Promise<Post[]> {
  return db<Post[]>`
    select p.*, a.status as approval_status from media_posts p left join approvals a on a.id = p.approval_id
    order by p.created_at desc limit ${limit}`;
}

export async function listJobs(db: Db, limit = 30): Promise<MediaJob[]> {
  const rows = await db<MediaJob[]>`
    select j.*, e.name as employee_name from media_jobs j left join employees e on e.id = j.employee_id
    order by j.started_at desc limit ${limit}`;
  return rows.map((r) => ({ ...r, cost_jpy: num(r.cost_jpy) }));
}

/** 経営者が note に公開したことを記録する */
export async function markArticlePublished(sql: Sql, id: string, url: string) {
  const u = url.trim();
  if (!/^https:\/\/(note\.com|[a-z0-9-]+\.note\.jp)\//i.test(u)) throw new Error("note の記事のURL（https://note.com/… ）を入れてください");
  await begin(sql, async (tx) => {
    const [a] = await tx<{ status: string; title: string }[]>`select status, title from media_articles where id = ${id} for update`;
    if (!a) throw new Error("記事が見つかりません");
    if (a.status !== "ready" && a.status !== "published") throw new Error("完成した記事だけ、公開済みにできます");
    await tx`update media_articles set status = 'published', published_url = ${u.slice(0, 500)},
      published_at = coalesce(published_at, now()), updated_at = now() where id = ${id}`;
    await audit(tx, "owner", "media_article_published", "media_article", id, { url: u, title: a.title });
  });
}

/**
 * 経営者が note で見た数字（閲覧数・スキ数・販売数・売上）を記録する。
 * 売上が増えた分は、お金の記録（収益）にも自動で足す（財務の画面の数字と合うように）。売上を減らすときは、お金の記録の画面で取り消す。
 */
export async function recordArticleMetrics(sql: Sql, id: string, m: { views: number; likes: number; sales: number; revenueJpy: number }) {
  const v = (x: number, name: string) => {
    const n = Math.round(Number(x));
    if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new Error(`${name}は0以上の数字で入れてください`);
    return n;
  };
  const views = v(m.views, "閲覧数");
  const likes = v(m.likes, "スキ数");
  const sales = v(m.sales, "販売数");
  const revenue = v(m.revenueJpy, "売上");
  const [a] = await sql<{ revenue_jpy: number; title: string; status: string }[]>`select revenue_jpy, title, status from media_articles where id = ${id}`;
  if (!a) throw new Error("記事が見つかりません");
  if (a.status !== "published") throw new Error("公開済みの記事だけ、数字を記録できます");
  if (revenue < a.revenue_jpy) throw new Error("売上は減らせません（間違えたときは、お金の記録の画面で取り消してください）");
  const diff = revenue - a.revenue_jpy;
  if (diff > 0) {
    await addLedgerEntry(sql, {
      kind: "income",
      amountJpy: diff,
      occurredOn: jstDateParts(new Date()).date,
      category: "売上",
      description: `note記事の売上：${a.title}`.slice(0, 500),
    });
  }
  await sql`update media_articles set views = ${views}, likes = ${likes}, sales = ${sales}, revenue_jpy = ${revenue},
    metrics_updated_at = now(), updated_at = now() where id = ${id}`;
  await audit(sql, "owner", "media_article_metrics", "media_article", id, { views, likes, sales, revenue, added: diff });
  return { addedIncome: diff };
}

/** 経営者が X に投稿したこと・反応を記録する */
export async function recordPost(sql: Sql, id: string, r: { url: string; impressions: number; likes: number; reposts: number; clicks: number }) {
  const [p] = await sql<{ approval_status: string | null }[]>`
    select a.status as approval_status from media_posts p left join approvals a on a.id = p.approval_id where p.id = ${id}`;
  if (!p) throw new Error("投稿が見つかりません");
  if (p.approval_status !== "approved") throw new Error("承認した投稿だけ、投稿済みにできます");
  const url = r.url.trim();
  if (url && !/^https:\/\/(x|twitter)\.com\//i.test(url)) throw new Error("X の投稿のURL（https://x.com/… ）を入れてください");
  const n = (x: number) => Math.max(0, Math.min(100_000_000, Math.round(Number(x) || 0)));
  await sql`update media_posts set status = 'posted', posted_at = coalesce(posted_at, now()), post_url = ${url.slice(0, 500)},
    impressions = ${n(r.impressions)}, likes = ${n(r.likes)}, reposts = ${n(r.reposts)}, clicks = ${n(r.clicks)},
    metrics_updated_at = now() where id = ${id}`;
  await audit(sql, "owner", "media_post_recorded", "media_post", id, { url });
}

/** ブランドの note・X アカウントを記録する */
export async function updateBrandAccounts(sql: Sql, id: string, noteUrl: string, xHandle: string) {
  const nu = noteUrl.trim();
  const xh = xHandle.trim().replace(/^@/, "");
  if (nu && !/^https:\/\/note\.com\/[A-Za-z0-9_]+\/?$/.test(nu)) throw new Error("note のURLは https://note.com/（ID） の形で入れてください");
  if (xh && !/^[A-Za-z0-9_]{1,15}$/.test(xh)) throw new Error("X のIDは英数字と _ の15文字までです");
  await sql`update media_brands set note_url = ${nu}, x_handle = ${xh}, updated_at = now() where id = ${id}`;
  await audit(sql, "owner", "media_brand_accounts", "media_brand", id, { noteUrl: nu, xHandle: xh });
}

/** ダッシュボードの数字（すべてデータベースの集計。推定は入れない） */
export async function dashboardNumbers(db: Db) {
  const [money, api, articles, ai] = await Promise.all([
    db<{ m_income: number; m_expense: number; t_income: number }[]>`
      select
        coalesce(sum(amount_jpy) filter (where kind = 'income' and occurred_on >= date_trunc('month', now() at time zone 'Asia/Tokyo')), 0)::int as m_income,
        coalesce(sum(amount_jpy) filter (where kind = 'expense' and occurred_on >= date_trunc('month', now() at time zone 'Asia/Tokyo')), 0)::int as m_expense,
        coalesce(sum(amount_jpy) filter (where kind = 'income'), 0)::int as t_income
      from ledger_entries where voided_at is null`,
    db<{ month_jpy: number; unknown_jpy: number }[]>`
      select coalesce(sum(coalesce(cost_jpy, estimated_cost_jpy)), 0)::float8 as month_jpy,
        coalesce(sum(coalesce(cost_jpy, estimated_cost_jpy)) filter (where status in ('unknown','reserved')), 0)::float8 as unknown_jpy
      from api_usage where created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'`,
    db<{ total: number; published: number; ready: number; in_progress: number; sales: number }[]>`
      select count(*)::int as total,
        count(*) filter (where status = 'published')::int as published,
        count(*) filter (where status = 'ready')::int as ready,
        count(*) filter (where status in ('planned','researched','drafted','checked'))::int as in_progress,
        coalesce(sum(sales), 0)::int as sales
      from media_articles`,
    db<{ media_jpy: number }[]>`
      select coalesce(sum(coalesce(cost_jpy, estimated_cost_jpy)), 0)::float8 as media_jpy from api_usage
      where purpose like 'media:%' and created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'`,
  ]);
  const m = money[0];
  const apiMonth = api[0].month_jpy;
  const expense = m.m_expense + apiMonth;
  return {
    monthRevenue: m.m_income,
    monthLedgerExpense: m.m_expense,
    monthApi: apiMonth,
    monthApiEstimated: api[0].unknown_jpy,
    monthMediaApi: ai[0].media_jpy,
    monthExpense: expense,
    monthProfit: m.m_income - expense,
    totalRevenue: m.t_income,
    articles: articles[0],
  };
}
