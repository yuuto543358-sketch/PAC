// iPhone の画面サイズで主要な操作を一通り行う確認用スクリプト。
// 使い方: サーバーを AI_MOCK=1 で起動してから
//   BASE_URL=http://localhost:3100 APP_PASSWORD=... node tests/e2e/flow.mjs
// （Playwright が必要です）
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PASSWORD = process.env.APP_PASSWORD ?? "test-password-123";
const SHOTS = process.env.SHOTS_DIR ?? "tests/e2e/screenshots";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 15"], locale: "ja-JP", timezoneId: "Asia/Tokyo" });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("dialog", (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });

// --- ログイン ---
await page.goto(`${BASE}/`);
check("未ログインはログイン画面へ", page.url().includes("/login"));
await page.fill("#password", "wrong-password");
await page.click("button[type=submit]");
await page.getByText("パスワードが違います").waitFor();
check("間違ったパスワードは拒否", true);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForURL(`${BASE}/`);
await page.getByText("今月の売上").waitFor();
check("ログインしてホーム表示（メディア事業のダッシュボード）", true);
await shot("01-home");

// --- 社員 ---
await page.click("nav >> text=社員");
await page.getByText("7名が在籍しています").waitFor();
check("社員一覧に7名（ライフ担当を含む）", (await page.locator("main li").count()) === 7);
await shot("02-employees");
await page.getByText("天城 翔").click();
await page.getByText("直接指示を出す").waitFor();
await shot("03-employee-detail");

// 評価（「評価」タブ）
await page.getByRole("tab", { name: "評価" }).click();
await page.getByRole("radio", { name: "4点" }).click();
await page.fill("textarea[name=comment]", "丁寧な対応でした");
await page.getByRole("button", { name: "評価を記録する" }).click();
await page.getByText("評価を記録しました").waitFor();
check("社員の評価を記録", true);

// --- チャット ---
await page.getByRole("link", { name: /チャットする/ }).click();
await page.waitForURL(/\/chat/);
await page.fill("textarea[name=message]", "競合サービスを調べる業務をお願いします。まとめたら取引先にメールで送信してください。");
await page.click("button[aria-label=送信]");
await page.getByText("業務を登録しました").waitFor({ timeout: 20000 });
check("チャットから業務が登録される", true);
await page.getByText("承認依頼を提出しました").waitFor();
check("チャットから承認依頼が提出される", true);
await page.waitForURL(/\?c=/, { timeout: 5000 }).catch(() => {});
check("会話URLに会話IDが付く", /\?c=/.test(page.url()));
await shot("04-chat");

// 同じ依頼をもう一度 → 重複防止
await page.fill("textarea[name=message]", "競合サービスを調べる業務をお願いします。まとめたら取引先にメモを共有");
await page.click("button[aria-label=送信]");
await page.getByText("すでにあるため、新しく登録しませんでした").waitFor({ timeout: 20000 });
check("重複した業務は登録されない", true);

// チャット画面は全画面（下のメニューを隠す）
check("チャット画面では下のメニューを隠す", (await page.locator("nav[aria-label=メインメニュー]").count()) === 0);

// --- チーム（Phase 2）：社長が登録した業務をチームが自動で進める ---
await page.getByText("チームを編成して自動で進めます").first().click();
await page.waitForURL(/\/room/);
check("社長のチャットからチームのグループチャットへ移動できる", true);
await page.getByText("成果物の確認をお願いします").waitFor({ timeout: 90000 });
check("チームが自動で 計画→議論→作成→監査→報告 まで進む", true);
for (const kind of ["計画", "調査メモ", "意見", "監査"]) {
  check(`グループチャットに「${kind}」の発言`, (await page.locator("main span", { hasText: new RegExp(`^${kind}$`) }).count()) > 0);
}
check("グループチャット画面では下のメニューを隠す", (await page.locator("nav[aria-label=メインメニュー]").count()) === 0);
await shot("15-room");

// 経営者の指示 → チームが修正版を作り、もう一度確認待ちになる
await page.fill("textarea[name=message]", "結論を最初に書いてください");
await page.click("button[aria-label=指示を送る]");
await page.getByText("指示を送り、チームの作業を再開しました").waitFor({ timeout: 20000 });
check("グループチャットで指示を送ると作業を再開する", true);
await page.waitForFunction(() => document.body.innerText.includes("第2版"), null, { timeout: 90000 });
await page.getByText("成果物の確認をお願いします").waitFor({ timeout: 90000 });
check("指示を反映した修正版（第2版）が作られる", true);

