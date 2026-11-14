import "server-only";
import { begin, type Db, type Sql } from "@/lib/db";
import { audit } from "@/lib/repo/audit";

// 生活情報の保存・読み出し。
// ・記録は回答ごとに1行で、上書きしない（変化の前後が両方残る）
// ・修正すると、修正前の値が「修正の履歴」に残る
// ・削除すると、その記録と履歴を完全に消す（操作履歴には「消した」ことだけを残し、中身は残さない）

export type LifeCategory = {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  ai_allowed: boolean;
};

export type LifeField = {
  id: string;
  category_id: string;
  label: string;
  value_type: "number" | "text" | "choice";
  unit: string;
  choices: string[];
  kind: "state" | "periodic";
  period: "none" | "week" | "month";
  refresh_days: number;
  importance: number;
  question: string;
  reason: string;
  depends_on: string;
  is_active: boolean;
  sort_order: number;
  created_by: string;
};

export type LifeRecord = {
  id: string;
  field_id: string;
  value_num: number | null;
  value_text: string;
  period_start: string | null;
  period_end: string | null;
  source: "owner" | "auto" | "ai_estimate";
  confidence: "high" | "medium" | "low";
  note: string;
  question_id: string | null;
  confirmed_at: Date;
  created_at: Date;
  updated_at: Date;
  edit_count: number;
};

export type LifeHistory = {
  id: number;
  record_id: string;
  old_value_num: number | null;
  old_value_text: string;
  new_value_num: number | null;
  new_value_text: string;
  reason: string;
  changed_at: Date;
};

const RECORD_COLS = `r.id, r.field_id, r.value_num, r.value_text,
  to_char(r.period_start, 'YYYY-MM-DD') as period_start, to_char(r.period_end, 'YYYY-MM-DD') as period_end,
  r.source, r.confidence, r.note, r.question_id, r.confirmed_at, r.created_at, r.updated_at,
  (select count(*) from life_record_history h where h.record_id = r.id)::int as edit_count`;

export async function listCategories(db: Db): Promise<LifeCategory[]> {
  return db<LifeCategory[]>`select id, name, description, sort_order, is_active, ai_allowed from life_categories order by sort_order, id`;
}

export async function listFields(db: Db, opts: { activeOnly?: boolean } = {}): Promise<LifeField[]> {
  const rows = await db<LifeField[]>`
    select f.* from life_fields f join life_categories c on c.id = f.category_id
    order by c.sort_order, f.sort_order, f.id`;
  return opts.activeOnly ? rows.filter((f) => f.is_active) : rows;
}

export async function getField(db: Db, id: string): Promise<LifeField | null> {
  const [f] = await db<LifeField[]>`select * from life_fields where id = ${id}`;
  return f ?? null;
}

/** 項目ごとの、いちばん新しい記録 */
export async function latestRecords(db: Db): Promise<Map<string, LifeRecord>> {
  const rows = await db.unsafe<LifeRecord[]>(
    `select distinct on (r.field_id) ${RECORD_COLS} from life_records r
     order by r.field_id, coalesce(r.period_end, (r.confirmed_at at time zone 'Asia/Tokyo')::date) desc, r.confirmed_at desc`,
    [],
    { simple: false },
  );
  return new Map(rows.map((r) => [r.field_id, r]));
}

export async function listRecords(db: Db, fieldId: string, limit = 100): Promise<LifeRecord[]> {
  return db.unsafe<LifeRecord[]>(
    `select ${RECORD_COLS} from life_records r where r.field_id = $1
     order by coalesce(r.period_end, (r.confirmed_at at time zone 'Asia/Tokyo')::date) desc, r.confirmed_at desc limit ${Math.min(Math.max(limit, 1), 500)}`,
    [fieldId],
  );
}

/** 指定した日以降の記録（分析用） */
export async function recordsSince(db: Db, sinceDate: string): Promise<LifeRecord[]> {
  return db.unsafe<LifeRecord[]>(
    `select ${RECORD_COLS} from life_records r
     where coalesce(r.period_end, (r.confirmed_at at time zone 'Asia/Tokyo')::date) >= $1::date
     order by coalesce(r.period_end, (r.confirmed_at at time zone 'Asia/Tokyo')::date), r.confirmed_at`,
    [sinceDate],
  );
}

