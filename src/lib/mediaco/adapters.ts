// 公開先（note・X）とのつなぎ方。
// いまはどちらも「経営者が自分で公開する」方法（manual）。
// - note：公式 API は法人向け note pro の提携先だけ（2026年10月時点・下書きまで）。そのため、貼り付けやすい形で記事を用意する
// - X：投稿用の API は有料。経営者の方針で、承認したあと自分で投稿する（「Xで開く」で文章入りの投稿画面が開く）
// 将来、公式 API が使えるようになったら、ここに publish() を持つつなぎ方を足して、選ぶものを変えるだけで済むようにしてある。
// 非公式なログイン操作・スクレイピング・画面の自動操作によるつなぎ方は作らない。

export type PublishMode = "manual" | "api";

export type PublishAdapter = {
  id: string;
  platform: "note" | "x";
  mode: PublishMode;
  label: string;
  /** 経営者が行うこと */
  ownerSteps: string[];
};

export const NOTE_MANUAL: PublishAdapter = {
  id: "note-manual",
  platform: "note",
  mode: "manual",
  label: "noteに貼り付けて公開（あなたが行う）",
  ownerSteps: [
    "記事の画面で「タイトル」「無料部分」「有料部分」「ハッシュタグ」を順にコピーして、note の新しい記事に貼る",
    "有料記事なら、note で値段と「ここから有料」の位置を設定する",
    "公開したら、記事の画面に note の URL を入れて「公開した」を押す",
  ],
};

export const X_MANUAL: PublishAdapter = {
  id: "x-manual",
  platform: "x",
  mode: "manual",
  label: "承認したあと「Xで開く」から投稿（あなたが行う）",
  ownerSteps: ["承認の画面で内容を確かめて承認する", "「Xで開く」を押して投稿する", "SNS の画面で「投稿した」を押す"],
};

/** いま使うつなぎ方（公式 API を使えるようになったら、ここを差し替える） */
export function noteAdapter(): PublishAdapter {
  return NOTE_MANUAL;
}
export function xAdapter(): PublishAdapter {
  return X_MANUAL;
}
