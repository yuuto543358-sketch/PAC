import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type { Sql } from "@/lib/db";
import { BudgetBlockedError, failApiCall, finalizeApiCall, reserveApiCall } from "@/lib/budget";
import { getPricing, roughTokenCount, WEB_SEARCH_CALL_USD, type UsageLike } from "@/lib/pricing";

// このファイルは「サーバー専用」です（"server-only"）。
// OpenAI の APIキーはサーバーの環境変数からだけ読み、画面（ブラウザ）には絶対に送りません。

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

const NO_KEY_MESSAGE = "AIのAPIキー（OPENAI_API_KEY）が設定されていません。READMEの手順で設定してください。";

/** テスト用：モックモードで失敗を再現する回数 */
export const mockHooks = { failNext: 0 };

export function isMockMode() {
  return process.env.AI_MOCK === "1";
}

export function isAiConfigured() {
  return isMockMode() || Boolean(process.env.OPENAI_API_KEY);
}

let client: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new AiUnavailableError(NO_KEY_MESSAGE);
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // 自動リトライは費用の二重計上の原因になるため行わない（失敗したら利用者が再実行する）
      maxRetries: 0,
      timeout: 90_000,
    });
  }
  return client;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type StructuredCallInput<T extends z.ZodType> = {
  model: string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  system: string;
  messages: ChatTurn[];
  schema: T;
  /** 出力形式の名前（英数字と _ のみ） */
  schemaName: string;
  purpose: string;
  employeeId?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  /** Web検索を使わせる場合の設定（使わない場合は省略） */
  webSearch?: { maxCalls: number } | null;
  /** テスト用モックモードで返す内容 */
  mock: () => z.infer<T>;
};

/** Web検索で参照したページ */
export type WebSource = { url: string; title: string };

export type StructuredCallResult<T> =
  | {
      ok: true;
      data: T;
      usageId: string;
      costJpy: number;
      costKnown: boolean;
      /** Web検索で参照したページ（検索しなかった場合は空） */
      sources: WebSource[];
      /** Web検索の回数 */
      searchCalls: number;
    }
  | { ok: false; reason: "refusal" | "truncated" | "invalid"; message: string; usageId: string; costJpy: number };

/** Web検索1回で読み込まれる内容の量（トークン）の、多めの見積もり */
const WEB_SEARCH_EST_INPUT_TOKENS = 15_000;
/** 1回の呼び出しで許すWeb検索の最大回数（安全のための上限） */
export const WEB_SEARCH_MAX_CALLS_LIMIT = 3;

/** Web検索にかかる最大費用（米ドル）。検索料金＋読み込む内容の入力料金を、多めに見積もる */
export function webSearchMaxUsd(model: string, maxCalls: number): number {
  const p = getPricing(model);
  const perCall = WEB_SEARCH_CALL_USD + (p ? (WEB_SEARCH_EST_INPUT_TOKENS * p.inputPerMTok) / 1_000_000 : 0);
  return Math.max(0, maxCalls) * perCall;
}

function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // 追跡用のパラメータ（utm_source=openai など）は外す
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_")) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/** 応答から「Web検索の回数」と「参照したページ」を取り出す */
export function extractWebSearch(response: Pick<OpenAI.Responses.Response, "output">): {
  calls: number;
  sources: WebSource[];
} {
  let calls = 0;
  const map = new Map<string, WebSource>();
  const add = (rawUrl: string | undefined | null, title?: string | null) => {
    if (!rawUrl) return;
    const url = safeHttpUrl(rawUrl);
    if (!url) return;
    const prev = map.get(url);
    const t = (title ?? "").trim().slice(0, 200);
    if (!prev) map.set(url, { url, title: t });
    else if (!prev.title && t) prev.title = t;
  };
  for (const item of response.output ?? []) {
    if (item.type === "web_search_call") {
      // 課金を多めに数えるため、ページを開く操作なども1回として数える
      calls++;
      const action = item.action;
      if (action?.type === "search") for (const src of action.sources ?? []) add(src.url);
      else if (action?.type === "open_page") add(action.url);
    } else if (item.type === "message") {
      for (const c of item.content) {
        if (c.type !== "output_text") continue;
        for (const a of c.annotations ?? []) {
          if (a.type === "url_citation") add(a.url, a.title);
        }
      }
    }
  }
  return { calls, sources: [...map.values()].slice(0, 12) };
}

function toUsageLike(u: OpenAI.Responses.ResponseUsage | undefined | null, webSearchCalls = 0): UsageLike | null {
  if (!u) return null;
  return {
    web_search_calls: webSearchCalls,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cached_input_tokens: u.input_tokens_details?.cached_tokens ?? 0,
    cache_write_tokens: u.input_tokens_details?.cache_write_tokens ?? 0,
  };
}

function hasRefusal(response: OpenAI.Responses.Response): boolean {
  return response.output.some(
    (item) => item.type === "message" && item.content.some((c) => c.type === "refusal"),
  );
}

/**
 * AIを1回だけ呼び出し、決められた形式（JSON）で結果を受け取ります。
 * 呼び出し前に必ず予算チェック（reserveApiCall）を通し、結果の費用を記録します。
 * ループはしません（1回の操作につきAI呼び出しは1回）。
 */
