"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import type { ActionState } from "@/components/forms";
import { AVATAR_STYLES } from "@/components/Avatar";

function err(e: unknown): ActionState {
  return { ok: false, error: e instanceof Error ? e.message : "保存に失敗しました", ts: Date.now() };
}

export async function rateEmployeeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const employeeId = String(fd.get("employeeId") ?? "");
    const rating = Number(fd.get("rating"));
    const comment = String(fd.get("comment") ?? "").trim().slice(0, 1000);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("評価を1〜5で選んでください");
    const sql = await getDb();
    const [e] = await sql`select id from employees where id = ${employeeId}`;
    if (!e) throw new Error("社員が見つかりません");
    await sql`insert into employee_ratings (employee_id, rating, comment) values (${employeeId}, ${rating}, ${comment})`;
    await audit(sql, "user", "rate_employee", "employee", employeeId, { rating });
    refresh();
    return { ok: true, message: "評価を記録しました", ts: Date.now() };
  } catch (e) {
    return err(e);
  }
}

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[\n、,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

/** 社員情報の変更（経営者のみ。AI社員には変更する手段がありません） */
export async function updateEmployeeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const id = String(fd.get("id") ?? "");
    const name = String(fd.get("name") ?? "").trim();
    if (!name || name.length > 40) throw new Error("名前は1〜40文字で入力してください");
    const color = String(fd.get("avatar_color") ?? "");
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("色の指定が正しくありません");
    const style = String(fd.get("avatar_style") ?? "");
    if (!AVATAR_STYLES.some((s) => s.id === style)) throw new Error("アバターの種類が正しくありません");
    const status = String(fd.get("status") ?? "idle");
    if (!["idle", "working", "offline"].includes(status)) throw new Error("稼働状態が正しくありません");
    const t = (k: string, max = 1000) => String(fd.get(k) ?? "").trim().slice(0, max);
    const sql = await getDb();
    const res = await sql`
      update employees set name = ${name}, name_kana = ${t("name_kana", 60)}, role_title = ${t("role_title", 60) || "社員"},
        personality = ${t("personality")}, speaking_style = ${t("speaking_style")},
        expertise = ${lines(fd.get("expertise"))}::text[], strengths = ${lines(fd.get("strengths"))}::text[],
        weaknesses = ${lines(fd.get("weaknesses"))}::text[], judgment_criteria = ${t("judgment_criteria")},
        avatar_color = ${color}, avatar_style = ${style}, status = ${status}, updated_at = now()
      where id = ${id}`;
    if (res.count === 0) throw new Error("社員が見つかりません");
    await audit(sql, "user", "update_employee", "employee", id, { name });
    refresh();
    return { ok: true, message: "社員情報を保存しました", ts: Date.now() };
  } catch (e) {
    return err(e);
  }
}