// 成果物の画面（出力：コピー・ファイル保存）
await page.locator("a[href*='/deliverables/2']").first().click();
await page.getByRole("heading", { name: "本文" }).waitFor().catch(() => {});
await page.getByText("出力形式：").waitFor();
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "ファイルで保存" }).click()]);
check("成果物をファイルで保存できる", Boolean(download), download.suggestedFilename());
check("成果物の版の履歴が表示される", (await page.getByText("版の履歴").count()) > 0);
await shot("16-deliverable");

// --- 承認 ---
await page.goto(`${BASE}/`);
check("ホームの「あなたの番」に承認待ちが件数つきで出る", /承認待ち/.test(await page.locator("section[aria-label=あなたの番]").innerText()));
const badge = await page.locator("nav[aria-label=メインメニュー] a[href='/approvals'] span").last().textContent();
check("承認タブに未確認件数バッジ", Number(badge?.trim()) >= 2, `badge=${badge}`);
await page.click("nav >> text=承認");
await page.getByText(/未確認 \d+件/).waitFor();
await shot("05-approvals");
await page.locator("main ul li a", { hasText: "送信の承認依頼" }).first().click();
await page.getByText("送る内容（AIが書いた文面）").waitFor();
for (const label of ["実行先", "担当社員", "発生する費用", "実行する理由", "想定されるリスク", "承認後に何が起こるか"]) {
  check(`承認画面に「${label}」`, (await page.getByText(label, { exact: true }).count()) > 0);
}
await shot("06-approval-detail");

// 修正して再提出
await page.getByText("内容を修正して再提出").click();
await page.fill("textarea[name=content]", "修正後の送信本文です。");
await page.getByRole("button", { name: "修正して再提出する" }).click();
await page.getByText("これは修正版です").waitFor();
check("修正して再提出すると新しい承認依頼になる", true);

// 承認
await page.getByRole("button", { name: "承認する" }).click();
await page.getByRole("status").filter({ hasText: "承認しました。下のボタンから、ご自身で送ってください" }).waitFor();
await page.getByText("このメール（メッセージ）は、あなたが自分で送ります。").waitFor();
check("メールは自分で送る（アプリは送らない）と表示", true);
const mailLink = page.getByRole("link", { name: "メールアプリで開く" });
const href = (await mailLink.getAttribute("href")) ?? "";
check("「メールアプリで開く」に宛先と本文が入る", href.startsWith("mailto:example%40example.com?subject=") && href.includes(encodeURIComponent("修正後の送信本文です。")), href.slice(0, 80));
check("「本文をコピー」ボタンがある", (await page.getByRole("button", { name: "本文をコピー" }).count()) === 1);
await shot("07-approved");

// 成果物の最終確認（承認 → 業務完了）
await page.goto(`${BASE}/approvals`);
await page.locator("main ul li a", { hasText: "成果物の確認" }).first().click();
await page.getByText("確認する成果物").waitFor();
await shot("17-accept-deliverable");
await page.getByRole("button", { name: "承認する" }).click();
await page.getByText("承認しました。業務完了です").waitFor();
check("成果物を承認すると業務が完了する", true);

// --- 業務 ---
await page.goto(`${BASE}/tasks`); // 「業務」はタブからメニューへ移動
await page.getByRole("heading", { name: "業務管理" }).waitFor();
await shot("08-tasks");
await page.goto(`${BASE}/tasks?view=closed`);
await page.locator("main ul li a").first().click();
await page.getByText("進行履歴").waitFor();
check("完了した業務にチームと成果物が表示される", (await page.getByText("グループチャットを開く").count()) > 0 && (await page.getByText("第2版：").count()) > 0);
await shot("09-task-detail");
const statusSel = page.locator("select[name=to]");

