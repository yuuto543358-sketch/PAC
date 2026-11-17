import type { BrandOutput, DeepOutput, MonthlyOutput, PostsOutput, QualityOutput, ScreenOutput, SourceOutput, ThemeOutput, WeeklyOutput, WriteOutput } from "./schemas";

// テスト用モックモード（AI_MOCK=1）のときだけ使う、決まった内容の返事（本物のAIの返事ではない）

const g = (name: string, base: number) => ({
  name,
  demand_evidence: `【テスト用モック】${name}の需要の根拠（テスト用の情報源）`,
  reader_pains: "時間がない・何から始めればいいか分からない",
  competitors: "大手メディアと個人ブログが多い",
  paid_demand: "具体的な手順の有料記事が売れている（推測）",
  monetization: "note の有料記事・マガジン",
  sustainability: "テーマが多く続けやすい",
  ai_fit: "調べてまとめる記事と相性が良い",
  facts: "テスト用の事実（情報源：example.com）",
  guesses: "有料記事の売れ行きは推測",
  scores: {
    reader_demand: Math.min(20, base),
    paid_demand: Math.min(20, base - 2),
    differentiation: Math.min(15, base - 6),
    topic_richness: Math.min(15, base - 5),
    ai_fit: Math.min(10, base - 10),
    acquisition: Math.min(10, base - 11),
    cost: 8,
  },
});

export function mockScreen(): ScreenOutput {
  return {
    summary: "【テスト用モック】8つのジャンルを調べました。",
    genres: [
      g("AI・テクノロジー", 18),
      g("副業・個人ビジネス", 17),
      g("節約・家計管理", 16),
      g("仕事・キャリア", 15),
      g("資格・学習", 14),
      g("ペット", 13),
      g("趣味・娯楽", 12),
      g("生活改善", 15),
    ],
  };
}

export function mockDeep(name: string, rank: number): DeepOutput {
  return { ...g(name, 19 - rank), recommendation: `【テスト用モック】${name}は${rank === 0 ? "いちばん有望です" : "有望です"}。` };
}

export function mockBrand(genre: string): BrandOutput {
  return {
    name: `${genre}ラボ（テスト）`,
    concept: "忙しい人が、明日から使える小さな工夫を届ける",
    target_reader: "仕事と生活で忙しい20〜40代",
    themes: ["はじめの一歩", "道具の比較", "失敗しない手順", "よくある質問"],
    tone: "やさしく、具体的に",
    profile: "【テスト用モック】プロフィール",
    icon_prompt: "やさしい色の丸いマーク",
    note_bio: "【テスト用モック】note の紹介文",
    x_bio: "【テスト用モック】X の紹介文",
    products: [
      { name: "無料のはじめてガイド", kind: "free", price_jpy: 0, description: "読者を集める" },
      { name: "手順まとめ（有料）", kind: "paid", price_jpy: 300, description: "具体的な問題を解決する" },
    ],
    reason: "需要と有料需要のバランスが良いため（テスト用）",
  };
}

export function mockThemes(n: number): ThemeOutput {
  return {
    themes: [0, 1, 2].map((i) => ({
      theme: `【テスト用モック】テーマ${n}-${i}：はじめての人がつまずく3つのこと（${crypto.randomUUID().slice(0, 8)}）`,
      target: "はじめたばかりの人",
      reader_pain: "何から手をつければいいか分からない",
      kind: i === 1 ? "paid" : "free",
      price_jpy: i === 1 ? 300 : 0,
      profit_score: 60 + i * 10,
      why: "検索されやすく、具体的な手順で役に立てる",
    })) as ThemeOutput["themes"],
  };
}

export function mockSources(): SourceOutput {
  return {
    notes: "【テスト用モック】記事に使う情報のまとめ",
    facts: [{ fact: "テスト用の事実", source_title: "テスト用の情報源", source_url: "https://example.com/source" }],
    gaps: "最新の数字は確認できなかった",
  };
}

export function mockWrite(theme: string, price: number, revised = false): WriteOutput {
  const title = theme.replace(/^【テスト用モック】/, "").slice(0, 40);
  return {
    title,
    price_jpy: price,
    summary: "はじめての人がつまずく所と、その対処を3つにまとめました。",
    body: `# ${title}\n値段: ${price > 0 ? `${price}円` : "無料"}\n\n## 無料で読める部分\n【テスト用モック${revised ? "・修正版" : ""}】最初につまずくのは、準備のしすぎです。\n\n## 有料部分\n手順1：まず小さく試す。\n手順2：結果を記録する。\n\n## 参考にした情報\n- テスト用の情報源 https://example.com/source\n\n## ハッシュタグ\n#はじめて #テスト #手順`,
  };
}

export function mockQuality(revise: boolean): QualityOutput {
  return {
    score: revise ? 62 : 82,
    verdict: revise ? "revise" : "pass",
    issues: revise ? ["手順に具体例を足す"] : [],
    fact_issues: [],
    copyright_risk: "low",
    hype: [],
    comment: revise ? "具体例が足りません（テスト用）" : "読者の役に立つ内容です（テスト用）",
  };
}

export function mockPosts(count: number, articleTitle: string | null): PostsOutput {
  const kinds = ["info", "problem", "knowhow", "solution", "summary"] as const;
  return {
    posts: Array.from({ length: count }, (_, i) => ({
      kind: articleTitle && i === 0 ? ("promo" as const) : kinds[i % kinds.length],
      text: `【テスト用モック】${["準備しすぎて動けない、あるある", "まず5分だけやってみる", "記録すると続く"][i % 3]}（${crypto.randomUUID().slice(0, 12)}）`,
      article_title: articleTitle && i === 0 ? articleTitle : null,
      hour: [8, 12, 20][i % 3],
    })),
  };
}

export function mockWeekly(): WeeklyOutput {
  return {
    summary: "【テスト用モック】今週のまとめ",
    good: ["手順を具体的に書いた記事"],
    bad: ["データがまだ少ない"],
    actions: ["具体例を多めに入れる"],
    insights: "具体的な手順と例を入れた記事を優先する（テスト用）",
  };
}

export function mockMonthly(): MonthlyOutput {
  return {
    summary: "【テスト用モック】今月の振り返り",
    departments: [{ department: "編集制作部", comment: "予定どおり記事を作れた" }],
    strategy: "有料記事を週1本に増やす（テスト用）",
    articles_per_day: 1,
    change_genre: true,
    change_reason: "テスト用（データが少ないので実際には変えない）",
  };
}
