import "server-only";
import postgres from "postgres";
import { MIGRATIONS } from "./schema";
import { SEED_DEPARTMENTS, SEED_EMPLOYEES } from "./seed";

export type Sql = postgres.Sql<Record<string, never>>;
export type Tx = postgres.TransactionSql<Record<string, never>>;
/** sql または トランザクション内の tx のどちらでも受け取れる型 */
export type Db = Sql | Tx;

type GlobalWithDb = typeof globalThis & {
  __pacSql?: Sql;
  __pacSchemaReady?: Promise<void>;
};
const g = globalThis as GlobalWithDb;

function createClient(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL が設定されていません");
  }
  const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  return postgres(url, {
    // Supabase の「Transaction pooler」接続では prepared statement が使えないため無効化
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: isLocal ? false : "require",
    onnotice: () => {},
    types: {
      // numeric 型を JavaScript の数値として受け取る（金額は小数点以下4桁程度なので精度は十分）
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
    },
  }) as unknown as Sql;
}

function getClient(): Sql {
  if (!g.__pacSql) g.__pacSql = createClient();
  return g.__pacSql;
}

async function runMigrations(sql: Sql) {
  await sql.begin(async (tx) => {
    // 複数のサーバーが同時に起動しても二重に実行しないようロックする
    await tx`select pg_advisory_xact_lock(hashtext('pac_schema_migrations'))`;
    await tx.unsafe(`create table if not exists schema_migrations (
      version int primary key, name text not null, applied_at timestamptz not null default now())`);
    const rows = await tx<{ version: number }[]>`select version from schema_migrations`;
    const applied = new Set(rows.map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      await tx.unsafe(m.sql);
      await tx`insert into schema_migrations (version, name) values (${m.version}, ${m.name})`;
    }
    await seed(tx);
  });
}

async function seed(tx: Tx) {
  await tx`insert into company_settings (id) values (1) on conflict do nothing`;
  await tx`insert into budgets (id) values (1) on conflict do nothing`;
  for (const d of SEED_DEPARTMENTS) {
    await tx`insert into departments ${tx(d)} on conflict (id) do nothing`;
  }
  for (const e of SEED_EMPLOYEES) {
    await tx`
      insert into employees (id, role_key, name, name_kana, role_title, department_id, personality,
        speaking_style, expertise, strengths, weaknesses, judgment_criteria, avatar_color, avatar_style, sort_order)
      values (${e.id}, ${e.role_key}, ${e.name}, ${e.name_kana}, ${e.role_title}, ${e.department_id},
        ${e.personality}, ${e.speaking_style}, ${tx.array(e.expertise)}, ${tx.array(e.strengths)},
        ${tx.array(e.weaknesses)}, ${e.judgment_criteria}, ${e.avatar_color}, ${e.avatar_style}, ${e.sort_order})
      on conflict (id) do nothing`;
  }
}

/**
 * データベース接続を取得します。初回のみ、表の作成と初期データ登録を自動で行います。
 */
export async function getDb(): Promise<Sql> {
  const sql = getClient();
  if (!g.__pacSchemaReady) {
    g.__pacSchemaReady = runMigrations(sql).catch((err) => {
      g.__pacSchemaReady = undefined;
      throw err;
    });
  }
  await g.__pacSchemaReady;
  return sql;
}

/** テスト用：接続を閉じる */
export async function closeDb() {
  if (g.__pacSql) {
    await g.__pacSql.end({ timeout: 5 });
    g.__pacSql = undefined;
    g.__pacSchemaReady = undefined;
  }
}
