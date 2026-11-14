import { getDb } from "@/lib/db";
import { createStepLogger } from "@/lib/log";
import { runWorkflows } from "@/lib/workflow/engine";
import { runScheduledJobs } from "@/lib/autonomy/scheduler";
import { dispatchNotifications } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 毎朝の定期実行（Vercel Cron から1日1回、日本時間の午前7時半ごろに呼ばれる）。
 * 1. 設定の「自動で動く頻度」に合わせて、仕事探し・日報・週報を作る（同じ日に2回は動かない）
 * 2. 止まっているチームの作業を続きから進める
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
    const started = Date.now();
    await sql`update company_settings set last_cron_at = now() where id = 1`;
    let jobs = null;
    try {
      jobs = await runScheduledJobs(sql);
    } catch (err) {
      // 自主的な仕事に失敗しても、チームの作業は続ける
      log.fail("scheduled jobs", err);
    }
    const r = await runWorkflows(sql, { maxSteps: 30, deadlineMs: Math.max(30_000, 240_000 - (Date.now() - started)) });
    let push = null;
    try {
      push = await dispatchNotifications(sql);
    } catch (err) {
      log.fail("push", err);
    }
    log.step("finished", { steps: r.steps, stopped: r.stoppedReason, jobs: jobs?.ran, push });
    return Response.json({
      ok: true,
      jobs: jobs ? { ran: jobs.ran, skipped: jobs.skipped } : null,
      steps: r.steps,
      stoppedReason: r.stoppedReason ?? null,
    });
  } catch (err) {
    log.fail("cron", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
