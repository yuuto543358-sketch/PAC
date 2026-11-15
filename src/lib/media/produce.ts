import "server-only";
import type { Sql } from "@/lib/db";
import { begin } from "@/lib/db";
import { AiUnavailableError, BudgetBlockedError, callStructured } from "@/lib/ai/client";
import { PLAIN_LANGUAGE_RULES } from "@/lib/ai/prompts";
import { getSettings } from "@/lib/repo/settings";
import { addRoomMessage, getDeliverable, getWorkflow, updateWorkflow, type Workflow } from "@/lib/workflow/repo";
import { MediaPlanSchema, type MediaPlanOutput } from "@/lib/workflow/schemas";
import { generateImage, generateSpeech } from "./generate";
import { saveMediaAsset } from "./repo";

// 動画の材料（場面の分け方・場面の絵・ナレーションの声）を、1回に1つずつ作ります（1回の呼び出しでAIは1回）。
// 絵や声がうまく作れなくても、動画づくりは止めません：
// - 絵が作れない → その場面は「文字のスライド」で動画にする
// - 声が作れない → 声なし（テロップだけ）で動画にする
// 予算の上限に達したときだけは、いったん止まります（あとで続きから作る）。

/** 1つの動画で作る場面の数の上限（費用を抑えるため） */
export const MAX_SCENES = 6;

export type MediaScene = { no: number; caption: string; narration: string; image_prompt: string };
export type MediaState = {
  version: number;
  scenes: MediaScene[];
  voice: string;
  /** 絵ができた場面の番号 */
  images: number[];
  audio: boolean;
  /** 絵を作れなかった理由（あれば、残りの場面は文字のスライドにする） */
  imageError?: string;
  /** 声を作れなかった理由（あれば、声なしで動画にする） */
  voiceError?: string;
  /** 場面に分けることもできなかった理由 */
  skipped?: string;
};

export function mediaStateOf(wf: Pick<Workflow, "plan"> | null | undefined): MediaState | null {
  return ((wf?.plan as { media?: MediaState } | undefined)?.media ?? null) as MediaState | null;
}

/** この版の動画の材料がそろったか（絵・声は「作れなかった」も含めて、終わったか） */
export function mediaReady(m: MediaState | null, version: number): boolean {
  if (!m || m.version !== version || m.scenes.length === 0) return false;
  const imagesDone = Boolean(m.imageError) || m.scenes.every((s) => m.images.includes(s.no));
  return imagesDone && (m.audio || Boolean(m.voiceError));
}

function mockMediaPlan(title: string): MediaPlanOutput {
  return {
    scenes: [
      { caption: "まだ手作業？", narration: "それ、まだ手でやってるの？", image_prompt: `${title}の最初の場面` },
      { caption: "3分で終わる", narration: "実は3分で終わるやり方があるんです。", image_prompt: "やり方を見せる場面" },
      { caption: "やってみて", narration: "今日からためしてみてね。", image_prompt: "笑顔でしめくくる場面" },
    ],
    voice: "明るく、少しゆっくり",
  };
}

async function systemNote(sql: Sql, taskId: string, content: string, tone: "info" | "warn" = "info") {
  await addRoomMessage(sql, { taskId, authorType: "system", kind: "system", content, meta: { tone } });
}

/** OpenAI のエラーを、経営者に分かる言葉にする */
function explainImageError(message: string) {
  if (/verif|organization must be verified|権限|見つかりません|PermissionDenied|403/i.test(message)) {
    return `${message}（OpenAI の絵のモデルは、OpenAI の管理画面で「組織の本人確認（Organization verification）」をしないと使えないことがあります）`;
  }
  return message;
}

export type MediaStepResult = { status: "progress" | "done" | "not_video"; costJpy: number };

/**
 * 動画の材料を1つだけ作る。
 * 予算の上限（BudgetBlockedError）と、場面に分けるときのAIのエラー（AiUnavailableError）だけは呼び出し元に投げる。
 */
