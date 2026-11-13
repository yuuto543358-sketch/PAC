// AIモデルの料金表（米ドル / 100万トークン）。
// 出典: Anthropic 公式の料金（2026年11月時点）。料金が変わったらここを更新してください。
// 表にないモデルは「費用が分からない」ため、安全のため呼び出しを拒否します。

export type ModelPricing = {
  inputPerMTok: number;
  outputPerMTok: number;
  /** この入力トークン数を超えると別料金になるモデル用（超える呼び出しは拒否する） */
  maxPromptTokens: number;
  tier: "standard" | "advanced";
};

export const PRICING: Record<string, ModelPricing> = {
  // Haiku 5.5 はプロンプトが10万トークン以下なら $0.10 / $0.50。超えると高くなるため9万で打ち切る。
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5, maxPromptTokens: 90_000, tier: "standard" },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, maxPromptTokens: 200_000, tier: "advanced" },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, maxPromptTokens: 200_000, tier: "advanced" },
};

/** キャッシュ書き込み・読み込みの料金倍率（入力料金に対して） */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

/** 見積もりに上乗せする安全係数 */
export const ESTIMATE_SAFETY_FACTOR = 1.2;

export function getPricing(model: string): ModelPricing | null {
  return PRICING[model] ?? null;
}

/**
 * 呼び出し前の概算費用（円）。出力は上限トークン数まで使い切った「最悪の場合」で見積もる。
 */
export function estimateCostJpy(
  model: string,
  estInputTokens: number,
  maxOutputTokens: number,
  usdJpyRate: number,
): number | null {
  const p = getPricing(model);
  if (!p) return null;
  // 入力はキャッシュ書き込み（1.25倍）になる可能性も含めて見積もる
  const usd =
    (estInputTokens * p.inputPerMTok * CACHE_WRITE_MULTIPLIER + maxOutputTokens * p.outputPerMTok) / 1_000_000;
  return usd * usdJpyRate * ESTIMATE_SAFETY_FACTOR;
}

export type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** 実際の使用量から費用（米ドル）を計算。料金表にないモデルは null。 */
export function actualCostUsd(model: string, usage: UsageLike): number | null {
  const p = getPricing(model);
  if (!p) return null;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  return (
    (input * p.inputPerMTok +
      cw * p.inputPerMTok * CACHE_WRITE_MULTIPLIER +
      cr * p.inputPerMTok * CACHE_READ_MULTIPLIER +
      output * p.outputPerMTok) /
    1_000_000
  );
}

/**
 * 入力トークン数のざっくりした見積もり（多めに見積もる）。
 * 日本語は1文字 ≒ 1トークン前後のため、文字数 × 1.5 + 余裕分 とする。
 */
export function roughTokenCount(text: string): number {
  return Math.ceil(text.length * 1.5) + 20;
}
