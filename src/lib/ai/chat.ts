import "server-only";
import { z } from "zod";
import type { Sql } from "@/lib/db";
import { APPROVAL_ACTION_TYPES, APPROVAL_ACTION_LABEL } from "@/lib/constants";
import { BudgetBlockedError } from "@/lib/budget";
import { AiUnavailableError, callStructured, type ChatTurn } from "@/lib/ai/client";
import { buildChatSystemPrompt } from "@/lib/ai/prompts";
import { getSettings } from "@/lib/repo/settings";
import { listEmployees } from "@/lib/repo/employees";
import { listTasks, createTask } from "@/lib/repo/tasks";
import { createApproval } from "@/lib/repo/approvals";
import { addMessage, createConversation, getConversation, listMessages } from "@/lib/repo/conversations";
import { audit } from "@/lib/repo/audit";

export const ChatOutputSchema = z.object({
  reply: z.string().describe("経営者への返答（日本語）"),
  proposed_tasks: z
    .array(
      z.object({
        title: z.string().describe("業務名（40字以内）"),
        description: z.string().describe("業務の内容・目的・完了条件"),
        assignee_id: z.string().describe("担当社員の id"),
        priority: z.enum(["high", "medium", "low"]),
        due_date: z.string().nullable().describe("期限 YYYY-MM-DD または null"),
        origin: z.enum(["user_request", "ai_suggestion"]),
      }),
    )
    .describe("登録する業務（なければ空配列）"),
  approval_requests: z
    .array(
      z.object({
        action_type: z.enum(APPROVAL_ACTION_TYPES),
        title: z.string().describe("承認依頼の件名"),
        content: z.string().describe("実行する内容そのもの"),
        destination: z.string().describe("実行先（宛先・サービス名・URLなど）"),
        reason: z.string().describe("実行する理由"),
        estimated_cost_jpy: z.number().describe("発生する費用（円）"),
        risks: z.string().describe("想定されるリスク"),
        after_effect: z.string().describe("承認後に何が起こるか"),
        related_task_title: z.string().nullable().describe("関連する業務名（同じ返答で登録した業務など）"),
      }),
    )
    .describe("承認依頼（なければ空配列）"),
});
export type ChatOutput = z.infer<typeof ChatOutputSchema>;

const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS_IN_HISTORY = 1500;
export const MAX_USER_MESSAGE_CHARS = 2000;

export type SendChatResult = {
  conversationId: string;
  ok: boolean;
  error?: string;
};

function todayJst() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

/** テスト用モックの応答（AI_MOCK=1 のときだけ使われる） */
function mockReply(employeeName: string, employeeId: string, text: string): ChatOutput {
  const wantsTask = /業務|調べ|調査|作って|企画|お願い/.test(text);
  const wantsApproval = /送信|送って|投稿|購入|公開/.test(text);
  const title = text.replace(/\s+/g, " ").slice(0, 30);
  return {
    reply: `【テスト用モック応答】${employeeName}です。「${text.slice(0, 40)}」承知しました。${
      wantsTask ? "業務として登録します。" : ""
    }${wantsApproval ? "外部への操作になるため、承認依頼を提出します。" : ""}`,
    proposed_tasks: wantsTask
      ? [
          {
            title: `${title}`,
            description: `経営者からの依頼: ${text.slice(0, 200)}`,
            assignee_id: employeeId === "president" ? "research" : employeeId,
            priority: "medium",
            due_date: null,
            origin: "user_request",
          },
        ]
      : [],
    approval_requests: wantsApproval
      ? [
          {
            action_type: "send_message",
            title: `送信の承認依頼: ${title}`,
            content: `（送信する本文の例）${text.slice(0, 200)}`,
            destination: "example@example.com",
            reason: "経営者からの依頼のため",
            estimated_cost_jpy: 0,
            risks: "宛先の間違い・内容の誤り",
            after_effect: "承認後、実行機能が実装されると送信されます（現在は記録のみ）",
            related_task_title: wantsTask ? title : null,
          },
        ]
      : [],
  };
}

/**
 * 社員とのチャット。1回のメッセージにつきAI呼び出しは1回だけです。
 */
