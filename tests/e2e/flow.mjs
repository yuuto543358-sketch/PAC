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

// --- 承認 ---
await page.goto(`${BASE}/`);
const badge = await page.locator("nav[aria-label=メインメニュー] a[href='/approvals'] span").last().textContent();
check("承認タブに未確認件数バッジ", badge?.trim() === "1", `badge=${badge}`);
await page.click("nav >> text=承認");
await page.getByText("未確認 1件").waitFor();
await shot("05-approvals");
await page.locator("main ul li a").first().click();
await page.getByText("実行しようとしている内容").waitFor();
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
await page.getByText("承認しました").waitFor();
await page.getByText("Phase 4で実装予定").waitFor();
check("承認後も外部実行はされない（未実装と表示）", true);
await shot("07-approved");

// --- 業務 ---
await page.click("nav >> text=業務");
await page.getByRole("heading", { name: "業務管理" }).waitFor();
await shot("08-tasks");
await page.locator("main ul li a").first().click();
await page.getByText("進行履歴").waitFor();
const statusSel = page.locator("select[name=to]");
const opts = await statusSel.locator("option").allTextContents();
check("ステータス変更の選択肢がある", opts.length > 0, opts.join(","));
await shot("09-task-detail");

// 新規登録
await page.goto(`${BASE}/tasks/new`);
await page.fill("input[name=title]", "週次の振り返りメモを作る");
await page.selectOption("select[name=assignee]", "secretary");
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

// 準備中の画面
await page.goto(`${BASE}/business`);
check("事業開発は準備中と明示", (await page.getByText("Phase 3〜4で実装予定").count()) > 0);
await page.goto(`${BASE}/reports`);
check("報告書は準備中と明示", (await page.getByText("Phase 2で実装予定").count()) > 0);

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