// 新規登録
await page.goto(`${BASE}/tasks/new`);
await page.fill("input[name=title]", "週次の振り返りメモを作る");
await page.selectOption("select[name=assignee]", "secretary");
await page.uncheck("input[name=team]");
await page.getByRole("button", { name: "業務を登録する" }).click();
await page.waitForURL(/\/tasks\/[0-9a-f-]{36}/);
check("業務を手動登録", true);
await statusSel.selectOption("researching");
await page.getByRole("button", { name: "ステータスを変更" }).click();
await page.getByText("発見 → 調査中").waitFor();
check("ステータス変更が履歴に残る", true);
await page.fill("textarea[name=deliverable]", "成果物のテスト");
await page.getByRole("button", { name: "成果物を保存" }).click();
await page.getByText("成果物を保存しました").waitFor();
check("成果物を保存", true);

// 重複登録
await page.goto(`${BASE}/tasks/new`);
await page.fill("input[name=title]", "週次の振り返りメモを作る");
await page.getByRole("button", { name: "業務を登録する" }).click();
await page.getByText("重複のため登録しませんでした").waitFor();
check("手動登録でも重複を検出", true);

// 成果品を頼むと、調査で終わらずに成果品そのもの（ここでは動画の台本と制作キット）ができる
await page.goto(`${BASE}/tasks/new`);
await page.fill("input[name=title]", "朝のルーティン紹介のショート動画を作る");
await page.getByRole("button", { name: "業務を登録する" }).click();
await page.waitForURL(/\/tasks\/[0-9a-f-]{36}\/room/);
const videoTaskUrl = page.url().replace(/\/room.*$/, "");
// 短時間に呼び出しが集中すると、安全装置でチームが一時停止する。そのときは少し待って画面を開き直す（開くと続きから進む）
for (let i = 0; i < 8; i++) {
  const done = await page.getByText("成果物の確認をお願いします").waitFor({ timeout: 20000 }).then(() => true, () => false);
  if (done) break;
  await page.waitForTimeout(10_000);
  await page.reload();
}
await page.reload();
await page.getByText("成果物の確認をお願いします").waitFor({ timeout: 30000 });
await page.goto(`${videoTaskUrl}/deliverables/1`);
await page.getByText("出力形式：").waitFor();
check("動画を頼むと、成果物が「動画（台本と制作キット）」になる", (await page.getByText("出力形式：動画（台本と制作キット）").count()) === 1);
check("動画の台本は見出しごとにコピーできる",
  (await page.getByText("投稿するときに使う（見出しごとにコピー）").count()) === 1 &&
  (await page.getByRole("button", { name: "台本" }).count()) === 1 &&
  (await page.getByRole("button", { name: "サムネイルの文字" }).count()) === 1);
// 動画の実物：AIが作った場面の絵と声を、端末の中で1本の動画につなげる
check("場面の絵と声ができていて、動画のプレビューが出る", (await page.locator("canvas[aria-label=動画のプレビュー]").count()) === 1);
check("材料（場面の絵・ナレーションの声）を1つずつ保存できる", (await page.getByText("材料を1つずつ保存する").count()) === 1);
await page.getByText("材料を1つずつ保存する").click();
const firstImage = await page.request.get(new URL(await page.getByRole("link", { name: "場面1の絵" }).getAttribute("href"), BASE).toString());
check("場面の絵はログインした人だけが取り出せる（保存用）", firstImage.status() === 200 && (firstImage.headers()["content-disposition"] ?? "").startsWith("attachment"));
const anon = await (await browser.newContext()).request.get(new URL(await page.getByRole("link", { name: "場面1の絵" }).getAttribute("href"), BASE).toString(), { maxRedirects: 0 });
check("ログインしていないと、絵は見られない", anon.status() !== 200, String(anon.status()));
await page.getByRole("button", { name: "動画を書き出す" }).click();
await page.getByText("できた動画").waitFor({ timeout: 60000 });
const videoOk = await page.locator("video[aria-label=できた動画]").evaluate(async (v) => {
  if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
  return { ok: v.src.startsWith("blob:"), w: v.videoWidth, h: v.videoHeight };
});
check("「動画を書き出す」で縦長の動画ができる", videoOk.ok && videoOk.h > videoOk.w, JSON.stringify(videoOk));
check("できた動画を保存するボタンがある", (await page.getByRole("button", { name: "保存する（写真アプリなど）" }).count()) === 1);
await shot("16b-video-deliverable");

