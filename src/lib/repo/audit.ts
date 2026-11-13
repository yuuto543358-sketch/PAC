import "server-only";
import type { Db } from "@/lib/db";
import type postgres from "postgres";
type JSONValue = postgres.JSONValue;

/** 操作履歴を記録（追記のみ・変更削除不可） */
export async function audit(
  db: Db,
  actor: string,
  action: string,
  targetType = "",
  targetId = "",
  detail: Record<string, unknown> = {},
) {
  await db`
    insert into audit_logs (actor, action, target_type, target_id, detail)
    values (${actor}, ${action}, ${targetType}, ${targetId}, ${db.json(detail as JSONValue)})`;
}
