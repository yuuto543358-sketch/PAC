import "server-only";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { createStepLogger } from "@/lib/log";
import { runWorkflows } from "./engine";
import { dispatchNotifications } from "@/lib/notify";

/**
 * 画面に結果を返したあと、バックグラウンドでチームの作業を進めます。
 * （Vercel では処理の制限時間内に限ります。続きは画面を開いたとき・毎朝の定期実行で進みます）
 */
export function scheduleTeamRun(taskIds?: string[]) {
  after(async () => {
    const log = createStepLogger("team-bg");
    try {
      const sql = await getDb();
      const r = await runWorkflows(sql, { taskIds, maxSteps: 15, deadlineMs: 200_000 });
      log.step("background run finished", { steps: r.steps, stopped: r.stoppedReason });
      // チームの作業で生まれた通知（承認のお願い・質問など）を送る
      await dispatchNotifications(sql);
    } catch (err) {
      log.fail("background run", err);
    }
  });
}
