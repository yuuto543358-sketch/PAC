import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { closeDb, getDb } from "@/lib/db";
import { parseDatabaseUrl } from "@/lib/db/url";
import { describeDbError } from "@/lib/db/errors";
import { TimeoutError, withTimeout } from "@/lib/log";

const url = process.env.DATABASE_URL!;

afterAll(async () => {
  await closeDb();
});

describe("DATABASE_URL の確認", () => {
  it("Supabase の Transaction pooler を正しく認識する", () => {
    const r = parseDatabaseUrl(
      "postgresql://postgres.abcdefghijkl:Secret123@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.info.kind).toBe("supabase-transaction-pooler");
      expect(r.info.port).toBe(6543);
      expect(r.warnings).toHaveLength(0);
    }
  });

  it("前後の空白・改行・引用符を取り除く", () => {
    const r = parseDatabaseUrl(
      '  "postgresql://postgres.abc:Secret123@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"\n',
    );
    expect(r.ok).toBe(true);
  });

  it("[YOUR-PASSWORD] の置き換え忘れを検出する", () => {
    const r = parseDatabaseUrl(
      "postgresql://postgres.abc:[YOUR-PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
    );
    expect(r.ok).toBe(false);
  });

  it("パスワード内の記号（@ # / ?）を自動でエンコードする", () => {
    const r = parseDatabaseUrl("postgresql://postgres.abc:p@ss#w/rd?x@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.info.host).toBe("aws-0-ap-northeast-1.pooler.supabase.com");
      expect(r.url).toContain(encodeURIComponent("p@ss#w/rd?x"));
      expect(new URL(r.url).hostname).toBe("aws-0-ap-northeast-1.pooler.supabase.com");
    }
  });

  it("Direct connection には注意を出す", () => {
    const r = parseDatabaseUrl("postgresql://postgres:Secret123@db.abcdefghijkl.supabase.co:5432/postgres");
    expect(r.ok && r.warnings.length > 0).toBe(true);
  });

  it("形が違う文字列はエラー", () => {
    expect(parseDatabaseUrl("https://example.com").ok).toBe(false);
    expect(parseDatabaseUrl("").ok).toBe(false);
  });
});

describe("無限に待たないこと", () => {
  it("withTimeout は時間切れでエラーになる", async () => {
    await expect(withTimeout(new Promise(() => {}), 50, "テスト")).rejects.toBeInstanceOf(TimeoutError);
    expect(describeDbError(new TimeoutError("x", 1))).toMatch(/時間内に応答/);
  });

  it("以前の処理がロックを持ったまま止まっていても、getDb はすぐ返る（今回の不具合の再現）", async () => {
    await closeDb();
    await getDb(); // 表を作成しておく
    await closeDb();

    // 途中で止まった処理を再現：表作成用のロックを持ったまま放置される接続
    const stuck = postgres(url, { max: 1, onnotice: () => {} });
    await stuck.unsafe("begin");
    await stuck`select pg_advisory_xact_lock(hashtext('pac_schema_migrations'))`;

    const t0 = Date.now();
    const sql = await getDb();
    const [row] = await sql`select session_version from company_settings where id = 1`;
    expect(row.session_version).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(5000);

    await stuck.unsafe("rollback");
    await stuck.end();
  });

  it("トランザクション内のロック待ちは上限時間でエラーになる（無限に待たない）", async () => {
    const sql = await getDb();
    const { begin } = await import("@/lib/db");
    const holder = postgres(url, { max: 1, onnotice: () => {} });
    await holder.unsafe("begin");
    await holder`select pg_advisory_xact_lock(hashtext('pac_api_budget'))`;
    const t0 = Date.now();
    await expect(
      begin(sql, async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext('pac_api_budget'))`;
      }),
    ).rejects.toMatchObject({ code: "55P03" });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThan(9000);
    expect(elapsed).toBeLessThan(15000);
    await holder.unsafe("rollback");
    await holder.end();
  }, 30000);

  it("接続が壊れても、次の getDb で作り直して使える", async () => {
    const sql = await getDb();
    // サーバー側から接続を強制終了して「Vercel の待機中に切れた接続」を再現
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin`select pg_terminate_backend(pid) from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid() and application_name = ''`;
    await admin.end();
    void sql;
    // 生存確認の間隔を過ぎたことにする
    (globalThis as { __pacLastOkAt?: number }).__pacLastOkAt = 0;
    const sql2 = await getDb();
    const [r] = await sql2`select 1 as ok`;
    expect(r.ok).toBe(1);
  });
});