// 承認すると、そこで終わらず「シリーズ」として次の回を作り続ける
await page.goto(`${BASE}/approvals`);
await page.locator("main ul li a", { hasText: "朝のルーティン紹介のショート動画" }).first().click();
await page.getByText("台本", { exact: true }).first().waitFor();
check("動画の承認画面に「次の回を自動で作り始めます」と書いてある", (await page.getByText(/次の回を自動で作り始めます/).count()) > 0);
check("動画の承認画面で、その場で動画を再生・書き出しできる",
  (await page.locator("canvas[aria-label=動画のプレビュー]").count()) === 1 && (await page.getByRole("button", { name: "動画を書き出す" }).count()) === 1);
await page.getByRole("button", { name: "承認する" }).click();
await page.getByText("承認しました。この画面の「動画を書き出す」で、動画ファイルを保存できます").waitFor();
check("承認したあとも、同じ画面で動画を書き出せる", (await page.getByRole("button", { name: "動画を書き出す" }).count()) === 1);
await page.goto(`${BASE}/series`);
check("シリーズ画面に、承認した動画のシリーズが出る（3日ごと）",
  (await page.getByText("朝のルーティン紹介のショート動画を作る", { exact: true }).count()) === 1 && (await page.getByText(/3日ごとに作る・次の回は/).count()) === 1);
await page.getByRole("button", { name: "次の回を今すぐ作る" }).click();
await page.getByRole("status").filter({ hasText: "第2回を作り始めました" }).waitFor();
await page.reload();
check("「次の回を今すぐ作る」で第2回の業務ができる", (await page.getByText(/第2回：朝のルーティン紹介のショート動画を作る（第2回）/).count()) === 1);
await shot("16c-series");
await page.getByRole("button", { name: "止める" }).click();
await page.getByRole("status").filter({ hasText: "シリーズを止めました" }).waitFor();
check("シリーズを止められる", (await page.getByText(/止めています・これまで2回/).count()) === 1);
// 第2回のチームの作業は一時停止しておく（このあとのテストのAI呼び出し回数に影響させない）
await page.getByRole("link", { name: /第2回：/ }).click();
await page.getByRole("button", { name: "一時停止する" }).click();
await page.getByRole("button", { name: "再開する" }).waitFor();
await page.waitForTimeout(61_000); // 1分あたりの呼び出し回数の上限をリセット

// 絞り込み
await page.goto(`${BASE}/tasks?view=all&assignee=secretary`);
check("担当社員で絞り込み", (await page.locator("main ul li").count()) === 1);

// --- 財務 ---
await page.goto(`${BASE}/finance`);
await page.getByText("社員別の使用額（今月）").waitFor();
check("財務画面に利用履歴", (await page.getByText("天城 翔").count()) > 0);
await shot("10-finance");

// --- 設定：予算・緊急停止 ---
await page.goto(`${BASE}/settings`);
await page.fill("input[name=emergency_stop_jpy]", "3000");
await page.getByRole("button", { name: "予算設定を保存" }).click();
await page.getByText("緊急停止ラインは月間上限以下にしてください").waitFor();
check("予算の不正な値は拒否", true);
await page.fill("input[name=emergency_stop_jpy]", "2400");
await page.getByRole("button", { name: "予算設定を保存" }).click();
await page.getByText("予算設定を保存しました").waitFor();
check("予算設定を保存", true);
await shot("11-settings");
await page.getByRole("button", { name: "緊急停止する" }).click();
await page.getByText("緊急停止しました").waitFor();
await page.goto(`${BASE}/employees/secretary/chat`);
check("緊急停止中はチャット不可", (await page.getByText("緊急停止中のため会話できません").count()) > 0);
await page.goto(`${BASE}/`);
check("ホームに緊急停止のお知らせ", (await page.getByText("緊急停止中：").count()) > 0);
await page.goto(`${BASE}/settings`);
await page.getByRole("button", { name: "緊急停止を解除する" }).click();
await page.getByText("緊急停止を解除しました").waitFor();

// 社員情報の編集
await page.goto(`${BASE}/settings/employees/secretary`);
await page.fill("input[name=name]", "白石 結衣子");
await page.getByRole("button", { name: "保存する" }).click();
await page.getByText("社員情報を保存しました").waitFor();
await page.fill("input[name=name]", "白石 結衣");
await page.getByRole("button", { name: "保存する" }).click();
await page.getByText("社員情報を保存しました").waitFor();
check("社員の名前を変更できる", true);

