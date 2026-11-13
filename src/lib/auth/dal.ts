import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSessionSecret, SESSION_COOKIE, verifySession } from "./session";

/**
 * ログイン済みか確認します（サーバー側で毎回確認する、本当の関門）。
 * 未ログインならログイン画面へ移動します。
 */
export async function requireAuth() {
  const ok = await isAuthenticated();
  if (!ok) redirect("/login");
}

export async function isAuthenticated(): Promise<boolean> {
  const secret = getSessionSecret();
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token, secret);
  if (!payload) return false;
  const sql = await getDb();
  const [row] = await sql<{ session_version: number }[]>`select session_version from company_settings where id = 1`;
  return Boolean(row) && row.session_version === payload.v;
}

/** サーバーアクション用：未ログインならエラーにする */
export async function assertAuth() {
  if (!(await isAuthenticated())) {
    throw new Error("ログインが必要です。ページを再読み込みしてください。");
  }
}
