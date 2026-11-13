import "server-only";
import type { JSONValue } from "postgres";
import type { Db } from "@/lib/db";

export type Conversation = {
  id: string;
  employee_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
  message_count: number;
};

export type ChatMessage = {
  id: number;
  conversation_id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  meta: { kind?: string; href?: string; tone?: "info" | "warn" | "error"; costJpy?: number };
  created_at: Date;
};

export async function listConversations(db: Db, employeeId: string): Promise<Conversation[]> {
  return db<Conversation[]>`
    select c.*, (select count(*) from conversation_messages m where m.conversation_id = c.id)::int as message_count
    from conversations c where c.employee_id = ${employeeId} order by c.updated_at desc limit 30`;
}

export async function getConversation(db: Db, id: string): Promise<Conversation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db<Conversation[]>`
    select c.*, 0 as message_count from conversations c where c.id = ${id}`;
  return row ?? null;
}

export async function latestConversation(db: Db, employeeId: string): Promise<Conversation | null> {
  const [row] = await db<Conversation[]>`
    select c.*, 0 as message_count from conversations c where c.employee_id = ${employeeId}
    order by c.updated_at desc limit 1`;
  return row ?? null;
}

export async function createConversation(db: Db, employeeId: string, title: string): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into conversations (employee_id, title) values (${employeeId}, ${title.slice(0, 60)}) returning id`;
  return row.id;
}

export async function listMessages(db: Db, conversationId: string, limit = 100): Promise<ChatMessage[]> {
  const rows = await db<ChatMessage[]>`
    select * from (
      select * from conversation_messages where conversation_id = ${conversationId} order by id desc limit ${limit}
    ) x order by id`;
  return rows;
}

export async function addMessage(
  db: Db,
  conversationId: string,
  role: ChatMessage["role"],
  content: string,
  meta: ChatMessage["meta"] = {},
  apiUsageId: string | null = null,
) {
  await db`
    insert into conversation_messages (conversation_id, role, content, meta, api_usage_id)
    values (${conversationId}, ${role}, ${content}, ${db.json(meta as JSONValue)}, ${apiUsageId})`;
  await db`update conversations set updated_at = now() where id = ${conversationId}`;
}

/** 社長からの最新メッセージ（ホーム画面用） */
export async function latestPresidentMessage(db: Db) {
  const [row] = await db<{ content: string; created_at: Date; conversation_id: string }[]>`
    select m.content, m.created_at, m.conversation_id from conversation_messages m
    join conversations c on c.id = m.conversation_id
    where c.employee_id = 'president' and m.role = 'assistant'
    order by m.id desc limit 1`;
  return row ?? null;
}
