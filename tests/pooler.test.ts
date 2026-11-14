// Supabase の Transaction pooler で起きた「答えが返ってこない」不具合の再発防止テスト。
// データベースとの間に中継役（プロキシ）を置き、通信の中身を数えたり、わざと答えを止めたりする。
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { clientOptions, closeDb, getDb } from "@/lib/db";
import { getSpendSummary } from "@/lib/budget";
import { getBudget, getSettings } from "@/lib/repo/settings";
import { countTasks, listTasks } from "@/lib/repo/tasks";
import { countPendingApprovals } from "@/lib/repo/approvals";
import { latestPresidentMessage } from "@/lib/repo/conversations";
import { listEmployees } from "@/lib/repo/employees";
import { dailyUsageThisMonth, listUsage, usageByEmployeeThisMonth, usageByTaskThisMonth } from "@/lib/repo/usage";

const dbUrl = new URL(process.env.DATABASE_URL!);

type Proxy = {
  port: number;
  /** 1つの接続で、答えを待っている問い合わせの最大数 */
  maxInFlight: () => number;
  /** true にすると、データベースからの答えを捨てる（応答しない pooler の再現） */
  setBlackhole: (on: boolean) => void;
  close: () => Promise<void>;
};

/**
 * PostgreSQL の通信を中継し、問い合わせ（Query 'Q' / Sync 'S'）と完了の合図（ReadyForQuery 'Z'）を数える。
 */
