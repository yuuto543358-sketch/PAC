"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { createStepLogger } from "@/lib/log";
import { audit } from "@/lib/repo/audit";
import { runMediaEngine } from "@/lib/mediaco/engine";
import { dispatchNotifications } from "@/lib/notify";
import { markArticlePublished, recordArticleMetrics, recordPost, updateBrandAccounts } from "@/lib/mediaco/repo";
import type { ActionState } from "@/components/forms";

const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });
const ok = (message: string): ActionState => ({ ok: true, message, ts: Date.now() });
const idOf = (fd: FormData) => {
  const id = String(fd.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("見つかりません");
  return id;
};

/** 「今すぐ動かす」：次にやるべき仕事を、バックグラウンドで最大6つ進める（予算の上限は通常どおり守る） */
export async function runMediaNowAction(): Promise<ActionState> {
  try {
    await assertAuth();
    after(async () => {
      try {
        const sql = await getDb();
        await runMediaEngine(sql, { maxSteps: 6, deadlineMs: 240_000, trigger: "manual" });
        // 記事ができた・承認のお願いなどの通知を送る
        await dispatchNotifications(sql);
      } catch (err) {
        createStepLogger("media").fail("manual run", err);
      }
    });
    return ok("AI社員が仕事を始めました。1〜3分後に画面を開き直すと、結果が見られます");
  } catch (e) {
    return fail(e);
  }
}

export async function markPublishedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await markArticlePublished(sql, idOf(fd), String(fd.get("url") ?? ""));
    refresh();
    return ok("公開済みにしました");
  } catch (e) {
    return fail(e);
  }
}

export async function recordMetricsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const r = await recordArticleMetrics(sql, idOf(fd), {
      views: Number(fd.get("views") ?? 0),
      likes: Number(fd.get("likes") ?? 0),
      sales: Number(fd.get("sales") ?? 0),
      revenueJpy: Number(fd.get("revenue") ?? 0),
    });
    refresh();
    return ok(r.addedIncome > 0 ? `記録しました（売上 ${r.addedIncome.toLocaleString("ja-JP")}円を、お金の記録にも入れました）` : "記録しました");
  } catch (e) {
    return fail(e);
  }
}

export async function recordPostAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await recordPost(sql, idOf(fd), {
      url: String(fd.get("url") ?? ""),
      impressions: Number(fd.get("impressions") ?? 0),
      likes: Number(fd.get("likes") ?? 0),
      reposts: Number(fd.get("reposts") ?? 0),
      clicks: Number(fd.get("clicks") ?? 0),
    });
    refresh();
    return ok("投稿済みとして記録しました");
  } catch (e) {
    return fail(e);
  }
}

export async function updateBrandAccountsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    await updateBrandAccounts(sql, idOf(fd), String(fd.get("note_url") ?? ""), String(fd.get("x_handle") ?? ""));
    refresh();
    return ok("アカウントを記録しました");
  } catch (e) {
    return fail(e);
  }
}

/** 自動実行の設定（予算の上限は「設定 → 予算」で経営者が変える。ここでは変えない） */
export async function updateMediaSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const enabled = fd.get("media_enabled") === "on";
    const perDay = Number(fd.get("media_articles_per_day"));
    const posts = Number(fd.get("media_posts_per_day"));
    if (!Number.isInteger(perDay) || perDay < 0 || perDay > 3) throw new Error("1日の記事数は0〜3本で選んでください");
    if (!Number.isInteger(posts) || posts < 0 || posts > 5) throw new Error("1日の投稿案は0〜5件で選んでください");
    const sql = await getDb();
    await sql`update company_settings set media_enabled = ${enabled}, media_articles_per_day = ${perDay},
      media_posts_per_day = ${posts}, updated_at = now() where id = 1`;
    await audit(sql, "owner", "media_settings", "company_settings", "1", { enabled, perDay, posts });
    refresh();
    return ok("自動実行の設定を保存しました");
  } catch (e) {
    return fail(e);
  }
}
