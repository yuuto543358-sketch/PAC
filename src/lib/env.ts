import "server-only";

export type EnvIssue = { key: string; message: string };

/** 必須の設定（環境変数）が揃っているか確認します。値そのものは返しません。 */
export function checkRequiredEnv(): EnvIssue[] {
  const issues: EnvIssue[] = [];
  if (!process.env.DATABASE_URL) {
    issues.push({ key: "DATABASE_URL", message: "データベース（Supabase）の接続先が設定されていません。" });
  }
  const pw = process.env.APP_PASSWORD;
  if (!pw) {
    issues.push({ key: "APP_PASSWORD", message: "ログイン用パスワードが設定されていません。" });
  } else if (pw.length < 12) {
    issues.push({ key: "APP_PASSWORD", message: "ログイン用パスワードが短すぎます（12文字以上にしてください）。" });
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    issues.push({ key: "SESSION_SECRET", message: "ログイン状態の暗号化キーが設定されていません。" });
  } else if (secret.length < 32) {
    issues.push({ key: "SESSION_SECRET", message: "暗号化キーが短すぎます（32文字以上にしてください）。" });
  }
  return issues;
}
