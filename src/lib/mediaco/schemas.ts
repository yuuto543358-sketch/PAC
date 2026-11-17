import { z } from "zod";

// AI Media Company：各部署の AI の「返事の形」（決まった形で返してもらう）

/** 市場の評価（100点満点）の項目と満点 */
export const SCORE_ITEMS = [
  { key: "reader_demand", label: "読者需要", max: 20 },
  { key: "paid_demand", label: "有料需要", max: 20 },
  { key: "differentiation", label: "差別化の余地", max: 15 },
  { key: "topic_richness", label: "テーマの豊富さ", max: 15 },
  { key: "ai_fit", label: "AI制作との相性", max: 10 },
  { key: "acquisition", label: "集客のしやすさ", max: 10 },
  { key: "cost", label: "運営コスト", max: 10 },
] as const;
export type ScoreKey = (typeof SCORE_ITEMS)[number]["key"];
export type Scores = Record<ScoreKey, number>;

const scores = z
  .object({
    reader_demand: z.number().describe("読者需要（0〜20）"),
    paid_demand: z.number().describe("有料需要（0〜20）"),
    differentiation: z.number().describe("差別化の余地（0〜15）"),
    topic_richness: z.number().describe("続けられるテーマの豊富さ（0〜15）"),
    ai_fit: z.number().describe("AI制作との相性（0〜10）"),
    acquisition: z.number().describe("集客のしやすさ（0〜10）"),
    cost: z.number().describe("運営コストの低さ（0〜10。安いほど高い点）"),
  })
  .describe("評価の点数");

/** 点数を満点の範囲におさめて、合計を出す（AIが範囲外の点をつけても、プログラムで直す） */
export function normalizeScores(s: Partial<Record<ScoreKey, number>>): { scores: Scores; total: number } {
  const out = {} as Scores;
  let total = 0;
  for (const it of SCORE_ITEMS) {
    const v = Math.round(Math.min(it.max, Math.max(0, Number(s[it.key]) || 0)));
    out[it.key] = v;
    total += v;
  }
  return { scores: out, total };
}

const genreFields = {
  name: z.string().describe("ジャンル名（例：AI・テクノロジー）"),
  demand_evidence: z.string().describe("市場規模・需要の根拠（どこで確認したか）"),
  reader_pains: z.string().describe("読者の悩み"),
  competitors: z.string().describe("競合メディアの状況"),
  paid_demand: z.string().describe("有料コンテンツの需要"),
  monetization: z.string().describe("収益化の方法"),
  sustainability: z.string().describe("続けて運営できるか"),
  ai_fit: z.string().describe("AI制作との相性"),
  facts: z.string().describe("確認できた事実（情報源つき）"),
  guesses: z.string().describe("推測（確認できていないこと）"),
  scores,
};

export const ScreenSchema = z.object({
  summary: z.string().describe("調査のまとめ（200字以内）"),
  genres: z.array(z.object(genreFields)).describe("調べたジャンル（6〜9個）"),
});
export type ScreenOutput = z.infer<typeof ScreenSchema>;

export const DeepSchema = z.object({
  ...genreFields,
  recommendation: z.string().describe("このジャンルを選ぶべきか、その理由（150字以内）"),
});
export type DeepOutput = z.infer<typeof DeepSchema>;

export const BrandSchema = z.object({
  name: z.string().describe("メディア名"),
  concept: z.string().describe("ブランドのコンセプト"),
  target_reader: z.string().describe("ターゲット読者（具体的に）"),
  themes: z.array(z.string()).describe("発信テーマ（4〜8個）"),
  tone: z.string().describe("ブランドの口調"),
  profile: z.string().describe("プロフィール文"),
  icon_prompt: z.string().describe("アイコンの制作指示（どんな絵にするか）"),
  note_bio: z.string().describe("noteアカウントの紹介文"),
  x_bio: z.string().describe("Xアカウントの紹介文（160字以内）"),
  products: z
    .array(z.object({ name: z.string(), kind: z.enum(["free", "paid"]), price_jpy: z.number(), description: z.string() }))
    .describe("販売商品・記事の種類（無料記事は読者を集める、有料記事は具体的な問題を解決する）"),
  reason: z.string().describe("このジャンルとブランドにした理由（150字以内）"),
});
export type BrandOutput = z.infer<typeof BrandSchema>;