// 自動で動く設定（Phase 3）
await page.goto(`${BASE}/settings#autorun`);
await page.locator("select[name=autorun_frequency]").selectOption("daily");
await page.getByRole("button", { name: "自動で動く設定を保存" }).click();
await page.getByText("自動で動く設定を保存しました").waitFor();
check("自動で動く頻度を保存", true);
await page.reload();
check("保存した頻度が表示される", (await page.locator("select[name=autorun_frequency]").inputValue()) === "daily");
await page.locator("select[name=autorun_frequency]").selectOption("off");
await page.getByRole("button", { name: "自動で動く設定を保存" }).click();
await page.getByText("自動で動く設定を保存しました").waitFor();

// 事業開発：今すぐ仕事を探す（Phase 3）
await page.goto(`${BASE}/business`);
await page.getByRole("button", { name: "今すぐ仕事を探す" }).click();
await page.getByRole("status").filter({ hasText: /事業の候補を|似ていたため/ }).waitFor({ timeout: 60_000 });
check("今すぐ仕事を探す", true);
await page.reload();
const firstCandidate = page.locator("main a[href^='/business/']").first();
check("事業の候補が一覧に出る", (await firstCandidate.count()) > 0);
await shot("18-business");
await firstCandidate.click();
await page.getByText("くわしい内容").waitFor();
check("候補の詳細を表示", true);
await page.locator("select[name=status]").selectOption("promising");
await page.getByRole("button", { name: "状態を保存" }).click();
await page.getByText("事業の候補の状態を変更しました").waitFor();
check("候補の状態を変更", true);
await page.waitForTimeout(800);
check("保存後も選んだ状態が表示される", (await page.locator("select[name=status]").inputValue()) === "promising");
await shot("19-business-detail");

// 「採用」にすると、販売まで自動で進み始める（商品づくりのチームが動く）
await page.locator("select[name=status]").selectOption("adopted");
await page.getByRole("button", { name: "状態を保存" }).click();
await page.getByRole("status").filter({ hasText: "採用しました。チームが商品づくりを始めました" }).waitFor({ timeout: 30_000 });
await page.reload();
check("採用すると「販売までの道のり」が商品づくりに進む", (await page.getByText("販売までの道のり").count()) === 1 && (await page.getByText(/チームが商品の完成品を作っています/).count()) === 1);
const businessUrl = page.url();

// お金の記録（Phase 4）
await page.goto(`${BASE}/finance/ledger?business=${businessUrl.split("/").pop()}`);
await page.fill("input[name=amount_jpy]", "3000");
await page.fill("input[name=description]", "テストの売上");
await page.getByRole("button", { name: "記録する" }).click();
await page.getByRole("status").filter({ hasText: "記録しました" }).waitFor();
await page.reload();
check("入ったお金を記録できる", (await page.getByText("+3,000円").count()) > 0);
await page.getByText("出たお金（費用）").click();
await page.fill("input[name=amount_jpy]", "500");
await page.getByRole("button", { name: "記録する" }).click();
await page.getByRole("status").filter({ hasText: "記録しました" }).waitFor();
await page.reload();
check("出たお金を記録できる", (await page.getByText("−500円").count()) > 0);
await page.getByText("間違えたときは", { exact: true }).first().click();
await page.fill("input[name=reason]", "テストの取り消し");
await page.getByRole("button", { name: "この記録を取り消す" }).click();
await page.getByRole("status").filter({ hasText: "記録を取り消しました" }).waitFor();
await page.reload();
check("記録を取り消せる（理由つきで残る）", (await page.getByText("取り消し済み").count()) > 0);
await shot("21-ledger");
await page.goto(`${BASE}/finance`);
check("財務画面に「今月のもうけ」", (await page.getByText("今月のもうけ").count()) > 0);
check("財務画面に事業ごとのお金", (await page.getByText("事業ごとのお金（これまでの合計）").count()) > 0);
await shot("22-finance");
await page.goto(businessUrl);
check("事業の画面にお金が出る", (await page.getByText("この事業のお金").count()) > 0);

