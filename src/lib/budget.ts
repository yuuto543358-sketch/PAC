import "server-only";
import { begin, type Db, type Sql } from "@/lib/db";
import { actualCostUsd, ESTIMATE_SAFETY_FACTOR, estimateCostJpy, getPricing, type UsageLike } from "@/lib/pricing";
import { getBudget, getSettings } from "@/lib/repo/settings";

/** 予算などの理由でAI呼び出しを止めたときのエラー（利用者に表示してよい内容） */
export class BudgetBlockedError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BudgetBlockedError";
  }
}

// 「今月」「今日」は日本時間で数える
const MONTH_START = `date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'`;
const DAY_START = `date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'`;

/**
 * 集計に使う費用。確定していれば実費、未確定（予約中・不明）なら見積額で数える（安全側）。
 */
const COST_EXPR = `coalesce(cost_jpy, estimated_cost_jpy)`;

export type SpendSummary = {
  monthJpy: number;
  todayJpy: number;
  callsToday: number;
  callsLastMinute: number;
};

/**
 * 今月・今日の使用額と呼び出し回数。集計（sum/count）なので、利用記録が0件でも必ず1行（0円）返る。
 * 1行も返らないのは通信の異常なので、0円として扱わずエラーにする（予算の上限チェックを素通りさせないため）。
 */
export async function getSpendSummary(db: Db): Promise<SpendSummary> {
  const rows = await db.unsafe<
    { month_jpy: number; today_jpy: number; calls_today: number; calls_last_minute: number }[]
  >(`
    select
      coalesce(sum(${COST_EXPR}) filter (where created_at >= ${MONTH_START}), 0)::float8 as month_jpy,
      coalesce(sum(${COST_EXPR}) filter (where created_at >= ${DAY_START}), 0)::float8 as today_jpy,
      count(*) filter (where created_at >= ${DAY_START})::int as calls_today,
      count(*) filter (where created_at >= now() - interval '1 minute')::int as calls_last_minute
    from api_usage
    where created_at >= least(${MONTH_START}, now() - interval '1 minute')
  `, [], { simple: false });
  const row = rows[0];
  if (!row) {
    throw new Error("API利用額の集計結果を取得できませんでした（データベースの応答が不正）");
  }
  return {
    monthJpy: row.month_jpy,
    todayJpy: row.today_jpy,
    callsToday: row.calls_today,
    callsLastMinute: row.calls_last_minute,
  };
}

export type ReserveInput = {
  model: string;
  purpose: string;
  estInputTokens: number;
  maxOutputTokens: number;
  employeeId?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  /** トークン以外にかかる最大費用（米ドル。Web検索など） */
  extraMaxUsd?: number;
};

export type Reservation = {
  usageId: string;
  model: string;
  estimatedCostJpy: number;
  usdJpyRate: number;
};

/**
 * AIを呼び出す前に必ず通す関門。
 * 予算・回数制限をすべて確認し、問題なければ「予約」として見積額を記録します。
 * 同時に複数の呼び出しが来ても上限を超えないよう、ロックをかけて順番に処理します。
 */
