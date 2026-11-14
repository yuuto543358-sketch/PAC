"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { addLedgerEntry, voidLedgerEntry } from "@/lib/repo/ledger";
import type { ActionState } from "@/components/forms";

const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });

export async function addLedgerEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const amount = Number(String(fd.get("amount_jpy") ?? "").replace(/[,，円\s]/g, ""));
    const sql = await getDb();
    await addLedgerEntry(sql, {
      kind: String(fd.get("kind") ?? ""),
      amountJpy: amount,
      occurredOn: String(fd.get("occurred_on") ?? ""),
      category: String(fd.get("category") ?? ""),
      description: String(fd.get("description") ?? ""),
      businessProjectId: String(fd.get("business_project_id") ?? "") || null,
    });
    refresh();
    return { ok: true, message: "記録しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function voidLedgerEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await voidLedgerEntry(sql, String(fd.get("id") ?? ""), String(fd.get("reason") ?? ""));
    refresh();
    return { ok: true, message: "記録を取り消しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}