export const ThemeSchema = z.object({
  themes: z
    .array(
      z.object({
        theme: z.string().describe("記事のテーマ"),
        target: z.string().describe("想定読者"),
        reader_pain: z.string().describe("想定読者の悩み"),
        kind: z.enum(["free", "paid"]).describe("無料記事（集客）か有料記事（問題解決）か"),
        price_jpy: z.number().describe("販売価格案（無料なら0）"),
        profit_score: z.number().describe("事業開発部による収益性の評価（0〜100）"),
        why: z.string().describe("このテーマを選ぶ理由（読者の役に立つ点・収益性）"),
      }),
    )
    .describe("記事テーマの候補（3つ）"),
});
export type ThemeOutput = z.infer<typeof ThemeSchema>;

export const SourceSchema = z.object({
  notes: z.string().describe("記事に使う情報のまとめ（事実と推測を分ける）"),
  facts: z
    .array(z.object({ fact: z.string(), source_title: z.string(), source_url: z.string() }))
    .describe("確認できた事実と、その情報源（URL）"),
  gaps: z.string().describe("確認できなかったこと（記事では断定しない）"),
});
export type SourceOutput = z.infer<typeof SourceSchema>;

export const WriteSchema = z.object({
  title: z.string().describe("記事のタイトル"),
  body: z
    .string()
    .describe(
      "note に貼る記事の本文。「# タイトル」→「値段: ○○円（無料なら 値段: 無料）」→「## 無料で読める部分」→「## 有料部分」（無料記事なら本文の続き）→「## 参考にした情報」→「## ハッシュタグ」の順",
    ),
  price_jpy: z.number().describe("販売価格（無料なら0）"),
  summary: z.string().describe("記事の要約（100字以内。Xの紹介に使う）"),
});
export type WriteOutput = z.infer<typeof WriteSchema>;

export const QualitySchema = z.object({
  score: z.number().describe("品質の点数（0〜100）"),
  verdict: z.enum(["pass", "revise", "reject"]).describe("合格 / 修正が必要 / 公開してはいけない"),
  issues: z.array(z.string()).describe("直すべき点（大事なものだけ、最大5つ）"),
  fact_issues: z.array(z.string()).describe("事実確認・引用元の問題"),
  copyright_risk: z.enum(["low", "medium", "high"]).describe("著作権・転載のリスク"),
  hype: z.array(z.string()).describe("誇大な表現・規約に触れそうな表現"),
  comment: z.string().describe("ひとこと（100字以内）"),
});
export type QualityOutput = z.infer<typeof QualitySchema>;

export const PostsSchema = z.object({
  posts: z
    .array(
      z.object({
        kind: z.enum(["info", "summary", "problem", "solution", "knowhow", "promo"]).describe("投稿の種類"),
        text: z.string().describe("投稿の文章（日本語130文字以内。リンクは入れない。記事の紹介はアプリがURLを足す）"),
        article_title: z.string().nullable().describe("紹介する記事のタイトル（記事の紹介・要約のとき。なければ null）"),
        hour: z.number().describe("投稿におすすめの時刻（日本時間・0〜23時）"),
      }),
    )
    .describe("X の投稿案"),
});
export type PostsOutput = z.infer<typeof PostsSchema>;

export const WeeklySchema = z.object({
  summary: z.string().describe("今週のまとめ（300字以内。数字は下の集計だけを使う）"),
  good: z.array(z.string()).describe("成果が良かったテーマ・投稿と、その理由"),
  bad: z.array(z.string()).describe("成果が悪かったものと、考えられる原因"),
  actions: z.array(z.string()).describe("次の週にやる改善（具体的に、最大5つ）"),
  insights: z.string().describe("次の記事づくりに伝えること（200字以内）"),
});
export type WeeklyOutput = z.infer<typeof WeeklySchema>;

export const MonthlySchema = z.object({
  summary: z.string().describe("今月の振り返り（400字以内。数字は下の集計だけを使う）"),
  departments: z.array(z.object({ department: z.string(), comment: z.string() })).describe("各部署の成果の評価"),
  strategy: z.string().describe("翌月の戦略（具体的に）"),
  articles_per_day: z.number().describe("翌月の1日あたりの記事数の案（0〜3）"),
  change_genre: z.boolean().describe("ジャンルを変えるべきか（十分なデータがない段階では false）"),
  change_reason: z.string().describe("ジャンルを変える・変えない理由"),
});
export type MonthlyOutput = z.infer<typeof MonthlySchema>;
