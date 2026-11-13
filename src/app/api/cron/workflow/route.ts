import { getDb } from "@/lib/db";
import { createStepLogger } from "@/lib/log";
import { runWorkflows } from "@/lib/workflow/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 夜間の定期実行（Vercel Cron から1日1回呼ばれる）。止まっているチームの作業を続きから進めます。
 * 環境変数 CRON_SECRET を設定した場合だけ動きます（設定がなければ何もしません）。
 * 予算・緊急停止などの上限は、通常どおり AI を呼ぶ前に確認されます。
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }
  const log = createStepLogger("cron");
  try {
    const sql = await getDb();
    const r = await runWorkflows(sql, { maxSteps: 30, deadlineMs: 240_000 });
    log.step("finished", { steps: r.steps, stopped: r.stoppedReason });
    return Response.json({ ok: true, steps: r.steps, stoppedReason: r.stoppedReason ?? null });
  } catch (err) {
    log.fail("cron", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
