import type { NextConfig } from "next";

// このアプリはログインが必要な社内システムなので、すべてのページを
// リクエストごとに組み立てる（キャッシュしない）従来の動き方を使います。
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// どのコード（コミット）から作られたアプリかを画面に表示するための番号。
// Vercel のビルド時に自動で入る VERCEL_GIT_COMMIT_SHA の先頭7文字を使う（手元では "local"）。
const BUILD_COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);

const nextConfig: NextConfig = {
  cacheComponents: false,
  env: { NEXT_PUBLIC_BUILD_COMMIT: BUILD_COMMIT },
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