// 報告書：今すぐ日報を作る（Phase 3）
await page.goto(`${BASE}/reports`);
check("業務の完了報告は作らない（AIの費用の節約）", (await page.getByText("業務完了報告：").count()) === 0);
await page.getByRole("button", { name: "日報を作る" }).click();
await page.getByRole("status").filter({ hasText: "日報を作りました" }).waitFor({ timeout: 60_000 });
await page.reload();
check("日報が保存される（AIが休憩中なら数字だけの日報）", (await page.getByText(/^日報(：|（数字のまとめ）)/).count()) > 0);
await shot("20-reports");
await page.getByRole("button", { name: "月報を作る" }).click();
await page.getByRole("status").filter({ hasText: "月報を作りました" }).waitFor({ timeout: 60_000 });
check("月報を作れる", true);

// 通知の設定（Phase 4）：鍵が未設定なら、鍵を作る案内が出る
await page.goto(`${BASE}/settings#notify`);
check("通知の鍵は最初は表示されない", (await page.getByText("VAPID_PRIVATE_KEY", { exact: false }).count()) === 0);
await page.getByRole("button", { name: "通知の鍵を作る" }).click();
await page.getByText("名前（Key）：VAPID_PRIVATE_KEY").waitFor();
check("通知の鍵を作ると、Vercel に登録する値が出る", true);
await page.getByRole("button", { name: "通知の設定を保存" }).click();
await page.getByRole("status").filter({ hasText: "通知の設定を保存しました" }).waitFor();
check("通知のオン・オフを保存", true);
await shot("23-notify");

// SNS運用：SNS担当が投稿案を作り、承認したら経営者が自分で投稿する
await page.goto(`${BASE}/sns`);
// テストは短時間にAIを何度も使うため、「1分あたりの上限」（安全装置）で止まったら1分待ってやり直す
for (let attempt = 0; attempt < 3; attempt++) {
  await page.getByRole("button", { name: "今すぐ投稿案を作る" }).click();
  // 成功はお知らせ（上に出る）、上限で止まったときはボタンの下に赤い文字で出る
  const result = page.getByText(/SNSの投稿案を\d+件作りました|1分ほど待ってください/).first();
  await result.waitFor({ timeout: 60_000 });
  if (/件作りました/.test(await result.innerText())) break;
  if (attempt === 0) check("AIの使いすぎ防止（1分あたりの上限）が働く", true);
  await page.waitForTimeout(61_000);
  await page.reload(); // 前の赤い文字を消してから、もう一度
}
await page.getByRole("status").filter({ hasText: /SNSの投稿案を\d+件作りました/ }).waitFor({ timeout: 60_000 });
check("SNSの投稿案を作れる", true);
await page.reload();
await shot("24-sns");
await page.locator("main a[href^='/approvals/']").first().click();
await page.getByText(/投稿する文章（X（旧Twitter））/).waitFor();
check("SNSの承認依頼に投稿先が出る", true);
await page.getByRole("button", { name: "承認する" }).click();
await page.getByRole("status").filter({ hasText: "ご自身で投稿してください" }).waitFor();
const xHref = (await page.getByRole("link", { name: "Xで開く" }).getAttribute("href")) ?? "";
check("承認後は「Xで開く」で、文章入りの投稿画面を開ける（アプリは投稿しない）", xHref.startsWith("https://x.com/intent/post?text="), xHref.slice(0, 60));
check("「文章をコピー」ボタンもある", (await page.getByRole("button", { name: "文章をコピー" }).count()) === 1);

// ===== AI Media Company：市場調査 → ジャンル選定 → ブランド → 記事 → 公開・売上の記録 → Xの投稿 =====
// AI社員を動かす（バックグラウンド）。短時間に呼び出しが集中すると安全装置で止まるので、そのときは1分待ってもう一度動かす
async function runMediaUntil(path, text, tries = 5) {
  for (let i = 0; i < tries; i++) {
    await page.goto(`${BASE}/media/management`);
    await page.getByRole("button", { name: "今すぐAI社員を動かす" }).click();
    await page.getByRole("status").filter({ hasText: /AI社員が仕事を始めました/ }).waitFor();
    for (let w = 0; w < 6; w++) {
      await page.waitForTimeout(5000);
      await page.goto(`${BASE}${path}`);
      if ((await page.getByText(text).count()) > 0) return true;
    }
    await page.waitForTimeout(61_000);
  }
  return false;
}
// このテストはここまでにAIを何度も使っているので、1日の上限（はじめは150円）を上げてからメディア事業を確かめる
await page.goto(`${BASE}/settings`);
check("AIの1日の上限のはじめの値は150円（メディア事業の予算）", (await page.locator("input[name=daily_limit_jpy]").inputValue()) === "150");
await page.fill("input[name=daily_limit_jpy]", "2000");
await page.fill("input[name=monthly_limit_jpy]", "5000");
await page.fill("input[name=emergency_stop_jpy]", "5000");
await page.getByRole("button", { name: "予算設定を保存" }).click();
await page.getByText("予算設定を保存しました").waitFor();
check("タブに「記事」がある（ライフはメニューから外した）",
  (await page.locator("nav[aria-label=メインメニュー] a[href='/media/articles']").count()) === 1 &&
  (await page.locator("nav[aria-label=メインメニュー] a[href='/life']").count()) === 0);
