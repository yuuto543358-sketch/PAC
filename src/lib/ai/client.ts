import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Sql } from "@/lib/db";
import { BudgetBlockedError, failApiCall, finalizeApiCall, reserveApiCall } from "@/lib/budget";
import { roughTokenCount } from "@/lib/pricing";

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export function isMockMode() {
  return process.env.AI_MOCK === "1";
}

export function isAiConfigured() {
  return isMockMode() || Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiUnavailableError(
      "AIのAPIキー（ANTHROPIC_API_KEY）が設定されていません。READMEの手順で設定してください。",
    );
  }
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // 自動リトライは費用の二重計上の原因になるため行わない（失敗したら利用者が再実行する）
      maxRetries: 0,
      timeout: 90_000,
    });
  }
  return client;
}

export type StructuredCallInput<T extends z.ZodType> = {
  model: string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  schema: T;
  purpose: string;
  employeeId?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  /** テスト用モックモードで返す内容 */
  mock: () => z.infer<T>;
};

export type StructuredCallResult<T> =
  | { ok: true; data: T; usageId: string; costJpy: number; costKnown: boolean }
  | { ok: false; reason: "refusal" | "truncated" | "invalid"; message: string; usageId: string; costJpy: number };

/**
 * AIを1回だけ呼び出し、決められた形式（JSON）で結果を受け取ります。
 * 呼び出し前に必ず予算チェック（reserveApiCall）を通し、結果の費用を記録します。
 * ループはしません（1回の操作につきAI呼び出しは1回）。
 */
export async function callStructured<T extends z.ZodType>(
  sql: Sql,
  input: StructuredCallInput<T>,
): Promise<StructuredCallResult<z.infer<T>>> {
  if (!isAiConfigured()) {
    throw new AiUnavailableError(
      "AIのAPIキー（ANTHROPIC_API_KEY）が設定されていません。READMEの手順で設定してください。",
    );
  }
  const estInputTokens =
    roughTokenCount(input.system) +
    roughTokenCount(JSON.stringify(input.messages)) +
    roughTokenCount(JSON.stringify(input.schema.toJSONSchema?.() ?? {})) +
    300;

  const reservation = await reserveApiCall(sql, {
    model: input.model,
    purpose: input.purpose,
    estInputTokens,
    maxOutputTokens: input.maxTokens,
    employeeId: input.employeeId,
    taskId: input.taskId,
    conversationId: input.conversationId,
  });

  if (isMockMode()) {
    const data = input.mock();
    const fakeUsage = {
      input_tokens: Math.round(estInputTokens / 1.5),
      output_tokens: Math.min(input.maxTokens, roughTokenCount(JSON.stringify(data))),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    const fin = await finalizeApiCall(sql, reservation, fakeUsage, "mock");
    return { ok: true, data, usageId: reservation.usageId, costJpy: fin.costJpy, costKnown: fin.known };
  }

  let response;
  try {
    response = await getAnthropic().messages.parse({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: input.messages,
      output_config: { effort: input.effort, format: zodOutputFormat(input.schema) },
      cache_control: { type: "ephemeral" },
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionError) {
      // 通信切断・タイムアウトは課金されたか分からないため、見積額で記録（安全側）
      await failApiCall(sql, reservation, `通信エラー: ${err.message}`, true);
      throw new AiUnavailableError("AIとの通信に失敗しました。時間をおいてもう一度お試しください。");
    }
    if (err instanceof Anthropic.APIError) {
      await failApiCall(sql, reservation, `APIエラー ${err.status}: ${err.message}`, false);
      if (err instanceof Anthropic.AuthenticationError) {
        throw new AiUnavailableError("APIキーが正しくありません。設定を確認してください。");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new AiUnavailableError("AIの利用が混み合っています。少し待ってからお試しください。");
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new AiUnavailableError(`AIへのリクエストが受け付けられませんでした（${err.message}）`);
      }
      throw new AiUnavailableError(`AIでエラーが発生しました（コード ${err.status ?? "不明"}）`);
    }
    // 形式チェックの失敗など、応答自体は受け取った可能性がある場合
    await failApiCall(sql, reservation, `不明なエラー: ${String(err)}`, true);
    throw new AiUnavailableError("AIの応答を処理できませんでした。もう一度お試しください。");
  }

  const fin = await finalizeApiCall(sql, reservation, response.usage, response.id);
  if (response.stop_reason === "refusal") {
    return {
      ok: false,
      reason: "refusal",
      message: "この依頼にはAIが応答できませんでした。内容を変えてお試しください。",
      usageId: reservation.usageId,
      costJpy: fin.costJpy,
    };
  }
  if (response.stop_reason === "max_tokens") {
    return {
      ok: false,
      reason: "truncated",
      message: "応答が長くなりすぎて途中で止まりました。依頼を短く分けてお試しください。",
      usageId: reservation.usageId,
      costJpy: fin.costJpy,
    };
  }
  if (!response.parsed_output) {
    return {
      ok: false,
      reason: "invalid",
      message: "AIの応答を読み取れませんでした。もう一度お試しください。",
      usageId: reservation.usageId,
      costJpy: fin.costJpy,
    };
  }
  return {
    ok: true,
    data: response.parsed_output as z.infer<T>,
    usageId: reservation.usageId,
    costJpy: fin.costJpy,
    costKnown: fin.known,
  };
}

export { BudgetBlockedError };
