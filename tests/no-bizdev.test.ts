// 事業開発機能（事業の候補探し・事業の段階・運営レポート・事業ごとのお金）を完全に消したことのテスト。
// AIメディア会社の「事業開発部（朝日 ひかり）」は、メディアの仕事をしているので残す。
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";

beforeAll(async () => {
  await closeDb();
});
afterAll(async () => {
  await closeDb();
});

describe("事業開発機能は、もうない", () => {
  it("事業の候補の表がない", async () => {
    const sql = await getDb();
    const rows = await sql`select 1 from pg_tables where schemaname = 'public' and tablename = 'business_projects'`;
    expect(rows).toHaveLength(0);
  });

  it("業務・お金の記録・設定に、事業開発のための項目が残っていない", async () => {
    const sql = await getDb();
    const cols = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and (
        column_name = 'business_project_id'
        or (table_name = 'company_settings' and column_name in ('autorun_frequency','discovery_auto_start','last_discovery_on','last_ops_review_on')))`;
    expect(cols).toEqual([]);
  });

  it("事業の運営レポートは作れない（報告書の種類から外した）", async () => {
    const sql = await getDb();
    await expect(
      sql`insert into reports (report_type, title, content) values ('bizdev', 'x', 'x')`,
    ).rejects.toThrow();
  });

  it("お金の記録は、これまでどおり記録・取り消しのルールが守られる", async () => {
    const sql = await getDb();
    const [row] = await sql<{ id: string }[]>`
      insert into ledger_entries (kind, amount_jpy, occurred_on, category) values ('income', 100, current_date, '売上') returning id`;
    await expect(sql`update ledger_entries set amount_jpy = 5 where id = ${row.id}`).rejects.toThrow(/変更できません/);
    await expect(sql`delete from ledger_entries where id = ${row.id}`).rejects.toThrow(/削除できません/);
  });

  it("画面と仕組みのファイルが消えている", () => {
    for (const f of [
      "src/app/(app)/business",
      "src/lib/business",
      "src/lib/autonomy/discovery.ts",
      "src/lib/repo/business.ts",
      "src/app/actions/autonomy.ts",
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), f))).toBe(false);
    }
  });

  it("AIメディア会社の事業開発部（朝日 ひかり）は残っている", async () => {
    const sql = await getDb();
    const [dept] = await sql<{ name: string }[]>`select name from departments where id = 'bizdev'`;
    expect(dept?.name).toBe("事業開発部");
    const [emp] = await sql<{ name: string; is_active: boolean }[]>`select name, is_active from employees where id = 'bizdev'`;
    expect(emp).toMatchObject({ name: "朝日 ひかり", is_active: true });
  });
});