const researched = await runMediaUntil("/media/research", "選定");
check("市場調査部が複数ジャンルを調べ、上位3つを深掘りして1つを選ぶ", researched && (await page.getByText("深掘りした上位3ジャンル").count()) === 1 && (await page.getByText(/調べたジャンル（\d+）/).count()) === 1);
check("ジャンルは100点満点で評価され、項目ごとの点数が出る", (await page.getByText("読者需要").count()) > 0 && (await page.getByText("運営コスト").count()) > 0);
await shot("40-media-research");
await page.goto(`${BASE}/media/brand`);
const branded = (await page.getByText("販売商品").count()) > 0 || (await runMediaUntil("/media/brand", "販売商品"));
check("事業開発部がメディアブランド（名前・読者・紹介文・商品）を設計する", branded && (await page.getByText("X の紹介文", { exact: true }).count()) === 1);
await page.fill("input[name=note_url]", "https://note.com/test_media");
await page.fill("input[name=x_handle]", "@test_media");
await page.getByRole("button", { name: "アカウントを記録する" }).click();
await page.getByRole("status").filter({ hasText: "アカウントを記録しました" }).waitFor();
check("note と X のアカウントを記録できる", true);
await shot("41-media-brand");

const written = await runMediaUntil("/media/articles?status=ready", "完成（公開待ち）");
check("記事が 企画 → 情報源 → 執筆 → 品質検査 を経て完成する", written);
await page.locator("main ul li a").first().click();
await page.getByText("note に公開する（あなたが行う）").waitFor();
check("完成した記事は note に貼れる（タイトル・本文・参考にした情報をコピー）",
  (await page.getByRole("button", { name: "タイトル" }).count()) === 1 && (await page.getByRole("button", { name: "参考にした情報" }).count()) === 1);
check("記事に品質検査の点数・情報源が残る", (await page.getByText("品質検査（監査・品質管理部）").count()) === 1 && (await page.getByText("情報源").count()) > 0);
await shot("42-media-article");
await page.fill("input[name=url]", "https://note.com/test_media/n/n0123456789ab");
await page.getByRole("button", { name: "公開した" }).click();
await page.getByRole("status").filter({ hasText: "公開済みにしました" }).waitFor();
await page.fill("input[name=views]", "150");
await page.fill("input[name=likes]", "12");
await page.fill("input[name=sales]", "2");
await page.fill("input[name=revenue]", "600");
await page.getByRole("button", { name: "数字を記録する" }).click();
await page.getByRole("status").filter({ hasText: /お金の記録にも入れました/ }).waitFor();
check("公開したURLと、閲覧数・販売数・売上を記録できる（売上はお金の記録にも入る）", true);
await page.goto(`${BASE}/`);
check("ホームの今月の売上に、記録した売上が出る", (await page.getByText("600円").count()) > 0);

await page.goto(`${BASE}/media/sns`);
const waitingPost = page.locator("a[href^='/approvals/']").first();
if ((await waitingPost.count()) === 0) await runMediaUntil("/media/sns", /承認待ち（[1-9]/);
await page.locator("a[href^='/approvals/']").first().click();
await page.getByRole("button", { name: "承認する" }).click();
await page.getByRole("status").filter({ hasText: "ご自身で投稿してください" }).waitFor();
await page.goto(`${BASE}/media/sns`);
check("承認したXの投稿は「Xで開く」で自分で投稿する（アプリは投稿しない）", (await page.getByRole("link", { name: "Xで開く" }).count()) > 0);
await page.locator("input[name=impressions]").first().fill("300");
await page.getByRole("button", { name: "投稿した（記録する）" }).first().click();
await page.getByRole("status").filter({ hasText: "投稿済みとして記録しました" }).waitFor();
check("Xに投稿したことと反応を記録できる", true);
await shot("43-media-sns");

