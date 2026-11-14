import "server-only";
import postgres from "postgres";
import { MIGRATIONS } from "./schema";
import { LIFE_CATEGORIES, LIFE_FIELDS } from "@/lib/life/catalog";
import { SEED_DEPARTMENTS, SEED_EMPLOYEES } from "./seed";
import { parseDatabaseUrl, type DatabaseUrlInfo } from "./url";
import { createStepLogger, TimeoutError, withTimeout, type StepLogger } from "@/lib/log";

export type Sql = postgres.Sql<Record<string, never>>;
export type Tx = postgres.TransactionSql<Record<string, never>>;
/** sql または トランザクション内の tx のどちらでも受け取れる型 */
export type Db = Sql | Tx;

// ===== 待ち時間の上限（無限に待たないための設定） =====
/** 接続の確立にかける最大秒数 */
const CONNECT_TIMEOUT_SEC = 10;
/** これより長く使っていない接続は、使う前に生きているか確認する（Vercel では待機中に接続が切れることがある） */
const HEALTH_CHECK_AFTER_MS = 15_000;
/** 生存確認（select 1）の最大待ち時間 */
const PING_TIMEOUT_MS = 12_000;
/** 表の作成・確認の最大待ち時間 */
const SCHEMA_TIMEOUT_MS = 45_000;
/**
 * 1つの問い合わせ（クエリ）の最大待ち時間（秒）。接続待ちと実行の合計。
 * プール（Supabase の pooler）が答えを返さなくなっても、ここで必ずエラーになり、接続は作り直される。
 */
const QUERY_TIMEOUT_SEC = Number(process.env.PAC_DB_QUERY_TIMEOUT_SEC) || 20;
/** 空いている接続を待つ最大時間（秒） */
const QUEUE_TIMEOUT_SEC = 15;
/** トランザクション内のロック待ち・処理・放置の上限（サーバー側で強制） */
const TX_LOCK_TIMEOUT = "10s";
const TX_STATEMENT_TIMEOUT = "30s";
const TX_IDLE_TIMEOUT = "30s";

const MIGRATION_LOCK_KEY = "pac_schema_migrations";
const LATEST_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

type GlobalWithDb = typeof globalThis & {
  __pacSql?: Sql;
  __pacSchemaReady?: Promise<void>;
  __pacLastOkAt?: number;
};
const g = globalThis as GlobalWithDb;

const bootLog = createStepLogger("db");

/** 接続の設定（サーバーレス・Supabase Transaction pooler 向け）。テストでも同じ設定を使う。 */
export function clientOptions(kind: DatabaseUrlInfo["kind"]) {
  return {
    // Supabase の「Transaction pooler」では prepared statement が使えないため無効化
    prepare: false,
    // サーバーレス（Vercel）向け：1つのサーバーが持つ接続は少なく、使わない接続はすぐ閉じる
    max: 3,
    // 1つの接続に同時に送る問い合わせは1つだけにする。
    // Supabase の Transaction pooler（Supavisor 2.10 より前）は、まとめて送った問い合わせ（パイプライン）の
    // 答えが返ってこない不具合があるため（postgres.js の公式説明より）。
    max_pipeline: 1,
    query_timeout: QUERY_TIMEOUT_SEC,
    queue_timeout: QUEUE_TIMEOUT_SEC,
    idle_timeout: 10,
    max_lifetime: 60 * 5,
    connect_timeout: CONNECT_TIMEOUT_SEC,
    ssl: kind === "local" ? (false as const) : ("require" as const),
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
  };
}

function createClient(): Sql {
  const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!parsed.ok) {
    throw new Error(`DATABASE_URL の設定に問題があります: ${parsed.problems.join(" / ")}`);
  }
  const { info } = parsed;
  // パスワードは出さず、接続先の種類だけをログに出す
  bootLog.step("create client", { host: info.host, port: info.port, user: info.user, database: info.database, kind: info.kind });
  for (const w of parsed.warnings) console.warn(`[pac][db] 注意: ${w}`);
  return postgres(parsed.url, clientOptions(info.kind)) as unknown as Sql;
}

function getClient(): Sql {
  if (!g.__pacSql) g.__pacSql = createClient();
  return g.__pacSql;
}

