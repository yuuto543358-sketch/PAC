import { NextResponse, type NextRequest } from "next/server";
import { getSessionSecret, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

// ページを表示する前に、ログイン用クッキーの署名を確認します（一次チェック）。
// 本当の確認はサーバー側（src/lib/auth/dal.ts）でも毎回行います。
const HEALTH_PATH = "/api/health";
const PUBLIC_PATHS = ["/login", "/setup", HEALTH_PATH];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // 「/login/api/health」のように、ログイン画面などのアドレスの後ろに付けてしまった場合は、
  // 正しい確認用アドレス（/api/health）へ案内する
  if (pathname !== HEALTH_PATH && pathname.endsWith(HEALTH_PATH)) {
    return NextResponse.redirect(new URL(HEALTH_PATH, request.url), 308);
  }
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const secret = getSessionSecret();
  if (!secret) {
    return NextResponse.redirect(new URL("/setup", request.url));
  }
  const payload = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret);
  if (!payload) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // 画像・アイコン・PWA用ファイルなどは対象外
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|offline.html|robots.txt).*)",
  ],
};
