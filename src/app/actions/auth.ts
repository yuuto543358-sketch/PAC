"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { assertAuth } from "@/lib/auth/dal";
import { getSessionSecret, SESSION_COOKIE, SESSION_MAX_AGE_SEC, signSession } from "@/lib/auth/session";
import { audit } from "@/lib/repo/audit";

export type LoginState = { error?: string };

const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_GLOBAL = 30;
const WINDOW_MIN = 15;

function sha256(s: string) {
  return createHash("sha256").update(s).digest();
}

async function clientIpHash() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return sha256(`pac-ip:${ip}`).toString("hex").slice(0, 32);
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const expected = process.env.APP_PASSWORD;
  const secret = getSessionSecret();
  if (!expected || expected.length < 12 || !secret) {
    return { error: "サーバーの初期設定が完了していません。READMEの手順を確認してください。" };
  }
  const password = String(formData.get("password") ?? "");
  const sql = await getDb();
  const ipHash = await clientIpHash();

  const [counts] = await sql<{ ip_fails: number; all_fails: number }[]>`
    select
      count(*) filter (where ip_hash = ${ipHash} and not success)::int as ip_fails,
      count(*) filter (where not success)::int as all_fails
    from login_attempts where created_at > now() - make_interval(mins => ${WINDOW_MIN})`;
  if (counts.ip_fails >= MAX_FAILS_PER_IP || counts.all_fails >= MAX_FAILS_GLOBAL) {
    return { error: `ログインの失敗が続いたため、${WINDOW_MIN}分間ロックしています。時間をおいてお試しください。` };
  }

  // 文字数の違いから推測されないよう、ハッシュ同士を一定時間で比較する
  const ok = timingSafeEqual(sha256(password), sha256(expected));
  await sql`insert into login_attempts (ip_hash, success) values (${ipHash}, ${ok})`;
  if (!ok) {
    return { error: "パスワードが違います。" };
  }

  const [row] = await sql<{ session_version: number }[]>`select session_version from company_settings where id = 1`;
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession({ iat: now, exp: now + SESSION_MAX_AGE_SEC, v: row.session_version }, secret);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIE !== "1",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  await audit(sql, "user", "login");
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/** すべての端末のログインを無効にする（パスワード漏えいが心配なとき用） */
export async function logoutAllDevices() {
  await assertAuth();
  const sql = await getDb();
  await sql`update company_settings set session_version = session_version + 1, updated_at = now() where id = 1`;
  await audit(sql, "user", "logout_all_devices");
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
