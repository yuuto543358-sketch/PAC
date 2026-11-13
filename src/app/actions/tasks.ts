"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { PRIORITIES, TASK_STATUSES, type Priority, type TaskStatus } from "@/lib/constants";
import { addTaskLog, changeTaskStatus, createTask, updateTask } from "@/lib/repo/tasks";
import type { ActionState } from "@/components/forms";

function fail(e: unknown): ActionState {
  return { ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() };
}

function parsePriority(v: FormDataEntryValue | null): Priority {
  return (PRIORITIES as readonly string[]).includes(String(v)) ? (String(v) as Priority) : "medium";
}

async function validAssignee(id: string): Promise<string | null> {
  if (!id) return null;
  const sql = await getDb();
  const [row] = await sql`select id from employees where id = ${id} and is_active`;
  if (!row) throw new Error("担当社員が見つかりません");
  return id;
}

export async function createTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    await assertAuth();
    const sql = await getDb();
    const budgetRaw = String(fd.get("budget") ?? "").trim();
    const budget = budgetRaw === "" ? null : Number(budgetRaw);
    if (budget !== null && !(budget >= 0 && budget <= 10000)) throw new Error("業務予算は0〜10000円で入力してください");
    const r = await createTask(sql, {
      title: String(fd.get("title") ?? ""),
      description: String(fd.get("description") ?? ""),
      source: "user",
      priority: parsePriority(fd.get("priority")),
      assigneeId: await validAssignee(String(fd.get("assignee") ?? "")),
      dueDate: String(fd.get("due") ?? "") || null,
      budgetLimitJpy: budget,
      createdBy: { type: "user" },
    });
    if (!r.created) {
      return {
        ok: false,
        error: `似た業務「${r.duplicateOf.title}」がすでに登録されています（重複のため登録しませんでした）。`,
        ts: Date.now(),
      };
    }
    target = `/tasks/${r.task.id}`;
  } catch (e) {
    return fail(e);
  }
  redirect(target);
}

export async function changeTaskStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const to = String(fd.get("to") ?? "");
    if (!(TASK_STATUSES as readonly string[]).includes(to)) throw new Error("ステータスが正しくありません");
    const sql = await getDb();
    await changeTaskStatus(sql, String(fd.get("taskId")), to as TaskStatus, { type: "user" }, String(fd.get("note") ?? "").slice(0, 500));
    refresh();
    return { ok: true, message: "ステータスを変更しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function updateTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const budget = Number(fd.get("budget"));
    await updateTask(
      sql,
      String(fd.get("taskId")),
      {
        priority: parsePriority(fd.get("priority")),
        assigneeId: await validAssignee(String(fd.get("assignee") ?? "")),
        dueDate: String(fd.get("due") ?? "") || null,
        budgetLimitJpy: Number.isFinite(budget) ? budget : undefined,
      },
      { type: "user" },
    );
    refresh();
    return { ok: true, message: "保存しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function updateDeliverableAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await updateTask(sql, String(fd.get("taskId")), { deliverable: String(fd.get("deliverable") ?? "") }, { type: "user" });
    refresh();
    return { ok: true, message: "成果物を保存しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function addTaskCommentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const msg = String(fd.get("comment") ?? "").trim();
    if (!msg) throw new Error("コメントを入力してください");
    const sql = await getDb();
    const taskId = String(fd.get("taskId"));
    const [t] = await sql`select id from tasks where id = ${taskId}`;
    if (!t) throw new Error("業務が見つかりません");
    await addTaskLog(sql, taskId, { type: "user" }, "comment", msg.slice(0, 2000));
    refresh();
    return { ok: true, message: "コメントを記録しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}