await page.goto(`${BASE}/media/management`);
check("経営管理に予算（AI・全体）・状態・実行の記録が出る",
  (await page.getByText("事業全体").count()) === 1 && (await page.getByText(/いまの状態：/).count()) === 1 && (await page.getByText("実行の記録").count()) === 1);
check("実行の記録に、部署・開始・終了・費用が残る", (await page.getByText(/市場調査部・.*開始/).count()) > 0);
await shot("44-media-management");
await page.goto(`${BASE}/employees/research`);
check("社員の画面に、メディア事業での仕事の履歴が出る", (await page.getByText("メディア事業での仕事").count()) === 1);

// ===== 裏で動く仕事：定期実行（GitHub と同じ呼び方）→ 先回りの準備・自主研究 =====
const cronOk = await page.request.get(`${BASE}/api/cron/workflow`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "cron-secret-for-local-test-0123456789"}` } });
check("合言葉つきの定期実行は動く", cronOk.status() === 200);
await page.goto(`${BASE}/settings`);
check("設定に「最後に自動で動いた時刻」が出る", (await page.getByText("まだ動いていません").count()) === 0 && (await page.getByText("最後に自動で動いた時刻").count()) === 1);

// 定期実行の入口は、合言葉（CRON_SECRET）がないと動かない
const cronRes = await page.request.get(`${BASE}/api/cron/workflow`);
check("定期実行は合言葉なしでは動かない", cronRes.status() === 401);

// PWA
const manifest = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json();
check("manifest が読める", manifest.display === "standalone");
const icon = await page.request.get(`${BASE}/icons/apple-touch-icon.png`);
check("ホーム画面用アイコンが読める", icon.ok());

// ホーム（最終）
await page.goto(`${BASE}/`);
await shot("12-home-after");

// ダークモード
await page.emulateMedia({ colorScheme: "dark" });
await page.goto(`${BASE}/`);
await shot("13-home-dark");
await page.goto(`${BASE}/employees/president/chat`);
await shot("14-chat-dark");
await page.emulateMedia({ colorScheme: "light" });

// タップしやすさ：主要な画面で、押せる場所がすべて縦横44px以上あるか（実際に押したときに届くかで確かめる）
async function smallTapTargets() {
  return page.evaluate(async () => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    const SEL = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]";
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.closest("[aria-hidden=true], [inert]")) return false;
      const rc = el.getBoundingClientRect();
      return rc.width > 0 && rc.height > 0;
    };
    const targets = new Set();
    for (const el of document.querySelectorAll(SEL)) {
      if (el.matches("input[type=radio], input[type=checkbox]")) {
        const lab = el.closest("label");
        if (lab && visible(lab)) { targets.add(lab); continue; }
      }
      if (!visible(el) || (el.parentElement?.closest(SEL) && !el.matches("input, select, textarea"))) continue;
      targets.add(el);
    }
    const bad = [];
    for (const el of targets) {
      el.scrollIntoView({ block: "center", inline: "center" });
      await new Promise((r) => requestAnimationFrame(() => r()));
      const rc = el.getBoundingClientRect();
      const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
      const ok = [[cx, cy], [cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]].every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit && (hit === el || el.contains(hit));
      });
      if (!ok) bad.push(`${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20)} ${Math.round(rc.width)}×${Math.round(rc.height)}`);
    }
    return bad;
  });
}
for (const path of ["/", "/media/articles", "/employees", "/approvals", "/more", "/media/management"]) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");
  const bad = await smallTapTargets();
  check(`「${path}」の押せる場所はすべて44px以上`, bad.length === 0, bad.slice(0, 3).join(" / "));
}

// ログアウト
await page.goto(`${BASE}/more`);
await page.getByRole("button", { name: "ログアウト" }).click();
await page.waitForURL(/\/login/);
await page.goto(`${BASE}/tasks`);
check("ログアウト後は業務画面を見られない", page.url().includes("/login"));

check("ブラウザのエラーなし", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