async function startProxy(): Promise<Proxy> {
  let maxInFlight = 0;
  let blackhole = false;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(dbUrl.port || 5432), dbUrl.hostname);
    sockets.add(client);
    sockets.add(upstream);
    let inFlight = 0;
    let started = false;
    let cbuf = Buffer.alloc(0);
    let sbuf = Buffer.alloc(0);
    client.on("data", (chunk) => {
      upstream.write(chunk);
      cbuf = Buffer.concat([cbuf, chunk]);
      for (;;) {
        if (!started) {
          if (cbuf.length < 4) break;
          const len = cbuf.readInt32BE(0);
          if (cbuf.length < len) break;
          cbuf = cbuf.subarray(len);
          started = true;
          continue;
        }
        if (cbuf.length < 5) break;
        const type = String.fromCharCode(cbuf[0]);
        const len = cbuf.readInt32BE(1);
        if (cbuf.length < len + 1) break;
        if (type === "Q" || type === "S") {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
        }
        cbuf = cbuf.subarray(len + 1);
      }
    });
    upstream.on("data", (chunk) => {
      sbuf = Buffer.concat([sbuf, chunk]);
      for (;;) {
        if (sbuf.length < 5) break;
        const type = String.fromCharCode(sbuf[0]);
        const len = sbuf.readInt32BE(1);
        if (sbuf.length < len + 1) break;
        if (type === "Z" && started) inFlight = Math.max(0, inFlight - 1);
        sbuf = sbuf.subarray(len + 1);
      }
      if (!blackhole) client.write(chunk);
    });
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", end).on("close", end);
    upstream.on("error", end).on("close", end);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    maxInFlight: () => maxInFlight,
    setBlackhole: (on) => {
      blackhole = on;
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

function proxiedUrl(port: number) {
  const u = new URL(dbUrl.toString());
  u.hostname = "127.0.0.1";
  u.port = String(port);
  return u.toString();
}

/** ホーム画面が同時に行う問い合わせと同じもの */
async function homePageQueries(sql: postgres.Sql<Record<string, never>>) {
  const db = sql as never;
  return Promise.all([
    getSettings(db),
    getBudget(db),
    getSpendSummary(db),
    countTasks(db),
    countPendingApprovals(db),
    latestPresidentMessage(db),
    listEmployees(db),
    listTasks(db, { view: "active" }, 5),
    listUsage(db, 10),
    usageByEmployeeThisMonth(db),
    usageByTaskThisMonth(db),
    dailyUsageThisMonth(db),
  ]);
}

let proxy: Proxy;
beforeAll(async () => {
  await closeDb();
  await getDb(); // 表を用意
  proxy = await startProxy();
});
afterAll(async () => {
  await proxy.close();
  await closeDb();
});

describe("Supabase Transaction pooler 対策", () => {
  it("アプリの接続設定は、1つの接続に問い合わせを1つずつしか送らない（max_pipeline: 1）", () => {
    const opts = clientOptions("supabase-transaction-pooler");
    expect(opts.max_pipeline).toBe(1);
    expect(opts.query_timeout).toBeGreaterThan(0);
    expect(opts.queue_timeout).toBeGreaterThan(0);
    expect(opts.prepare).toBe(false);
  });

  it("【原因の再現】以前の設定では、ホーム画面の問い合わせがまとめて送られていた（パイプライン）", async () => {
    const before = proxy.maxInFlight();
    const old = postgres(proxiedUrl(proxy.port), { ...clientOptions("local"), max_pipeline: 100, max: 3 });
    await homePageQueries(old as never);
    await old.end();
    expect(proxy.maxInFlight()).toBeGreaterThan(Math.max(1, before));
  });

  it("新しい設定では、同時に多数の問い合わせをしても1接続あたり常に1つずつ送り、結果も正しく返る", async () => {
    const p2 = await startProxy();
    const sql = postgres(proxiedUrl(p2.port), clientOptions("local"));
    const results = await Promise.all([homePageQueries(sql as never), homePageQueries(sql as never), homePageQueries(sql as never)]);
    for (const r of results) {
      const spend = r[2];
      expect(spend.monthJpy).toBeGreaterThanOrEqual(0);
      expect(r[6].length).toBe(7); // 社員7人
    }
    expect(p2.maxInFlight()).toBe(1);
    await sql.end();
    await p2.close();
  });

  it("pooler が答えを返さなくなっても無限に待たず、時間切れエラー（QUERY_TIMEOUT）になる", async () => {
    const p3 = await startProxy();
    const sql = postgres(proxiedUrl(p3.port), { ...clientOptions("local"), query_timeout: 2, cancel_timeout: 1 });
    await sql`select 1`; // 接続を確立
    p3.setBlackhole(true);
    const t0 = Date.now();
    await expect(sql`select session_version from company_settings where id = 1`).rejects.toMatchObject({
      code: "QUERY_TIMEOUT",
    });
    expect(Date.now() - t0).toBeLessThan(6000);
    // 答えが戻れば、新しい接続で普通に使える
    p3.setBlackhole(false);
    const [r] = await sql`select 1 as ok`;
    expect(r.ok).toBe(1);
    await sql.end({ timeout: 0 });
    await p3.close();
  }, 20000);
});

describe("初回利用時・データが無いとき", () => {
  it("API利用記録が0件でも、今月の使用額は0円として正しく返る", async () => {
    const sql = await getDb();
    // 記録は削除できない仕組みなので、同じ名前の「空の一時テーブル」をこのトランザクションの中だけで使って再現する
    const fresh = await sql.begin(async (tx) => {
      await tx`create temporary table api_usage (like public.api_usage) on commit drop`;
      return getSpendSummary(tx);
    });
    expect(fresh).toEqual({ monthJpy: 0, todayJpy: 0, callsToday: 0, callsLastMinute: 0 });
  });

  it("予算設定・会社設定の行が無くても、初期値で自動作成して動く", async () => {
    const sql = await getDb();
    await sql`delete from budgets`;
    const b = await getBudget(sql);
    expect(b.monthly_limit_jpy).toBe(2000);
    expect(b.emergency_stop_jpy).toBe(1800);
    expect(b.per_task_limit_jpy).toBe(30);
    expect(b.daily_limit_jpy).toBe(50);
    const s = await getSettings(sql);
    expect(s.company_name).toBe("PERSONAL AI COMPANY");
  });
});