/** 壊れた可能性のある接続を捨てる（次に使うときに作り直される） */
async function resetClient() {
  const old = g.__pacSql;
  g.__pacSql = undefined;
  g.__pacSchemaReady = undefined;
  g.__pacLastOkAt = undefined;
  if (old) {
    await old.end({ timeout: 0 }).catch(() => {});
  }
}

/**
 * トランザクションの中で、ロック待ち・処理時間・放置時間の上限を設定する。
 * （Vercel の処理が途中で止まっても、データベース側で自動的に打ち切られ、ロックが残り続けない）
 */
export async function applyTxTimeouts(tx: Tx, statementTimeout = TX_STATEMENT_TIMEOUT) {
  await tx`
    select set_config('lock_timeout', ${TX_LOCK_TIMEOUT}, true),
           set_config('statement_timeout', ${statementTimeout}, true),
           set_config('idle_in_transaction_session_timeout', ${TX_IDLE_TIMEOUT}, true)`;
}

/** 待ち時間の上限つきでトランザクションを実行する。アプリ内のトランザクションはすべてこれを使う。 */
export async function begin<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await applyTxTimeouts(tx);
    return fn(tx);
  })) as T;
}

async function isSchemaUpToDate(sql: Sql): Promise<boolean> {
  const [st] = await sql<{ has_table: boolean }[]>`
    select to_regclass('public.schema_migrations') is not null as has_table`;
  if (!st.has_table) return false;
  const [v] = await sql<{ v: number }[]>`select coalesce(max(version), 0)::int as v from schema_migrations`;
  if (v.v < LATEST_VERSION) return false;
  const [s] = await sql<{ ok: boolean }[]>`
    select exists(select 1 from company_settings where id = 1)
       and exists(select 1 from budgets where id = 1)
       and exists(select 1 from employees) as ok`;
  return Boolean(s?.ok);
}

/**
 * 以前の処理が途中で止まって「トランザクションを開いたまま放置」され、
 * 表の作成用のロックを持ち続けている接続があれば終了させる（30秒以上放置されたものだけ）。
 */
async function releaseStaleMigrationLock(sql: Sql, log: StepLogger) {
  try {
    const rows = await sql<{ pid: number; terminated: boolean }[]>`
      select a.pid, pg_terminate_backend(a.pid) as terminated
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory' and l.granted and l.objsubid = 1
        and l.objid::bigint = (hashtext(${MIGRATION_LOCK_KEY})::bigint & 4294967295)
        and a.state like 'idle in transaction%'
        and a.state_change < now() - interval '30 seconds'
        and a.pid <> pg_backend_pid()`;
    log.step("released stale migration locks", { count: rows.length });
  } catch (err) {
    log.fail("release stale migration locks", err);
  }
}

async function runMigrations(sql: Sql, log: StepLogger) {
  await sql.begin(async (tx) => {
    await applyTxTimeouts(tx, "60s");
    // 複数のサーバーが同時に起動しても二重に実行しないようロックする（10秒で諦める）
    await tx`select pg_advisory_xact_lock(hashtext(${MIGRATION_LOCK_KEY}))`;
    log.step("migration lock acquired");
    await tx.unsafe(`create table if not exists schema_migrations (
      version int primary key, name text not null, applied_at timestamptz not null default now())`);
    const rows = await tx<{ version: number }[]>`select version from schema_migrations`;
    const applied = new Set(rows.map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      log.step("apply migration", { version: m.version, name: m.name });
      await tx.unsafe(m.sql);
      await tx`insert into schema_migrations (version, name) values (${m.version}, ${m.name})`;
    }
    await seed(tx);
    log.step("seed done");
  });
}

async function ensureSchema(sql: Sql, log: StepLogger) {
  // ふだんは表がすでに揃っているので、ロックを取らずに確認だけして終わる
  if (await isSchemaUpToDate(sql)) {
    log.step("schema up to date");
    return;
  }
  log.step("schema needs setup", { latest: LATEST_VERSION });
  try {
    await runMigrations(sql, log);
  } catch (err) {
    // ロック待ちの上限に達した（55P03）→ 放置されたロックを解放して1回だけやり直す
    if ((err as { code?: string }).code === "55P03") {
      log.fail("migration lock timeout", err);
      await releaseStaleMigrationLock(sql, log);
      await runMigrations(sql, log);
    } else {
      throw err;
    }
  }
  log.step("schema ready");
}