export async function getRecord(db: Db, id: string): Promise<LifeRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.unsafe<LifeRecord[]>(`select ${RECORD_COLS} from life_records r where r.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function recordHistory(db: Db, recordId: string): Promise<LifeHistory[]> {
  return db<LifeHistory[]>`select * from life_record_history where record_id = ${recordId} order by id desc`;
}

export type ParsedValue = { num: number | null; text: string };

/** 入力された値を、項目の種類に合わせて確かめる（数字は数字だけ、選択肢は選択肢の中から） */
export function parseValue(field: Pick<LifeField, "value_type" | "choices" | "label">, raw: string): ParsedValue {
  const s = raw.trim();
  if (!s) throw new Error("値を入力してください");
  if (field.value_type === "number") {
    const n = Number(s.normalize("NFKC").replace(/[,，円\s]|kg|分|時間/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000_000) throw new Error(`「${field.label}」は0以上の数字で入力してください`);
    return { num: Math.round(n * 100) / 100, text: "" };
  }
  if (field.value_type === "choice") {
    if (!field.choices.includes(s)) throw new Error("選択肢の中から選んでください");
    return { num: null, text: s };
  }
  if (s.length > 2000) throw new Error("2000文字以内で入力してください");
  return { num: null, text: s };
}

export function formatRecordValue(field: Pick<LifeField, "value_type" | "unit">, r: Pick<LifeRecord, "value_num" | "value_text">): string {
  if (field.value_type === "number" && r.value_num != null) {
    const n = Number(r.value_num);
    const unit = field.unit || "";
    const yen = unit.startsWith("円");
    return `${n.toLocaleString("ja-JP")}${yen ? unit : unit ? ` ${unit}` : ""}`;
  }
  return r.value_text;
}

export type NewRecord = {
  fieldId: string;
  raw: string;
  source?: "owner" | "auto" | "ai_estimate";
  confidence?: "high" | "medium" | "low";
  periodStart?: string | null;
  periodEnd?: string | null;
  note?: string;
  questionId?: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function addRecord(db: Db, input: NewRecord): Promise<string> {
  const field = await getField(db, input.fieldId);
  if (!field) throw new Error("項目が見つかりません");
  const v = parseValue(field, input.raw);
  const ps = input.periodStart && DATE_RE.test(input.periodStart) ? input.periodStart : null;
  const pe = input.periodEnd && DATE_RE.test(input.periodEnd) ? input.periodEnd : null;
  const [row] = await db<{ id: string }[]>`
    insert into life_records (field_id, value_num, value_text, period_start, period_end, source, confidence, note, question_id)
    values (${field.id}, ${v.num}, ${v.text}, ${ps}, ${pe}, ${input.source ?? "owner"}, ${input.confidence ?? "high"},
      ${(input.note ?? "").slice(0, 500)}, ${input.questionId ?? null})
    returning id`;
  return row.id;
}

/** 記録を直す。直す前の値は「修正の履歴」に残る */
export async function updateRecord(sql: Sql, id: string, raw: string, reason: string) {
  await begin(sql, async (tx) => {
    const [r] = await tx<{ field_id: string; value_num: number | null; value_text: string }[]>`
      select field_id, value_num, value_text from life_records where id = ${id} for update`;
    if (!r) throw new Error("記録が見つかりません");
    const field = await getField(tx, r.field_id);
    if (!field) throw new Error("項目が見つかりません");
    const v = parseValue(field, raw);
    await tx`
      insert into life_record_history (record_id, old_value_num, old_value_text, new_value_num, new_value_text, reason)
      values (${id}, ${r.value_num}, ${r.value_text}, ${v.num}, ${v.text}, ${reason.trim().slice(0, 300)})`;
    await tx`
      update life_records set value_num = ${v.num}, value_text = ${v.text}, source = 'owner', confidence = 'high',
        confirmed_at = now(), updated_at = now()
      where id = ${id}`;
    await audit(tx, "owner", "life_record_updated", "life_record", id, { field: r.field_id });
  });
}

/** 記録を完全に消す（履歴もいっしょに消える）。操作履歴には中身を残さない */
export async function deleteRecord(sql: Sql, id: string) {
  await begin(sql, async (tx) => {
    const [r] = await tx<{ field_id: string }[]>`delete from life_records where id = ${id} returning field_id`;
    if (!r) throw new Error("記録が見つかりません");
    await audit(tx, "owner", "life_record_deleted", "life_record", id, { field: r.field_id });
  });
}

/** 「いまも同じです」：記録の確認日だけを新しくする（値は変えない） */
export async function confirmRecord(sql: Sql, id: string) {
  const rows = await sql`update life_records set confirmed_at = now() where id = ${id} returning id`;
  if (rows.length === 0) throw new Error("記録が見つかりません");
}

export async function setCategoryFlags(sql: Sql, id: string, flags: { is_active: boolean; ai_allowed: boolean }) {
  const rows = await sql`
    update life_categories set is_active = ${flags.is_active}, ai_allowed = ${flags.ai_allowed} where id = ${id} returning id`;
  if (rows.length === 0) throw new Error("カテゴリが見つかりません");
  await audit(sql, "owner", "life_category_updated", "life_category", id, flags);
}