export async function produceMediaStep(sql: Sql, taskId: string, employeeId: string | null): Promise<MediaStepResult> {
  const [wf, latest] = await Promise.all([getWorkflow(sql, taskId), getDeliverable(sql, taskId)]);
  if (!wf || !latest || latest.format !== "video_script") return { status: "not_video", costJpy: 0 };
  const state = mediaStateOf(wf);
  const save = (media: MediaState) => updateWorkflow(sql, taskId, { plan: { ...wf.plan, media } as Workflow["plan"] });
  const ctx = { taskId, employeeId, purpose: "" };

  // 1) 台本を場面に分ける（新しい版になったら分け直す）
  if (!state || state.version !== latest.version || state.scenes.length === 0) {
    const settings = await getSettings(sql);
    const [task] = await sql<{ title: string }[]>`select title from tasks where id = ${taskId}`;
    const result = await callStructured(sql, {
      model: settings.model_standard,
      effort: "low",
      maxTokens: 2500,
      system: `あなたは「${settings.company_name}」のAI社員で、動画づくりの担当です。
動画の台本を、アプリが「場面ごとの絵」と「ナレーションの声」にするために、場面に分けます。
${PLAIN_LANGUAGE_RULES}`,
      messages: [
        {
          role: "user",
          content: `次の台本を、台本の順番どおりに3〜${MAX_SCENES}個の場面に分けてください（場面が多ければまとめる）。
- narration は台本の言葉をそのまま使う。caption は短く。
- image_prompt は、その場面の絵の説明。文字・ロゴ・実在の人物の顔は入れない。

【台本】
${latest.content.slice(0, 12000)}`,
        },
      ],
      schema: MediaPlanSchema,
      schemaName: "video_media_plan",
      purpose: "team:media_plan",
      employeeId,
      taskId,
      mock: () => mockMediaPlan(task?.title ?? ""),
    });
    if (!result.ok) throw new AiUnavailableError(result.message);
    const data = result.data as MediaPlanOutput;
    const scenes = data.scenes
      .filter((s) => s.narration.trim() || s.image_prompt.trim())
      .slice(0, MAX_SCENES)
      .map((s, i) => ({ no: i + 1, caption: s.caption.slice(0, 40), narration: s.narration.slice(0, 600), image_prompt: s.image_prompt.slice(0, 800) }));
    if (scenes.length === 0) throw new AiUnavailableError("台本を場面に分けられませんでした");
    await save({ version: latest.version, scenes, voice: data.voice.slice(0, 300), images: [], audio: false });
    await systemNote(sql, taskId, `台本を${scenes.length}つの場面に分けました。場面ごとの絵とナレーションの声を作ります。`);
    return { status: "progress", costJpy: result.costJpy };
  }

  // 2) 場面の絵を1枚ずつ（作れなかったら、残りは文字のスライドにする）
  const nextScene = !state.imageError ? state.scenes.find((s) => !state.images.includes(s.no)) : undefined;
  if (nextScene) {
    try {
      const img = await generateImage(sql, nextScene.image_prompt, { ...ctx, purpose: "team:media_image", sceneNo: nextScene.no });
      await begin(sql, async (tx) => {
        await saveMediaAsset(tx, { taskId, version: latest.version, kind: "image", sceneNo: nextScene.no, mime: img.mime, data: img.data, prompt: nextScene.image_prompt, usageId: img.usageId });
        await updateWorkflow(tx, taskId, { plan: { ...wf.plan, media: { ...state, images: [...state.images, nextScene.no] } } as Workflow["plan"] });
      });
      return { status: "progress", costJpy: img.costJpy };
    } catch (err) {
      if (err instanceof BudgetBlockedError) throw err;
      const reason = explainImageError(err instanceof Error ? err.message : String(err));
      await save({ ...state, imageError: reason });
      await systemNote(sql, taskId, `場面の絵を作れませんでした。絵のない場面は、文字のスライドで動画にします（理由：${reason}）。`, "warn");
      return { status: "progress", costJpy: 0 };
    }
  }

  // 3) ナレーションの声（作れなかったら、声なしで動画にする）
  if (!state.audio && !state.voiceError) {
    const text = state.scenes.map((s) => s.narration.trim()).filter(Boolean).join("\n\n");
    try {
      const voice = await generateSpeech(sql, text, state.voice, { ...ctx, purpose: "team:media_voice" });
      await begin(sql, async (tx) => {
        await saveMediaAsset(tx, { taskId, version: latest.version, kind: "audio", sceneNo: 0, mime: voice.mime, data: voice.data, prompt: text, usageId: voice.usageId });
        await updateWorkflow(tx, taskId, { plan: { ...wf.plan, media: { ...state, audio: true } } as Workflow["plan"] });
      });
      return { status: "progress", costJpy: voice.costJpy };
    } catch (err) {
      if (err instanceof BudgetBlockedError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      await save({ ...state, voiceError: reason });
      await systemNote(sql, taskId, `ナレーションの声を作れませんでした。声なし（テロップだけ）で動画にします（理由：${reason}）。`, "warn");
      return { status: "progress", costJpy: 0 };
    }
  }

  return { status: "done", costJpy: 0 };
}

/** 動画の材料ができたことを知らせる文 */
export function mediaDoneMessage(m: MediaState | null) {
  if (!m) return "動画の材料ができました。";
  const parts = [m.imageError ? "絵の代わりに文字のスライド" : "場面ごとの絵", m.audio ? "ナレーションの声" : "テロップ"];
  return `動画の材料（${parts.join("・")}）ができました。承認の画面と成果物の画面の「動画を書き出す」で、動画ファイルにして保存できます。`;
}

/**
 * 足りない絵と声を作り直す（経営者が画面のボタンで頼んだとき）。
 * すでにある絵・声はそのまま使い、作れなかったものだけをもう一度作る。
 */
export async function remakeMissingMedia(sql: Sql, taskId: string, maxSteps = 12): Promise<{ ok: boolean; message: string }> {
  const [wf, latest] = await Promise.all([getWorkflow(sql, taskId), getDeliverable(sql, taskId)]);
  if (!wf || !latest || latest.format !== "video_script") return { ok: false, message: "動画の業務ではありません" };
  const state = mediaStateOf(wf);
  if (state && state.version === latest.version) {
    const assets = await sql<{ kind: string; scene_no: number }[]>`
      select kind, scene_no from media_assets where task_id = ${taskId} and deliverable_version = ${latest.version}`;
    await updateWorkflow(sql, taskId, {
      plan: {
        ...wf.plan,
        media: {
          ...state,
          images: assets.filter((a) => a.kind === "image").map((a) => a.scene_no),
          audio: assets.some((a) => a.kind === "audio"),
          imageError: undefined,
          voiceError: undefined,
          skipped: undefined,
        },
      } as Workflow["plan"],
    });
  }
  const employeeId = wf.lead_id;
  try {
    for (let i = 0; i < maxSteps; i++) {
      const r = await produceMediaStep(sql, taskId, employeeId);
      if (r.status !== "progress") break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "途中で止まりました";
    await systemNote(sql, taskId, `動画の材料づくりが途中で止まりました（${message}）。あとでもう一度お試しください。`, "warn");
    return { ok: false, message };
  }
  const after = mediaStateOf(await getWorkflow(sql, taskId));
  await systemNote(sql, taskId, mediaDoneMessage(after));
  return { ok: true, message: mediaDoneMessage(after) };
}
