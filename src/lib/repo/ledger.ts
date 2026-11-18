import "server-only";
import { begin, type Db, type Sql } from "@/lib/db";
import { LEDGER_CATEGORIES, LEDGER_KINDS, type LedgerKind } from "@/lib/constants";
import { audit } from "./audit";

// 収益・費用の記録（経営者が入力する「お小遣い帳」）。
// 記録は変更・削除できません。間違えたときは「取り消し」にして、新しく記録します。

export type LedgerEntry = {
  id: string;
  kind: LedgerKind;
  amount_jpy: number;
  occurred_on: string;
  category: string;
  description: string;
  voided_at: Date | null;
  void_reason: string;
  created_at: Date;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type NewLedgerEntry = {
  kind: string;
  amountJpy: number;
  occurredOn: string;
  category: string;
  description: string;
};

export async function addLedgerEntry(sql: Sql, input: NewLedgerEntry): Promise<string> {
  if (!(LEDGER_KINDS as readonly string[]).includes(input.kind)) throw new Error("収益か費用かを選んでください");
  const kind = input.kind as LedgerKind;
  const amount = Math.round(input.amountJpy);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) throw new Error("金額は1円〜1億円で入力してください");
  if (!DATE_RE.test(input.occurredOn)) throw new Error("日付が正しくありません");
  const category = LEDGER_CATEGORIES[kind].includes(input.category) ? input.category : LEDGER_CATEGORIES[kind].at(-1)!;
  return begin(sql, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into ledger_entries (kind, amount_jpy, occurred_on, category, description)
      values (${kind}, ${amount}, ${input.occurredOn}::date, ${category}, ${input.description.trim().slice(0, 500)})
      returning id`;
    await audit(tx, "owner", "ledger_added", "ledger_entry", row.id, { kind, amount, category });
    return row.id;
  });
}

export async function voidLedgerEntry(sql: Sql, id: string, reason: string) {
  const r = reason.trim().slice(0, 300);
  if (!r) throw new Error("取り消す理由を入力してください");
  await begin(sql, async (tx) => {
    const [e] = await tx<{ voided_at: Date | null }[]>`select voided_at from ledger_entries where id = ${id} for update`;
    if (!e) throw new Error("記録が見つかりません");
    if (e.voided_at) throw new Error("この記録はすでに取り消されています");
    await tx`update ledger_entries set voided_at = now(), void_reason = ${r} where id = ${id}`;
    await audit(tx, "owner", "ledger_voided", "ledger_entry", id, { reason: r });
  });
}

export async function listLedgerEntries(
  db: Db,
  opts: { limit?: number } = {},
): Promise<LedgerEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 300);
  return db<LedgerEntry[]>`
    select l.*, to_char(l.occurred_on, 'YYYY-MM-DD') as occurred_on
    from ledger_entries l
    order by l.occurred_on desc, l.created_at desc limit ${limit}`;
}

export type MoneySummary = { income: number; expense: number };

const MONTH_START_DATE = `date_trunc('month', now() at time zone 'Asia/Tokyo')::date`;

/** 今月（日本時間）と、これまでの合計。取り消した記録は数えない */
export async function ledgerTotals(db: Db): Promise<{ month: MoneySummary; total: MoneySummary }> {
  const [r] = await db.unsafe<{ mi: number; me: number; ti: number; te: number }[]>(
    `select
      coalesce(sum(amount_jpy) filter (where kind = 'income' and occurred_on >= ${MONTH_START_DATE}), 0)::float8 as mi,
      coalesce(sum(amount_jpy) filter (where kind = 'expense' and occurred_on >= ${MONTH_START_DATE}), 0)::float8 as me,
      coalesce(sum(amount_jpy) filter (where kind = 'income'), 0)::float8 as ti,
      coalesce(sum(amount_jpy) filter (where kind = 'expense'), 0)::float8 as te
    from ledger_entries where voided_at is null`,
    [],
    { simple: false },
  );
  return { month: { income: r.mi, expense: r.me }, total: { income: r.ti, expense: r.te } };
}

export type MonthRow = { month: string; income: number; expense: number; api: number };

/** 月ごとの収益・費用・AI利用料（直近 months か月、日本時間） */
export async function monthlyMoney(db: Db, months = 6): Promise<MonthRow[]> {
  const n = Math.min(Math.max(Math.floor(months), 1), 24);
  return db.unsafe<MonthRow[]>(
    `with m as (
       select to_char(d, 'YYYY-MM') as month from generate_series(
         ${MONTH_START_DATE} - interval '${n - 1} months', ${MONTH_START_DATE}, interval '1 month') d
     ),
     l as (
       select to_char(occurred_on, 'YYYY-MM') as month,
         sum(amount_jpy) filter (where kind = 'income') as income,
         sum(amount_jpy) filter (where kind = 'expense') as expense
       from ledger_entries where voided_at is null group by 1
     ),
     a as (
       select to_char(created_at at time zone 'Asia/Tokyo', 'YYYY-MM') as month,
         sum(coalesce(cost_jpy, estimated_cost_jpy)) as api
       from api_usage group by 1
     )
     select m.month, coalesce(l.income, 0)::float8 as income, coalesce(l.expense, 0)::float8 as expense,
       coalesce(a.api, 0)::float8 as api
     from m left join l using (month) left join a using (month) order by m.month`,
    [],
    { simple: false },
  );
}
