// 売る場所（販売チャネル）の参考情報と、経営者が決めた「売る場所の選び方」。
// 手数料は 2026年11月に調べた目安です（公式・ニュース・解説記事より）。変わることがあるので、
// チームには「Web検索で公式ページを確認する」よう指示しています。変わったら、ここを更新してください。

/** 経営者の方針（2026年11月の指示より） */
export const SALES_CHANNEL_POLICY = [
  "無料で始められること（月額料金・初期費用がかからない）",
  "手続きができるだけ簡単なこと（登録・出品がすぐできる。書類や審査が少ない）",
  "収益性が高いこと（1件売れたときの手取りが多い。売れやすい＝お客さんが集まっている場所も大事）",
  "これらを総合的に判断して、いちばん良い場所を1つ選ぶ",
] as const;

export type SalesChannel = {
  id: string;
  name: string;
  /** 向いている商品 */
  bestFor: string;
  /** 手数料の説明（目安） */
  feeText: string;
  /** 1件あたりの手数料（円）。price は売る値段 */
  fee: (price: number) => number;
  /** 手続きの簡単さ */
  ease: string;
  /** お客さんの集まりやすさ */
  audience: string;
  /** 注意点 */
  caution: string;
};

export const SALES_CHANNELS_CHECKED_ON = "2026年11月";

export const SALES_CHANNELS: SalesChannel[] = [
  {
    id: "note",
    name: "note",
    bestFor: "文章・ノウハウ・読みもの（有料記事）",
    feeText: "決済手数料（カード5%など、お客さんの払い方で変わる）＋残りの10%",
    fee: (p) => Math.round(p * 0.05 + p * 0.95 * 0.1),
    ease: "とても簡単（登録して記事を書き、値段を付けるだけ）",
    audience: "多い（読む人がたくさんいる）",
    caution: "お客さんが携帯料金払いを選ぶと手数料が高くなる（15%）。振込手数料が別にかかる",
  },
  {
    id: "booth",
    name: "BOOTH",
    bestFor: "ダウンロードで渡すファイル（テンプレート・素材・電子書籍など）や手作り品",
    feeText: "5.6% ＋ 45円",
    fee: (p) => Math.round(p * 0.056 + 45),
    ease: "簡単（pixiv のアカウントでお店を開ける）",
    audience: "ふつう（創作物が好きな人が多い）",
    caution: "安い商品（数百円）だと、45円の固定分の割合が大きくなる",
  },
  {
    id: "coconala",
    name: "ココナラ",
    bestFor: "人が作業するサービス（翻訳・文章作成・デザイン・相談など）",
    feeText: "22%",
    fee: (p) => Math.round(p * 0.22),
    ease: "とても簡単（登録してサービスを出品するだけ）",
    audience: "多い（頼みたい人が探しに来る）",
    caution: "手数料が高い。そのぶん、お客さんを自分で集めなくてよい",
  },
  {
    id: "mercari_shops",
    name: "メルカリShops",
    bestFor: "物（手作り品・仕入れた品など）",
    feeText: "10%（ほかに振込手数料）",
    fee: (p) => Math.round(p * 0.1),
    ease: "簡単（スマホだけで開ける）",
    audience: "とても多い",
    caution: "送料・梱包の手間がかかる",
  },
  {
    id: "base",
    name: "BASE（無料プラン）",
    bestFor: "自分のお店を持ちたいとき（リピーターや、自分でお客さんを呼べるとき）",
    feeText: "3.6% ＋ 40円 ＋ サービス利用料3%",
    fee: (p) => Math.round(p * 0.036 + 40 + p * 0.03),
    ease: "ふつう（お店を作る作業が少し必要）",
    audience: "少ない（お客さんは自分で集める）",
    caution: "お店の「特定商取引法に基づく表記」（名前・連絡先など）が必要",
  },
  {
    id: "stripe_links",
    name: "Stripe の支払いリンク",
    bestFor: "すでにお客さんがいて、リンクを送って払ってもらうとき",
    feeText: "カード 3.6%",
    fee: (p) => Math.round(p * 0.036),
    ease: "むずかしめ（本人確認や、売る人の情報の表示が必要）",
    audience: "なし（お客さんは自分で集める）",
    caution: "いちばん手数料が安いが、集客と表示の準備は自分で行う",
  },
];

export function netPerSale(channel: SalesChannel, price: number) {
  const fee = Math.min(price, Math.max(0, channel.fee(price)));
  return { fee, net: price - fee };
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/** AI社員に渡す「売る場所の選び方」（方針＋参考情報＋手取りの目安） */
export function buildSalesChannelGuide(opts: { webSearch?: boolean } = {}): string {
  const rows = SALES_CHANNELS.map((c) => {
    const n1 = netPerSale(c, 1000);
    const n3 = netPerSale(c, 3000);
    return `- ${c.name}：向いている商品＝${c.bestFor}／手数料＝${c.feeText}（1,000円なら手取り約${yen(n1.net)}、3,000円なら約${yen(n3.net)}）／手続き＝${c.ease}／お客さん＝${c.audience}／注意＝${c.caution}`;
  }).join("\n");
  return `【売る場所の選び方（経営者の方針）】
${SALES_CHANNEL_POLICY.map((p) => `- ${p}`).join("\n")}
【売る場所の参考情報（${SALES_CHANNELS_CHECKED_ON}時点の目安。変わっていることがあるので「要確認」）】
${rows}
- 手取りは振込手数料・送料を引く前の目安。
- 選ぶときは、上の候補にとらわれず、商品に合う場所を考えてよい（ただし方針に合うこと）。
- 経営者の社内ルールや指示に売る場所の決まりがあれば、そちらを優先する。
${opts.webSearch ? "- Web検索ができるときは、選んだ場所の手数料を公式ページで確かめ、違っていたら新しい数字を使う。" : "- 手数料は未確認の目安として扱い、成果物には「要確認」と書く。"}`;
}

/** 販売の準備・商品づくりの業務かどうか */
export function isSalesRelated(task: { title: string; description: string; business_project_id?: string | null }): boolean {
  return Boolean(task.business_project_id) || /販売|売る|売り|出品|値段|価格|収益|副業/.test(`${task.title}${task.description}`);
}
