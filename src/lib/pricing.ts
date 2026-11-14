// AIモデル（OpenAI）の料金表（米ドル / 100万トークン）。
// 料金が変わったら、OpenAI 公式の料金ページ（https://openai.com/api/pricing/）を見てここを更新してください。
// 表にないモデルは「費用が分からない」ため、安全のため呼び出しを拒否します。

export type ModelPricing = {
  label: string;
  inputPerMTok: number;
  /** キャッシュされた入力（2回目以降の共通部分）の料金 */
  cachedInputPerMTok: number;
  outputPerMTok: number;
  /** 1回に送る入力の上限トークン数（これを超える呼び出しは拒否する） */
  maxPromptTokens: number;
  tier: "standard" | "advanced";
};

export const PRICING: Record<string, ModelPricing> = {
  "gpt-5-nano": {
    label: "GPT-5 nano（最安・簡単な作業向け）",
    inputPerMTok: 0.05,
    cachedInputPerMTok: 0.005,
    outputPerMTok: 0.4,
    maxPromptTokens: 100_000,
    tier: "standard",
  },
  "gpt-5-mini": {
    label: "GPT-5 mini（低価格・通常業務向け）",
    inputPerMTok: 0.25,
    cachedInputPerMTok: 0.025,
    outputPerMTok: 2,
    maxPromptTokens: 100_000,
    tier: "standard",
  },
  "gpt-5": {
    label: "GPT-5（高性能・高価格）",
    inputPerMTok: 1.25,
    cachedInputPerMTok: 0.125,
    outputPerMTok: 10,
    maxPromptTokens: 100_000,
    tier: "advanced",
  },
};

/**
 * キャッシュ書き込みとして報告された入力トークンに上乗せする倍率（安全側の見積もり）。
 * 見積もりでは入力全体にこの倍率をかけ、実費でもキャッシュ書き込み分に上乗せして多めに数えます。
 */
export const CACHE_WRITE_SURCHARGE = 0.25;

/**
 * Web検索1回あたりの料金（米ドル）。OpenAI の Web検索ツールは「1,000回あたり10ドル前後＋読んだ内容の入力トークン」と
 * されていますが、確認できていないため、安全のため 2.5倍の 0.025ドル/回 で数えます（実際より多めに記録）。
 * 正確な料金が分かったら、ここを更新してください。
 */
export const WEB_SEARCH_CALL_USD = 0.025;

/** 見積もりに上乗せする安全係数 */
export const ESTIMATE_SAFETY_FACTOR = 1.2;

export function getPricing(model: string): ModelPricing | null {
  return Object.prototype.hasOwnProperty.call(PRICING, model) ? PRICING[model] : null;
}

/**
 * 呼び出し前の概算費用（円）。出力は上限トークン数まで使い切った「最悪の場合」で見積もる。
 * （推論モデルの「考える」トークンも出力として課金され、上限トークン数に含まれます）
 */
export function estimateCostJpy(
  model: string,
  estInputTokens: number,
  maxOutputTokens: number,
  usdJpyRate: number,
): number | null {
  const p = getPricing(model);
  if (!p) return null;
  const usd =
    (estInputTokens * p.inputPerMTok * (1 + CACHE_WRITE_SURCHARGE) + maxOutputTokens * p.outputPerMTok) / 1_000_000;
  return usd * usdJpyRate * ESTIMATE_SAFETY_FACTOR;
}

export type UsageLike = {
  /** 入力トークン数（キャッシュ分を含む合計） */
  input_tokens?: number | null;
  /** 出力トークン数（推論トークンを含む） */
  output_tokens?: number | null;
  /** そのうちキャッシュから読まれた入力 */
  cached_input_tokens?: number | null;
  /** そのうちキャッシュに書き込まれた入力 */
  cache_write_tokens?: number | null;
  /** Web検索の回数 */
  web_search_calls?: number | null;
};

/** 実際の使用量から費用（米ドル）を計算。料金表にないモデルは null。 */
export function actualCostUsd(model: string, usage: UsageLike): number | null {
  const p = getPricing(model);
  if (!p) return null;
  const input = Math.max(0, usage.input_tokens ?? 0);
  const cached = Math.min(input, Math.max(0, usage.cached_input_tokens ?? 0));
  const cacheWrite = Math.max(0, usage.cache_write_tokens ?? 0);
  const output = Math.max(0, usage.output_tokens ?? 0);
  return (
    ((input - cached) * p.inputPerMTok +
      cached * p.cachedInputPerMTok +
      cacheWrite * p.inputPerMTok * CACHE_WRITE_SURCHARGE +
      output * p.outputPerMTok) /
      1_000_000 +
    Math.max(0, usage.web_search_calls ?? 0) * WEB_SEARCH_CALL_USD
  );
}

/**
 * 入力トークン数のざっくりした見積もり（多めに見積もる）。
 * 日本語は1文字 ≒ 1トークン前後のため、文字数 × 1.5 + 余裕分 とする。
 */
export function roughTokenCount(text: string): number {
  return Math.ceil(text.length * 1.5) + 20;
}
