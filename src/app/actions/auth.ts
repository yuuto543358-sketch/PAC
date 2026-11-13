"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, resetDb } from "@/lib/db";
import { describeDbError } from "@/lib/db/errors";
import { assertAuth } from "@/lib/auth/dal";
import { getSessionSecret, SESSION_COOKIE, SESSION_MAX_AGE_SEC, signSession } from "@/lib/auth/session";
import { audit } from "@/lib/repo/audit";
import { createStepLogger, TimeoutError, withTimeout } from "@/lib/log";

export type LoginState = { error?: string };

const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_GLOBAL = 30;
const WINDOW_MIN = 15;
/** ログイン処理のうち、データベースを使う部分の最大待ち時間 */
const LOGIN_DB_TIMEOUT_MS = 25_000;

function sha256(s: string) {
  return createHash("sha256").update(s).digest();
}

async function clientIpHash() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return sha256(`pac-ip:${ip}`).toString("hex").slice(0, 32);
}

type LoginDbResult = { kind: "locked" } | { kind: "wrong" } | { kind: "ok"; sessionVersion: number };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // 処理の各段階を Vercel のログに出す（「[pac][login]」で検索すると見つかります）
  const log = createStepLogger("login");
  log.step("start");

  const expected = process.env.APP_PASSWORD;
  const secret = getSessionSecret();
  if (!expected || expected.length < 12 || !secret) {
    log.step("env missing", { hasPassword: Boolean(expected), hasSecret: Boolean(secret) });
    return { error: "サーバーの初期設定が完了していません。READMEの手順を確認してください。" };
  }
  const password = String(formData.get("password") ?? "");
  const ipHash = await clientIpHash();
  log.step("env ok");

  let result: LoginDbResult;
  try {
    result = await withTimeout(
      (async (): Promise<LoginDbResult> => {
        const sql = await getDb(log);
        log.step("db ready");

        const [counts] = await sql<{ ip_fails: number; all_fails: number }[]>`
          select
            count(*) filter (where ip_hash = ${ipHash} and not success)::int as ip_fails,
            count(*) filter (where not success)::int as all_fails
          from login_attempts where created_at > now() - make_interval(mins => ${WINDOW_MIN})`;
        log.step("rate limit checked", { ipFails: counts.ip_fails, allFails: counts.all_fails });
        if (counts.ip_fails >= MAX_FAILS_PER_IP || counts.all_fails >= MAX_FAILS_GLOBAL) {
          return { kind: "locked" };
        }

        // 文字数の違いから推測されないよう、ハッシュ同士を一定時間で比較する
        const ok = timingSafeEqual(sha256(password), sha256(expected));
        await sql`insert into login_attempts (ip_hash, success) values (${ipHash}, ${ok})`;
        log.step("attempt recorded", { ok });
        if (!ok) return { kind: "wrong" };

        const [row] = await sql<{ session_version: number }[]>`
          select session_version from company_settings where id = 1`;
        log.step("session version loaded");
        return { kind: "ok", sessionVersion: row.session_version };
      })(),
      LOGIN_DB_TIMEOUT_MS,
      "ログイン処理（データベース）",
    );
  } catch (err) {
    log.fail("database", err);
    if (err instanceof TimeoutError) await resetDb();
    return { error: describeDbError(err) };
  }

  if (result.kind === "locked") {
    return { error: `ログインの失敗が続いたため、${WINDOW_MIN}分間ロックしています。時間をおいてお試しください。` };
  }
  if (result.kind === "wrong") {
    return { error: "パスワードが違います。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signSession({ iat: now, exp: now + SESSION_MAX_AGE_SEC, v: result.sessionVersion }, secret);
  log.step("session signed");
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIE !== "1",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  log.step("cookie set");

  // 操作履歴は記録できなくてもログイン自体は続ける
  try {
    const sql = await getDb(log);
    await withTimeout(audit(sql, "user", "login"), 5_000, "ログイン履歴の記録");
  } catch (err) {
    log.fail("audit", err);
  }
  log.step("redirect to home");
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
