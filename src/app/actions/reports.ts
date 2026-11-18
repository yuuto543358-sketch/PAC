"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { generateCompanyReport } from "@/lib/autonomy/reports";
import type { ActionState } from "@/components/forms";

const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });

/** 「今すぐ報告書を作る」：社長に日報・週報・月報を書いてもらう */
export async function createReportNowAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const k = fd.get("kind");
    const kind = k === "weekly" ? "weekly" : k === "monthly" ? "monthly" : "daily";
    const sql = await getDb();
    const r = await generateCompanyReport(sql, kind, "manual");
    refresh();
    return { ok: true, message: r.message, ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}