export async function reserveApiCall(sql: Sql, input: ReserveInput): Promise<Reservation> {
  return begin(sql, async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('pac_api_budget'))`;
    const settings = await getSettings(tx);
    const budget = await getBudget(tx);

    if (settings.emergency_stop) {
      throw new BudgetBlockedError(
        "緊急停止中のため、AIの呼び出しを止めています。設定画面で解除できます。",
        "emergency_stop",
      );
    }

    const pricing = getPricing(input.model);
    if (!pricing) {
      throw new BudgetBlockedError(
        `モデル「${input.model}」の料金が分からないため、安全のため呼び出しを止めました。`,
        "unknown_pricing",
      );
    }
    if (pricing.tier === "advanced" && !settings.advanced_model_allowed) {
      throw new BudgetBlockedError(
        "高性能モデルの利用は設定で許可されていません。",
        "advanced_model_not_allowed",
      );
    }
    if (input.estInputTokens > pricing.maxPromptTokens) {
      throw new BudgetBlockedError("送信する内容が長すぎるため、呼び出しを止めました。", "prompt_too_long");
    }

    const rate = Number(settings.usd_jpy_rate);
    if (!(rate > 0)) {
      throw new BudgetBlockedError("為替レートの設定が正しくありません。", "invalid_rate");
    }
    const tokenEstimate = estimateCostJpy(input.model, input.estInputTokens, input.maxOutputTokens, rate);
    const estimate =
      tokenEstimate === null ? null : tokenEstimate + Math.max(0, input.extraMaxUsd ?? 0) * rate * ESTIMATE_SAFETY_FACTOR;
    if (estimate === null || !Number.isFinite(estimate)) {
      throw new BudgetBlockedError("費用を見積もれないため、安全のため呼び出しを止めました。", "estimate_failed");
    }

    let spend: SpendSummary;
    try {
      spend = await getSpendSummary(tx);
    } catch (err) {
      console.error("[pac][budget] FAILED spend summary", err);
      throw new BudgetBlockedError(
        "API利用額を確認できなかったため、安全のためAIの呼び出しを止めました。少し待ってからもう一度お試しください。",
        "spend_unknown",
      );
    }
    const hardMonthly = Math.min(budget.monthly_limit_jpy, budget.emergency_stop_jpy);
    if (spend.monthJpy + estimate > hardMonthly) {
      throw new BudgetBlockedError(
        `今月のAPI利用額が上限（緊急停止ライン ${hardMonthly.toLocaleString("ja-JP")}円）に達するため、新しいAI処理を止めました。`,
        "monthly_limit",
      );
    }
    if (spend.todayJpy + estimate > budget.daily_limit_jpy) {
      throw new BudgetBlockedError(
        `今日のAPI利用額が1日の上限（${budget.daily_limit_jpy.toLocaleString("ja-JP")}円）に達するため、止めました。明日になるか、設定で上限を変更してください。`,
        "daily_limit",
      );
    }
    if (spend.callsToday >= budget.max_calls_per_day) {
      throw new BudgetBlockedError(
        `今日のAI呼び出し回数が上限（${budget.max_calls_per_day}回）に達しました。`,
        "daily_calls",
      );
    }
    if (spend.callsLastMinute >= budget.max_calls_per_minute) {
      throw new BudgetBlockedError(
        "短時間に呼び出しが集中したため、無限ループ防止のため一時停止しました。1分ほど待ってください。",
        "rate_limit",
      );
    }

    if (input.taskId) {
      const [task] = await tx<{ budget_limit_jpy: number; ai_call_count: number; spent: number }[]>`
        select t.budget_limit_jpy, t.ai_call_count,
          coalesce((select sum(coalesce(u.cost_jpy, u.estimated_cost_jpy)) from api_usage u where u.task_id = t.id), 0)::float8 as spent
        from tasks t where t.id = ${input.taskId} for update`;
      if (!task) throw new BudgetBlockedError("対象の業務が見つかりません。", "task_not_found");
      if (task.ai_call_count >= budget.max_calls_per_task) {
        throw new BudgetBlockedError(
          `この業務のAI呼び出し回数が上限（${budget.max_calls_per_task}回）に達しました。`,
          "task_calls",
        );
      }
      if (task.spent + estimate > task.budget_limit_jpy) {
        throw new BudgetBlockedError(
          `この業務の予算上限（${task.budget_limit_jpy}円）を超えるため止めました。`,
          "task_budget",
        );
      }
      await tx`update tasks set ai_call_count = ai_call_count + 1, updated_at = now() where id = ${input.taskId}`;
    }

    const [row] = await tx<{ id: string }[]>`
      insert into api_usage (employee_id, task_id, conversation_id, purpose, model, status,
        estimated_cost_jpy, usd_jpy_rate)
      values (${input.employeeId ?? null}, ${input.taskId ?? null}, ${input.conversationId ?? null},
        ${input.purpose}, ${input.model}, 'reserved', ${estimate}, ${rate})
      returning id`;
    return { usageId: row.id, model: input.model, estimatedCostJpy: estimate, usdJpyRate: rate };
  });
}

/** 呼び出し成功後：実際の使用量で確定する。使用量が取れなければ見積額のまま「不明」として記録（安全側）。 */
export async function finalizeApiCall(
  db: Db,
  reservation: Reservation,
  usage: UsageLike | null | undefined,
  requestId?: string | null,
) {
  const usd = usage ? actualCostUsd(reservation.model, usage) : null;
  if (usd === null || !usage) {
    await db`
      update api_usage set status = 'unknown', cost_jpy = estimated_cost_jpy, completed_at = now(),
        error = '使用量を取得できなかったため見積額で記録', request_id = ${requestId ?? null}
      where id = ${reservation.usageId} and status = 'reserved'`;
    return { costJpy: reservation.estimatedCostJpy, known: false };
  }
  const jpy = usd * reservation.usdJpyRate;
  await db`
    update api_usage set status = 'completed',
      input_tokens = ${usage.input_tokens ?? 0}, output_tokens = ${usage.output_tokens ?? 0},
      cache_read_tokens = ${usage.cached_input_tokens ?? 0},
      cache_write_tokens = ${usage.cache_write_tokens ?? 0},
      web_search_calls = ${usage.web_search_calls ?? 0},
      cost_usd = ${usd}, cost_jpy = ${jpy}, completed_at = now(), request_id = ${requestId ?? null}
    where id = ${reservation.usageId} and status = 'reserved'`;
  return { costJpy: jpy, known: true };
}

/**
 * 呼び出し失敗時。
 * - billedUnknown=false: APIがエラーを返した（課金されない）→ 0円で記録
 * - billedUnknown=true : 通信切断など課金の有無が分からない → 見積額で記録（安全側）
 */
export async function failApiCall(db: Db, reservation: Reservation, error: string, billedUnknown: boolean) {
  if (billedUnknown) {
    await db`
      update api_usage set status = 'unknown', cost_jpy = estimated_cost_jpy, error = ${error.slice(0, 500)},
        completed_at = now()
      where id = ${reservation.usageId} and status = 'reserved'`;
  } else {
    await db`
      update api_usage set status = 'failed', cost_jpy = 0, error = ${error.slice(0, 500)}, completed_at = now()
      where id = ${reservation.usageId} and status = 'reserved'`;
  }
}
