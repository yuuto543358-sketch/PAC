"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { jstDateParts } from "@/lib/format";
import { runDueSeries, updateSeries } from "@/lib/series";
import { scheduleTeamRun } from "@/lib/workflow/trigger";
import type { ActionState } from "@/components/forms";

const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });

/** シリーズの間隔・オン/オフを変える */
export async function updateSeriesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const id = String(fd.get("id") ?? "");
    const op = String(fd.get("op") ?? "save");
    const interval = Number(fd.get("interval_days") ?? 3);
    if (!Number.isFinite(interval) || interval < 1 || interval > 30) throw new Error("間隔は1〜30日で選んでください");
    const sql = await getDb();
    const today = jstDateParts(new Date()).date;
    if (op === "stop") await updateSeries(sql, id, { active: false }, today);
    else if (op === "start") await updateSeries(sql, id, { active: true, intervalDays: interval }, today);
    else await updateSeries(sql, id, { intervalDays: interval }, today);
    refresh();
    return { ok: true, message: op === "stop" ? "シリーズを止めました" : op === "start" ? "シリーズを再開しました" : "間隔を変えました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/** 「次の回を今すぐ作る」：予定日を今日にして、すぐ作り始める（作っている途中・承認待ちが多いときは作らない） */
export async function startNextEpisodeNowAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const id = String(fd.get("id") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("シリーズが見つかりません");
    const sql = await getDb();
    const today = jstDateParts(new Date()).date;
    await sql`update content_series set next_run_on = ${today}::date, updated_at = now() where id = ${id} and active`;
    const r = await runDueSeries(sql);
    const mine = r.created.filter((c) => c.seriesId === id);
    if (mine.length) scheduleTeamRun(mine.map((c) => c.taskId));
    refresh();
    if (mine.length) return { ok: true, message: `第${mine[0].episode}回を作り始めました`, ts: Date.now() };
    const why = r.waiting.find(Boolean);
    return { ok: false, error: why ? `今は作りません：${why}` : "止まっているシリーズは作れません。先に再開してください。", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}
