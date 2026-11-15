"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { remakeMissingMedia } from "@/lib/media/produce";
import type { ActionState } from "@/components/forms";

/** 「足りない絵と声を作る」：作れなかった絵・声だけを、もう一度作る（費用はふつうどおり予算の中で記録される） */
export async function remakeMediaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const taskId = String(fd.get("taskId") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error("業務が見つかりません");
    const sql = await getDb();
    const r = await remakeMissingMedia(sql, taskId);
    refresh();
    return r.ok ? { ok: true, message: "絵と声を作りました", ts: Date.now() } : { ok: false, error: r.message, ts: Date.now() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() };
  }
}
