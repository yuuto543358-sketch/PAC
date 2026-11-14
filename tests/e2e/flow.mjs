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
await page.getByText("本日の会社の状況").waitFor();
check("ログインしてホーム表示", true);
await shot("01-home");

// --- 社員 ---
await page.click("nav >> text=社員");
await page.getByText("6名が在籍しています").waitFor();
check("社員一覧に6名", (await page.locator("main li").count()) === 6);
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
for (const kind of ["計画", "調査メモ", "意見", "監査", "報告"]) {
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
check("ホームにチームの進行状況", (await page.getByText("成果物の承認待ち").count()) > 0);
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
await page.click("nav >> text=業務");
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
await page.fill("input[name=emergency_stop_jpy]", "1800");
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

// 報告書：今すぐ日報を作る（Phase 3）
await page.goto(`${BASE}/reports`);
check("報告書に社長の完了報告が保存される", (await page.getByText("業務完了報告：").count()) > 0);
await page.getByRole("button", { name: "日報を作る" }).click();
await page.getByRole("status").filter({ hasText: "日報を作りました" }).waitFor({ timeout: 60_000 });
await page.reload();
check("日報が保存される（AIが休憩中なら数字だけの日報）", (await page.getByText(/^日報(：|（数字のまとめ）)/).count()) > 0);
await shot("20-reports");

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
