import "server-only";
import type { Sql } from "@/lib/db";
import { failApiCall, finalizeApiCall, reserveApiCall } from "@/lib/budget";
import { AiUnavailableError, getOpenAI, handleApiError, isAiConfigured, isMockMode, mockHooks } from "@/lib/ai/client";
import { roughTokenCount } from "@/lib/pricing";

// 動画の「実物」の材料（場面ごとの絵・ナレーションの声）を AI で作ります。
// どちらも呼び出す前に必ず予算チェックを通し、費用を記録します（1回の操作につき呼び出しは1回）。
// 作った絵・声はデータベースに保存し、外部には公開しません（ログインした経営者だけが見られます）。

/** 絵を作るモデル（縦長・控えめな画質で費用を抑える） */
export const IMAGE_MODEL = "gpt-image-1-mini";
/** 声を作るモデル */
export const SPEECH_MODEL = "gpt-4o-mini-tts";
/** 声の種類 */
export const SPEECH_VOICE = "coral";

export type GeneratedMedia = { data: Buffer; mime: string; usageId: string; costJpy: number };

type Ctx = { taskId: string; employeeId: string | null; purpose: string };

/** 場面の絵を1枚作る（縦長 1024×1536） */
export async function generateImage(sql: Sql, prompt: string, ctx: Ctx & { sceneNo: number }): Promise<GeneratedMedia> {
  if (!isAiConfigured()) throw new AiUnavailableError("AIのAPIキー（OPENAI_API_KEY）が設定されていません。");
  const fullPrompt = `${prompt}\n\n縦長の動画の1場面として使う絵。文字・ロゴ・実在の人物の顔は入れない。明るく見やすい、やさしいイラスト調。`;
  const reservation = await reserveApiCall(sql, {
    model: IMAGE_MODEL,
    purpose: ctx.purpose,
    estInputTokens: roughTokenCount(fullPrompt) + 50,
    // 縦長・低画質の絵は数百トークン程度とされるが、安全のため多めに見積もる
    maxOutputTokens: 1200,
    employeeId: ctx.employeeId,
    taskId: ctx.taskId,
  });

  if (isMockMode()) {
    if (mockHooks.failNext > 0) {
      mockHooks.failNext--;
      await failApiCall(sql, reservation, "テスト用に再現した失敗", false);
      throw new AiUnavailableError("テスト用に再現した失敗です");
    }
    const fin = await finalizeApiCall(sql, reservation, { input_tokens: 100, output_tokens: 400 }, "mock");
    return { data: Buffer.from(mockSceneSvg(ctx.sceneNo, prompt)), mime: "image/svg+xml", usageId: reservation.usageId, costJpy: fin.costJpy };
  }

  try {
    const res = await getOpenAI().images.generate({
      model: IMAGE_MODEL,
      prompt: fullPrompt,
      size: "1024x1536",
      quality: "low",
      output_format: "jpeg",
      output_compression: 70,
      n: 1,
    });
    const b64 = res.data?.[0]?.b64_json;
    const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    const fin = await finalizeApiCall(sql, reservation, usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } : null);
    if (!b64) throw new AiUnavailableError("絵を受け取れませんでした。もう一度お試しください。");
    return { data: Buffer.from(b64, "base64"), mime: "image/jpeg", usageId: reservation.usageId, costJpy: fin.costJpy };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    return handleApiError(sql, reservation, IMAGE_MODEL, err);
  }
}

/** ナレーションの声を作る（mp3） */
export async function generateSpeech(sql: Sql, text: string, instructions: string, ctx: Ctx): Promise<GeneratedMedia> {
  if (!isAiConfigured()) throw new AiUnavailableError("AIのAPIキー（OPENAI_API_KEY）が設定されていません。");
  const input = text.slice(0, 3800);
  const reservation = await reserveApiCall(sql, {
    model: SPEECH_MODEL,
    purpose: ctx.purpose,
    estInputTokens: roughTokenCount(input + instructions),
    // 声の長さ（1分あたり1,250トークン前後とされる）。1分10秒ぶんまでを見積もる
    maxOutputTokens: 1500,
    employeeId: ctx.employeeId,
    taskId: ctx.taskId,
  });

  if (isMockMode()) {
    if (mockHooks.failNext > 0) {
      mockHooks.failNext--;
      await failApiCall(sql, reservation, "テスト用に再現した失敗", false);
      throw new AiUnavailableError("テスト用に再現した失敗です");
    }
    const fin = await finalizeApiCall(sql, reservation, { input_tokens: roughTokenCount(input), output_tokens: 300 }, "mock");
    const seconds = Math.min(6, Math.max(2, input.length / 25));
    return { data: mockToneWav(seconds), mime: "audio/wav", usageId: reservation.usageId, costJpy: fin.costJpy };
  }

  try {
    const res = await getOpenAI().audio.speech.create({
      model: SPEECH_MODEL,
      voice: SPEECH_VOICE,
      input,
      instructions: `日本語で、自然に読み上げる。${instructions}`.slice(0, 1000),
      response_format: "mp3",
    });
    const data = Buffer.from(await res.arrayBuffer());
    // 読み上げの応答には使用量が入らないため、見積額で記録する（実際より多めになる）
    const fin = await finalizeApiCall(sql, reservation, null);
    return { data, mime: "audio/mpeg", usageId: reservation.usageId, costJpy: fin.costJpy };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    return handleApiError(sql, reservation, SPEECH_MODEL, err);
  }
}

// ===== テスト用（AI_MOCK=1）の材料 =====

const MOCK_COLORS = ["#0f766e", "#7c3aed", "#c2410c", "#1d4ed8", "#be185d", "#4d7c0f"];

function mockSceneSvg(sceneNo: number, prompt: string) {
  const color = MOCK_COLORS[(sceneNo - 1 + MOCK_COLORS.length) % MOCK_COLORS.length];
  const label = prompt.replace(/[<>&"]/g, "").slice(0, 18);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">
<rect width="1024" height="1536" fill="${color}"/>
<circle cx="512" cy="620" r="260" fill="#ffffff" fill-opacity="0.18"/>
<text x="512" y="660" font-size="160" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${sceneNo}</text>
<text x="512" y="1000" font-size="44" text-anchor="middle" fill="#ffffff" font-family="sans-serif">テスト用の絵：${label}</text>
</svg>`;
}

/** 小さな音のWAV（8kHz・8bit・モノラル） */
function mockToneWav(seconds: number): Buffer {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(20 * Math.sin((2 * Math.PI * 440 * i) / rate));
  return buf;
}
