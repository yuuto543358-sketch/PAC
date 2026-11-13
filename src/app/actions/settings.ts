"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { getPricing } from "@/lib/pricing";
import { AUTORUN_OPTIONS } from "@/lib/constants";
import type { ActionState } from "@/components/forms";

const ok = (message: string): ActionState => ({ ok: true, message, ts: Date.now() });
const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "保存に失敗しました", ts: Date.now() });

function num(fd: FormData, key: string, min: number, max: number, label: string): number {
  const v = Number(fd.get(key));
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${label}は${min}〜${max}の数字で入力してください`);
  return v;
}

export async function updateCompanyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const name = String(fd.get("company_name") ?? "").trim();
    if (!name || name.length > 60) throw new Error("会社名は1〜60文字で入力してください");
    const philosophy = String(fd.get("philosophy") ?? "").trim().slice(0, 300);
    const rules = String(fd.get("custom_rules") ?? "").trim().slice(0, 3000);
    const sql = await getDb();
    await sql`update company_settings set company_name = ${name}, philosophy = ${philosophy}, custom_rules = ${rules}, updated_at = now() where id = 1`;
    await audit(sql, "user", "update_company");
    refresh();
    return ok("会社情報を保存しました");
  } catch (e) {
    return fail(e);
  }
}

export async function updateBudgetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const monthly = num(fd, "monthly_limit_jpy", 0, 100000, "月間上限");
    const target = num(fd, "monthly_target_jpy", 0, 100000, "通常利用目標");
    const emergency = num(fd, "emergency_stop_jpy", 0, 100000, "緊急停止ライン");
    const perTask = num(fd, "per_task_limit_jpy", 0, 10000, "1業務あたりの上限");
    const daily = num(fd, "daily_limit_jpy", 0, 100000, "1日あたりの上限");
    const callsTask = num(fd, "max_calls_per_task", 1, 100, "1業務あたりの呼び出し回数");
    const callsDay = num(fd, "max_calls_per_day", 1, 2000, "1日あたりの呼び出し回数");
    const callsMin = num(fd, "max_calls_per_minute", 1, 60, "1分あたりの呼び出し回数");
    if (emergency > monthly) throw new Error("緊急停止ラインは月間上限以下にしてください");
    if (target > emergency) throw new Error("通常利用目標は緊急停止ライン以下にしてください");
    const sql = await getDb();
    await sql`
      update budgets set monthly_limit_jpy = ${monthly}, monthly_target_jpy = ${target}, emergency_stop_jpy = ${emergency},
        per_task_limit_jpy = ${perTask}, daily_limit_jpy = ${daily}, max_calls_per_task = ${callsTask},
        max_calls_per_day = ${callsDay}, max_calls_per_minute = ${callsMin}, updated_at = now()
      where id = 1`;
    await audit(sql, "user", "update_budget", "budgets", "1", { monthly, target, emergency, perTask, daily });
    refresh();
    return ok("予算設定を保存しました");
  } catch (e) {
    return fail(e);
  }
}

export async function updateModelsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const standard = String(fd.get("model_standard") ?? "");
    const advanced = String(fd.get("model_advanced") ?? "");
    if (!getPricing(standard) || !getPricing(advanced)) throw new Error("選べないモデルが指定されました");
    const allowAdvanced = fd.get("advanced_model_allowed") === "on";
    const rate = num(fd, "usd_jpy_rate", 50, 500, "為替レート");
    const sql = await getDb();
    await sql`
      update company_settings set model_standard = ${standard}, model_advanced = ${advanced},
        advanced_model_allowed = ${allowAdvanced}, usd_jpy_rate = ${rate}, updated_at = now() where id = 1`;
    await audit(sql, "user", "update_models", "company_settings", "1", { standard, advanced, allowAdvanced, rate });
    refresh();
    return ok("AIモデル設定を保存しました");
  } catch (e) {
    return fail(e);
  }
}

export async function updateAutorunAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const freq = String(fd.get("autorun_frequency") ?? "off");
    if (!AUTORUN_OPTIONS.some((o) => o.id === freq)) throw new Error("頻度が正しくありません");
    const sql = await getDb();
    await sql`update company_settings set autorun_frequency = ${freq}, updated_at = now() where id = 1`;
    await audit(sql, "user", "update_autorun", "company_settings", "1", { freq });
    refresh();
    return ok("自動実行の頻度を保存しました（実際の自動実行は Phase 3 で有効になります）");
  } catch (e) {
    return fail(e);
  }
}

export async function updateOpsCostAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const v = num(fd, "hosting_cost_jpy_monthly", 0, 1000000, "運用料金");
    const sql = await getDb();
    await sql`update company_settings set hosting_cost_jpy_monthly = ${Math.round(v)}, updated_at = now() where id = 1`;
    await audit(sql, "user", "update_ops_cost", "company_settings", "1", { v });
    refresh();
    return ok("運用料金を保存しました");
  } catch (e) {
    return fail(e);
  }
}

export async function setEmergencyStopAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const on = fd.get("on") === "1";
    const sql = await getDb();
    await sql`update company_settings set emergency_stop = ${on}, updated_at = now() where id = 1`;
    await audit(sql, "user", on ? "emergency_stop_on" : "emergency_stop_off");
    refresh();
    return ok(on ? "緊急停止しました。AIの呼び出しはすべて止まります。" : "緊急停止を解除しました");
  } catch (e) {
    return fail(e);
  }
}
