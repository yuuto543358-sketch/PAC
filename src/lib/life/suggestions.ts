import "server-only";
import { begin, type Db, type Sql } from "@/lib/db";
import { LIFE_SUGGESTION_STATUSES, LIFE_SUGGESTION_STATUS_LABEL, type LifeSuggestionStatus } from "@/lib/constants";
import { audit } from "@/lib/repo/audit";

export type LifeSuggestion = {
  id: string;
  title: string;
  problem: string;
  evidence: string;
  benefit: string;
  cost_text: string;
  difficulty: string;
  priority: "high" | "medium" | "low";
  recommendation: string;
  is_estimate: boolean;
  category_id: string | null;
  category_name: string | null;
  related_field_ids: string[];
  status: LifeSuggestionStatus;
  needs_team: boolean;
  task_id: string | null;
  task_title: string | null;
  task_status: string | null;
  report_id: string | null;
  owner_note: string;
  created_at: Date;
  updated_at: Date;
};

const SELECT = `
  select s.*, c.name as category_name, t.title as task_title, t.status as task_status
  from life_suggestions s
  left join life_categories c on c.id = s.category_id
  left join tasks t on t.id = s.task_id`;

export async function listSuggestions(db: Db, status?: string): Promise<LifeSuggestion[]> {
  if (status && (LIFE_SUGGESTION_STATUSES as readonly string[]).includes(status)) {
    return db.unsafe<LifeSuggestion[]>(
      `${SELECT} where s.status = $1 order by case s.priority when 'high' then 0 when 'medium' then 1 else 2 end, s.created_at desc limit 100`,
      [status],
    );
  }
  return db.unsafe<LifeSuggestion[]>(`${SELECT} order by s.created_at desc limit 100`, [], { simple: false });
}

export async function getSuggestion(db: Db, id: string): Promise<LifeSuggestion | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.unsafe<LifeSuggestion[]>(`${SELECT} where s.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function countSuggestionsByStatus(db: Db): Promise<Record<string, number>> {
  const rows = await db<{ status: string; n: number }[]>`select status, count(*)::int as n from life_suggestions group by status`;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function setSuggestionStatus(sql: Sql, id: string, status: string, note: string) {
  if (!(LIFE_SUGGESTION_STATUSES as readonly string[]).includes(status)) throw new Error("状態の指定が正しくありません");
  await begin(sql, async (tx) => {
    const [s] = await tx<{ status: string }[]>`select status from life_suggestions where id = ${id} for update`;
    if (!s) throw new Error("提案が見つかりません");
    const n = note.trim().slice(0, 1000);
    await tx`
      update life_suggestions set status = ${status}, owner_note = ${n || tx`owner_note`}, updated_at = now() where id = ${id}`;
    await audit(tx, "owner", "life_suggestion_status", "life_suggestion", id, {
      from: s.status,
      to: status,
      label: LIFE_SUGGESTION_STATUS_LABEL[status as LifeSuggestionStatus],
    });
  });
}