export async function sendChatMessage(
  sql: Sql,
  employeeId: string,
  conversationId: string | null,
  rawText: string,
  useAdvanced: boolean,
): Promise<SendChatResult> {
  const text = rawText.trim();
  if (!text) throw new Error("メッセージを入力してください");
  if (text.length > MAX_USER_MESSAGE_CHARS) throw new Error(`メッセージは${MAX_USER_MESSAGE_CHARS}文字以内にしてください`);

  const roster = await listEmployees(sql);
  const employee = roster.find((e) => e.id === employeeId);
  if (!employee) throw new Error("社員が見つかりません");

  let convId = conversationId;
  if (convId) {
    const conv = await getConversation(sql, convId);
    if (!conv || conv.employee_id !== employeeId) throw new Error("会話が見つかりません");
  } else {
    convId = await createConversation(sql, employeeId, text);
  }

  // 過去の会話は直近の分だけ送る（すべての履歴を毎回送らない）
  const history = await listMessages(sql, convId, MAX_HISTORY_MESSAGES);
  await addMessage(sql, convId, "user", text);

  const settings = await getSettings(sql);
  const openTasks = await listTasks(sql, { view: "active" }, 15);
  const system = buildChatSystemPrompt({ settings, employee, roster, openTasks, todayJst: todayJst() });

  const messages: ChatTurn[] = [];
  for (const m of history) {
    if (m.role === "notice") continue;
    const content = m.content.slice(0, MAX_MESSAGE_CHARS_IN_HISTORY);
    if (messages.length === 0 && m.role !== "user") continue; // 最初は user から始める
    messages.push({ role: m.role, content });
  }
  messages.push({ role: "user", content: text });

  const model = useAdvanced ? settings.model_advanced : settings.model_standard;

  let result;
  try {
    result = await callStructured(sql, {
      model,
      effort: useAdvanced ? "medium" : "low",
      maxTokens: useAdvanced ? 4000 : 2500,
      system,
      messages,
      schema: ChatOutputSchema,
      schemaName: "employee_chat_reply",
      purpose: `chat:${employeeId}`,
      employeeId,
      conversationId: convId,
      mock: () => mockReply(employee.name, employee.id, text),
    });
  } catch (err) {
    if (err instanceof BudgetBlockedError || err instanceof AiUnavailableError) {
      await addMessage(sql, convId, "notice", err.message, { tone: "error", kind: "error" });
      return { conversationId: convId, ok: false, error: err.message };
    }
    console.error("chat error", err);
    const msg = "エラーが発生しました。時間をおいてもう一度お試しください。";
    await addMessage(sql, convId, "notice", msg, { tone: "error", kind: "error" });
    return { conversationId: convId, ok: false, error: msg };
  }

  if (!result.ok) {
    await addMessage(sql, convId, "notice", result.message, { tone: "warn", kind: "error", costJpy: result.costJpy });
    return { conversationId: convId, ok: false, error: result.message };
  }

  const out = result.data;
  await addMessage(sql, convId, "assistant", out.reply.slice(0, 8000), { costJpy: result.costJpy }, result.usageId);
  await sql`update employees set experience_points = experience_points + 1 where id = ${employeeId}`;

  // 業務の登録（最大3件）。社長以外は自分にしか割り当てられない。
  const validIds = new Set(roster.map((e) => e.id));
  const createdTasks = new Map<string, string>();
  for (const t of out.proposed_tasks.slice(0, 3)) {
    const assignee =
      employee.role_key === "president" ? (validIds.has(t.assignee_id) ? t.assignee_id : null) : employee.id;
    try {
      const r = await createTask(sql, {
        title: t.title,
        description: t.description,
        source: t.origin === "user_request" ? "user" : "ai_discovered",
        priority: t.priority,
        assigneeId: assignee,
        dueDate: t.due_date,
        createdBy: { type: "employee", employeeId },
      });
      if (r.created) {
        createdTasks.set(t.title.trim(), r.task.id);
        const who = roster.find((e) => e.id === assignee)?.name ?? "未定";
        await addMessage(sql, convId, "notice", `業務を登録しました：「${r.task.title}」（担当: ${who}）`, {
          kind: "task_created",
          href: `/tasks/${r.task.id}`,
          tone: "info",
        });
      } else {
        createdTasks.set(t.title.trim(), r.duplicateOf.id);
        await addMessage(
          sql,
          convId,
          "notice",
          `似た業務「${r.duplicateOf.title}」がすでにあるため、新しく登録しませんでした。`,
          { kind: "task_duplicate", href: `/tasks/${r.duplicateOf.id}`, tone: "info" },
        );
      }
    } catch (err) {
      console.error("task create from chat failed", err);
    }
  }

  // 承認依頼（最大1件）
  for (const a of out.approval_requests.slice(0, 1)) {
    try {
      const taskId = a.related_task_title ? (createdTasks.get(a.related_task_title.trim()) ?? null) : null;
      const id = await createApproval(sql, {
        taskId,
        requestedByEmployeeId: employeeId,
        actionType: a.action_type,
        title: a.title,
        content: a.content,
        reason: a.reason,
        destination: a.destination,
        estimatedCostJpy: Math.max(0, a.estimated_cost_jpy || 0),
        risks: a.risks,
        afterEffect: a.after_effect,
      });
      await addMessage(
        sql,
        convId,
        "notice",
        `承認依頼を提出しました：「${a.title}」（${APPROVAL_ACTION_LABEL[a.action_type]}）。承認センターで確認してください。`,
        { kind: "approval_created", href: `/approvals/${id}`, tone: "warn" },
      );
    } catch (err) {
      console.error("approval create from chat failed", err);
    }
  }

  await audit(sql, `employee:${employeeId}`, "chat_reply", "conversation", convId, {
    model,
    costJpy: result.costJpy,
    tasks: out.proposed_tasks.length,
    approvals: out.approval_requests.length,
  });
  return { conversationId: convId, ok: true };
}
