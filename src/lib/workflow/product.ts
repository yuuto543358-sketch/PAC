import type { DeliverableFormat } from "@/lib/constants";

// 経営者が業務で頼んだ「成果品」（note記事・動画など）を、業務の題名と内容から見分けます。
// 見分けられたときは、チームの最終成果物をその成果品そのものにします（調査のまとめだけで終わらせない）。
// AIの判断に任せず、プログラムで決めます。

export type RequestedProduct = {
  format: DeliverableFormat;
  /** 経営者に見せる名前 */
  label: string;
  /** 成果物の書き方（見出しの順番など） */
  guide: string;
};

const PRODUCTS: { test: RegExp; product: RequestedProduct }[] = [
  {
    test: /動画|ユーチューブ|youtube|ショート|tiktok|ティックトック|リール|vlog|配信/i,
    product: {
      format: "video_script",
      label: "動画（台本と制作キット）",
      guide: [
        "形式は video_script にして、次の見出しをこの順で書く（経営者がそのまま撮影・編集できる完成品にする）：",
        "「# 動画のタイトル」→「## 動画の長さと向き」（例：60秒・縦）→「## 最初の3秒（つかみ）」",
        "→「## 台本」（シーンごとに番号をふり、秒数・画面に映すもの・話す言葉（ナレーション）・画面の文字（テロップ）を書く。表でもよい）",
        "→「## BGM・効果音のおすすめ」→「## サムネイルの文字」→「## 投稿するときの説明文」→「## ハッシュタグ」",
        "- この台本をもとに、アプリが場面ごとの絵とナレーションの声を作り、1本の動画につなげる。だから場面は3〜6個にして、場面ごとに「画面に映すもの（絵の説明）」と「話す言葉」をはっきり書く。",
        "- 実在の人の顔・有名なキャラクター・会社のロゴは絵にしない（権利の問題があるため）。",
      ].join("\n"),
    },
  },
  {
    test: /note|ノート記事|記事|ブログ/i,
    product: {
      format: "note_article",
      label: "note記事",
      guide: [
        "形式は note_article にして、次の見出しの順に書く（経営者がそのまま貼り付けられる完成品にする）：",
        "「# 記事のタイトル」→「値段: ○○円」（無料なら「値段: 無料」）→「## 無料で読める部分」→「## 有料部分」（無料記事なら本文の続き）→「## ハッシュタグ」（#から始まる言葉を3〜5個）",
        "- 記事の本文は、構成案や要約ではなく、読者がそのまま読める全文を書く。",
      ].join("\n"),
    },
  },
  {
    test: /出品|商品ページ|販売ページ|booth|ブース|ストアカ|ココナラ/i,
    product: {
      format: "listing_package",
      label: "出品パッケージ",
      guide: "形式は listing_package にして、商品名・説明文・値段・商品の中身など、売る場所にそのまま貼れる見出しに分けて書く。",
    },
  },
  {
    test: /スライド|プレゼン|資料のページ/i,
    product: {
      format: "slide_outline",
      label: "スライド",
      guide: "形式は slide_outline にして、1枚ずつ「## 1枚目：見出し」の形で、その画面に載せる文章をすべて書く。",
    },
  },
  {
    test: /投稿文|ツイート|ポスト|sns投稿|インスタ投稿/i,
    product: {
      format: "sns_post",
      label: "SNS投稿文",
      guide: "形式は sns_post にして、そのまま投稿できる文章を書く。",
    },
  },
  {
    test: /メール文|メールの文面|案内文|お礼状|手紙/i,
    product: {
      format: "email_draft",
      label: "メール文面",
      guide: "形式は email_draft にして、件名と、そのまま送れる本文の全文を書く。",
    },
  },
];

/** 文章から、頼まれた成果品を見分ける。見分けられなければ null */
export function detectRequestedProduct(task: { title: string; description?: string | null }): RequestedProduct | null {
  const text = `${task.title}\n${task.description ?? ""}`;
  for (const p of PRODUCTS) if (p.test.test(text)) return p.product;
  return null;
}

/**
 * この業務で作るべき成果品。
 * 経営者が頼んだ業務が対象です。
 * あとから経営者がグループチャットで「動画にして」などと指示した場合は、新しい指示を優先します。
 */
/** 形式から成果品を引く */
export function productByFormat(format: string | null | undefined): RequestedProduct | null {
  return PRODUCTS.find((p) => p.product.format === format)?.product ?? null;
}

export function requestedProductFor(
  task: {
    title: string;
    description?: string | null;
    source?: string | null;
    product_format?: string | null;
  },
  ownerMessages: string[] = [],
): RequestedProduct | null {
  // 「動画にして」「記事を書いて」のように、作るものをはっきり頼んだ指示だけを見る
  for (const m of [...ownerMessages].reverse()) {
    if (!/作って|作成|にして|書いて|仕上げて|まで/.test(m)) continue;
    const p = detectRequestedProduct({ title: m });
    if (p) return p;
  }
  // シリーズの回など、アプリが作るものを決めた業務
  const fixed = productByFormat(task.product_format);
  if (fixed) return fixed;
  if (task.source && task.source !== "user") return null;
  return detectRequestedProduct(task);
}

/** 成果物が、頼まれた成果品の形式になっているか */
export function matchesRequestedProduct(product: RequestedProduct | null, format: string | null | undefined): boolean {
  return !product || product.format === format;
}