export async function callStructured<T extends z.ZodType>(
  sql: Sql,
  input: StructuredCallInput<T>,
): Promise<StructuredCallResult<z.infer<T>>> {
  if (!isAiConfigured()) throw new AiUnavailableError(NO_KEY_MESSAGE);

  const estInputTokens =
    roughTokenCount(input.system) +
    roughTokenCount(JSON.stringify(input.messages)) +
    roughTokenCount(JSON.stringify(input.schema.toJSONSchema?.() ?? {})) +
    300;

  const searchCalls = input.webSearch
    ? Math.min(WEB_SEARCH_MAX_CALLS_LIMIT, Math.max(1, Math.floor(input.webSearch.maxCalls)))
    : 0;

  const reservation = await reserveApiCall(sql, {
    model: input.model,
    purpose: input.purpose,
    estInputTokens,
    maxOutputTokens: input.maxTokens,
    employeeId: input.employeeId,
    taskId: input.taskId,
    conversationId: input.conversationId,
    extraMaxUsd: searchCalls > 0 ? webSearchMaxUsd(input.model, searchCalls) : 0,
  });

  if (isMockMode()) {
    // テスト用：失敗を再現する
    if (mockHooks.failNext > 0) {
      mockHooks.failNext--;
      await failApiCall(sql, reservation, "テスト用に再現した失敗", false);
      throw new AiUnavailableError("テスト用に再現した失敗です");
    }
    const data = input.mock();
    const fakeUsage: UsageLike = {
      input_tokens: Math.round(estInputTokens / 1.5),
      output_tokens: Math.min(input.maxTokens, roughTokenCount(JSON.stringify(data))),
      cached_input_tokens: 0,
      cache_write_tokens: 0,
      web_search_calls: searchCalls > 0 ? 1 : 0,
    };
    const fin = await finalizeApiCall(sql, reservation, fakeUsage, "mock");
    const sources: WebSource[] =
      searchCalls > 0 ? [{ url: "https://example.com/mock-source", title: "（テスト用の参照ページ）" }] : [];
    return {
      ok: true,
      data,
      usageId: reservation.usageId,
      costJpy: fin.costJpy,
      costKnown: fin.known,
      sources,
      searchCalls: searchCalls > 0 ? 1 : 0,
    };
  }

  let response;
  try {
    response = await getOpenAI().responses.parse({
      model: input.model,
      instructions: input.system,
      input: input.messages,
      max_output_tokens: input.maxTokens,
      reasoning: { effort: input.effort },
      text: { format: zodTextFormat(input.schema, input.schemaName) },
      // 会話の内容を OpenAI 側に保存しない
      store: false,
      // 同じ社員への呼び出しで、入力の共通部分のキャッシュ（割引）が効きやすくする
      prompt_cache_key: input.purpose.slice(0, 64),
      ...(searchCalls > 0
        ? {
            tools: [
              {
                type: "web_search" as const,
                // 読み込む量を少なくして費用を抑える
                search_context_size: "low" as const,
                user_location: { type: "approximate" as const, country: "JP", timezone: "Asia/Tokyo" },
              },
            ],
            max_tool_calls: searchCalls,
            include: ["web_search_call.action.sources" as const],
          }
        : {}),
    });
  } catch (err) {
    // APIConnectionError は APIError の一種なので、先に判定する
    if (err instanceof OpenAI.APIConnectionError) {
      // 通信切断・タイムアウトは課金されたか分からないため、見積額で記録（安全側）
      await failApiCall(sql, reservation, `通信エラー: ${err.message}`, true);
      throw new AiUnavailableError("AIとの通信に失敗しました。時間をおいてもう一度お試しください。");
    }
    if (err instanceof OpenAI.APIError) {
      await failApiCall(sql, reservation, `APIエラー ${err.status}: ${err.message}`, false);
      if (err instanceof OpenAI.AuthenticationError) {
        throw new AiUnavailableError("OpenAI の APIキーが正しくありません。設定を確認してください。");
      }
      if (err instanceof OpenAI.PermissionDeniedError || err instanceof OpenAI.NotFoundError) {
        throw new AiUnavailableError(
          `モデル「${input.model}」を使う権限がないか、モデルが見つかりません。設定画面でモデルを変えてください。`,
        );
      }
      if (err instanceof OpenAI.RateLimitError) {
        throw new AiUnavailableError(
          "OpenAI の利用制限に達しました（残高不足または混雑）。OpenAI の Billing 画面で残高を確認するか、少し待ってからお試しください。",
        );
      }
      if (err instanceof OpenAI.BadRequestError) {
        throw new AiUnavailableError(`AIへのリクエストが受け付けられませんでした（${err.message}）`);
      }
      throw new AiUnavailableError(`AIでエラーが発生しました（コード ${err.status ?? "不明"}）`);
    }
    // 応答の形式チェックの失敗など、応答自体は受け取った（課金された）可能性がある場合
    await failApiCall(sql, reservation, `不明なエラー: ${String(err)}`, true);
    throw new AiUnavailableError("AIの応答を処理できませんでした。もう一度お試しください。");
  }

  const web = extractWebSearch(response);
  const fin = await finalizeApiCall(sql, reservation, toUsageLike(response.usage, web.calls), response.id);
  const fail = (reason: "refusal" | "truncated" | "invalid", message: string) => ({
    ok: false as const,
    reason,
    message,
    usageId: reservation.usageId,
    costJpy: fin.costJpy,
  });

  if (hasRefusal(response) || response.incomplete_details?.reason === "content_filter") {
    return fail("refusal", "この依頼にはAIが応答できませんでした。内容を変えてお試しください。");
  }
  if (response.status === "incomplete") {
    return fail("truncated", "応答が長くなりすぎて途中で止まりました。依頼を短く分けてお試しください。");
  }
  if (!response.output_parsed) {
    return fail("invalid", "AIの応答を読み取れませんでした。もう一度お試しください。");
  }
  return {
    ok: true,
    data: response.output_parsed as z.infer<T>,
    usageId: reservation.usageId,
    costJpy: fin.costJpy,
    costKnown: fin.known,
    sources: web.sources,
    searchCalls: web.calls,
  };
}

export { BudgetBlockedError };
