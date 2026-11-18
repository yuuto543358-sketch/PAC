import { after } from "next/server";
import { getDb } from "@/lib/db";
import { createStepLogger } from "@/lib/log";
import { chainOrigin, MAX_CHAIN_HOPS, runMediaChainStep } from "@/lib/mediaco/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * メディアの仕事の「続き」を進める（前の実行が時間で区切られたとき、アプリ自身が呼ぶ）。
 * 合言葉（CRON_SECRET）がないと動かない。すぐ「受け付けた」（202）と返し、裏で仕事を進める。
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const hop = Math.floor(Number(url.searchParams.get("hop") ?? "1"));
  if (!Number.isFinite(hop) || hop < 1 || hop > MAX_CHAIN_HOPS) {
    return Response.json({ ok: false, message: "これ以上はつなぎません" }, { status: 400 });
  }
  const origin = chainOrigin(url.origin);
  after(async () => {
    try {
      const sql = await getDb();
      await runMediaChainStep(sql, { origin, hop, trigger: `chain:${hop}` });
    } catch (err) {
      createStepLogger("media").fail("chain run", err);
    }
  });
  return Response.json({ ok: true, hop }, { status: 202 });
}
