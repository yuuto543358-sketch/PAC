import { getDb, resetDb } from "@/lib/db";
import { describeDbError } from "@/lib/db/errors";
import { checkRequiredEnv } from "@/lib/env";
import { createStepLogger, TimeoutError, withTimeout } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * 動作確認用：データベースにつながるかを調べて結果を返します。
 * ブラウザで「https://（アプリのアドレス）/api/health」を開くと確認できます。
 * 接続文字列やパスワードなどの秘密情報は返しません。
 */
export async function GET() {
  const log = createStepLogger("health");
  const t0 = Date.now();
  const missing = checkRequiredEnv().map((i) => i.key);
  if (missing.length) {
    return Response.json({ ok: false, message: "必要な環境変数が足りません", missing: [...new Set(missing)] }, { status: 500 });
  }
  try {
    await withTimeout(
      (async () => {
        const sql = await getDb(log);
        await sql`select 1`;
      })(),
      25_000,
      "データベースの確認",
    );
    log.step("ok");
    return Response.json({
      ok: true,
      message: "データベースに接続できました",
      ms: Date.now() - t0,
      openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (err) {
    log.fail("health", err);
    if (err instanceof TimeoutError) await resetDb();
    return Response.json({ ok: false, message: describeDbError(err), ms: Date.now() - t0 }, { status: 503 });
  }
}
