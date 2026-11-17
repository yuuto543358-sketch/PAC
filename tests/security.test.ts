// Supabase のセキュリティ（rls_disabled_in_public）のテスト。
// このアプリはサーバーからデータベースの持ち主として接続するだけで、Supabase の公開用の役割（anon / authenticated）は使わない。
// だから「公開用の役割からは、どの表も読めない・書けない」ことを確かめる。
// （テスト用のデータベースには、Supabase と同じ名前の役割を作ってから確かめる）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";

beforeAll(async () => {
  await closeDb();
  const sql = await getDb();
  await sql.unsafe(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$`);
  // 役割を作ったあとで、最新の設定（RLS・拒否のポリシー）をかけ直す（本番では、役割は最初からある）
  await sql`delete from schema_migrations where version = 16`;
  await closeDb();
  await getDb();
});
afterAll(async () => {
  await closeDb();
});

describe("Supabase の公開用の役割からは、データに触れない", () => {
  it("public のすべての表で RLS が有効", async () => {
    const sql = await getDb();
    const off = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by tablename`;
    expect(off.map((r) => r.tablename)).toEqual([]);
  });

  it("すべての表に「公開用の役割は何もできない」ポリシーが付いている", async () => {
    const sql = await getDb();
    const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
    const policies = await sql<{ tablename: string; permissive: string; roles: string[]; cmd: string; qual: string; with_check: string }[]>`
      select tablename, permissive, roles::text[] as roles, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and policyname = 'pac_deny_client_roles'`;
    expect(policies.length).toBe(tables.length);
    for (const p of policies) {
      expect(p.permissive).toBe("RESTRICTIVE");
      expect([...p.roles].sort()).toEqual(["anon", "authenticated"]);
      expect(p.cmd).toBe("ALL");
      expect(p.qual).toBe("false");
      expect(p.with_check).toBe("false");
    }
  });

  it("公開用の役割には、表の権限が付いていない", async () => {
    const sql = await getDb();
    const granted = await sql<{ table_name: string; grantee: string }[]>`
      select table_name, grantee from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')`;
    expect(granted).toEqual([]);
  });

  it("もし誰かがうっかり権限を付けても、RLS のおかげで読めない・書けない", async () => {
    const sql = await getDb();
    const tables = (await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`).map((r) => r.tablename);
    const counts: Record<string, number> = {};
    let insertError = "";
    await sql
      .begin(async (tx) => {
        await tx.unsafe(`grant usage on schema public to anon`);
        await tx.unsafe(`grant select, insert, update, delete on all tables in schema public to anon`);
        await tx.unsafe(`set local role anon`);
        for (const t of tables) {
          const [r] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public."${t}"`);
          counts[t] = r.n;
        }
        try {
          await tx.unsafe(`savepoint s1`);
          await tx.unsafe(`insert into public.schema_migrations (version, name) values (99999, 'x')`);
        } catch (e) {
          insertError = e instanceof Error ? e.message : String(e);
          await tx.unsafe(`rollback to savepoint s1`);
        }
        throw new Error("rollback"); // 付けた権限は元に戻す
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== "rollback") throw e;
      });
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(Object.keys(counts).length).toBe(tables.length);
    expect(insertError).toMatch(/row-level security/);
    // 持ち主（アプリ）は、ふつうに読める
    const [own] = await sql<{ n: number }[]>`select count(*)::int as n from schema_migrations`;
    expect(own.n).toBeGreaterThan(0);
  });
});