async function seed(tx: Tx) {
  await tx`insert into company_settings (id) values (1) on conflict do nothing`;
  await tx`insert into budgets (id) values (1) on conflict do nothing`;
  for (const d of SEED_DEPARTMENTS) {
    await tx`insert into departments ${tx(d)} on conflict (id) do nothing`;
  }
  // ライフインテリジェンスのカテゴリと項目（表があるときだけ。なければ追加、あれば変えない）
  const [hasLife] = await tx<{ ok: boolean }[]>`select to_regclass('life_fields') is not null as ok`;
  if (hasLife?.ok) {
    for (const c of LIFE_CATEGORIES) {
      await tx`insert into life_categories ${tx(c)} on conflict (id) do nothing`;
    }
    for (const f of LIFE_FIELDS) {
      await tx`
        insert into life_fields (id, category_id, label, value_type, unit, choices, kind, period, refresh_days,
          importance, question, reason, depends_on, sort_order)
        values (${f.id}, ${f.category_id}, ${f.label}, ${f.value_type}, ${f.unit ?? ""}, ${f.choices ?? []}::text[],
          ${f.kind ?? "state"}, ${f.period ?? "none"}, ${f.refresh_days}, ${f.importance}, ${f.question}, ${f.reason},
          ${f.depends_on ?? ""}, ${f.sort_order})
        on conflict (id) do nothing`;
    }
  }
  for (const e of SEED_EMPLOYEES) {
    await tx`
      insert into employees (id, role_key, name, name_kana, role_title, department_id, personality,
        speaking_style, expertise, strengths, weaknesses, judgment_criteria, avatar_color, avatar_style, sort_order)
      values (${e.id}, ${e.role_key}, ${e.name}, ${e.name_kana}, ${e.role_title}, ${e.department_id},
        ${e.personality}, ${e.speaking_style}, ${e.expertise}::text[], ${e.strengths}::text[],
        ${e.weaknesses}::text[], ${e.judgment_criteria}, ${e.avatar_color}, ${e.avatar_style}, ${e.sort_order})
      on conflict (id) do nothing`;
  }
}

async function ping(sql: Sql) {
  await withTimeout(sql`select 1 as ok`, PING_TIMEOUT_MS, "データベースへの接続確認");
}

/**
 * データベース接続を取得します。
 * - しばらく使っていなかった接続は、生きているか確認し、ダメなら作り直します。
 * - 初回のみ、表の作成と初期データ登録を自動で行います（すでに済んでいればロックは取りません）。
 * - どの段階も上限時間があり、無限に待つことはありません。
 */
export async function getDb(log: StepLogger = bootLog): Promise<Sql> {
  let sql = getClient();

  if (Date.now() - (g.__pacLastOkAt ?? 0) > HEALTH_CHECK_AFTER_MS) {
    try {
      await ping(sql);
      log.step("db ping ok");
    } catch (err) {
      log.fail("db ping", err);
      await resetClient();
      sql = getClient();
      await ping(sql);
      log.step("db ping ok after reconnect");
    }
  }

  if (!g.__pacSchemaReady) {
    g.__pacSchemaReady = withTimeout(ensureSchema(sql, log), SCHEMA_TIMEOUT_MS, "データベースの準備").catch(
      async (err) => {
        g.__pacSchemaReady = undefined;
        // 時間切れのときは、その接続が固まっている可能性があるので作り直す
        if (err instanceof TimeoutError) await resetClient();
        throw err;
      },
    );
  }
  await g.__pacSchemaReady;
  g.__pacLastOkAt = Date.now();
  return sql;
}

/** 処理が時間切れになったときに呼ぶ：固まった可能性のある接続を捨て、次回は新しく接続する */
export async function resetDb() {
  await resetClient();
}

/** テスト用：接続を閉じる */
export async function closeDb() {
  if (g.__pacSql) {
    await g.__pacSql.end({ timeout: 5 });
  }
  g.__pacSql = undefined;
  g.__pacSchemaReady = undefined;
  g.__pacLastOkAt = undefined;
}
