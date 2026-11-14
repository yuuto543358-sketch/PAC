import { z } from "zod";
import { DELIVERABLE_FORMAT_IDS, EXTERNAL_ACTION_TYPES } from "@/lib/constants";

// AI社員がチームで仕事をするときの「返事の形」。決まった形（JSON）で返してもらう。

const questionToOwner = z
  .string()
  .nullable()
  .describe("経営者に確認しないと進められないことがある場合だけ、その質問。なければ null");

export const KickoffSchema = z.object({
  message: z.string().describe("チームへの声かけ（社長として。自分の言葉で自由に）"),
  lead_id: z.string().describe("リーダーにする社員の id（社長以外）"),
  member_ids: z.array(z.string()).describe("リーダー以外のメンバーの id（0〜2人。必要な人だけ）"),
  plan: z.object({
    goal: z.string().describe("この業務のゴール"),
    steps: z.array(z.string()).describe("進め方（3〜5段階）"),
    output_format: z.enum(DELIVERABLE_FORMAT_IDS).describe("最終成果物の形式"),
    deliverable_title: z.string().describe("成果物の題名"),
    done_criteria: z.string().describe("完成の条件"),
  }),
  question_to_owner: questionToOwner,
});
export type KickoffOutput = z.infer<typeof KickoffSchema>;

export const DiscussionSchema = z.object({
  message: z.string().describe("グループチャットでの発言（自分の言葉で自由に。300字くらいまで）"),
  kind: z.enum(["opinion", "proposal", "question", "findings"]).describe("発言の種類"),
  question_to_owner: questionToOwner,
});
export type DiscussionOutput = z.infer<typeof DiscussionSchema>;

const externalAction = z.object({
  action_type: z.enum(EXTERNAL_ACTION_TYPES),
  title: z.string(),
  content: z.string().describe("実行する内容そのもの（送信文の全文など）"),
  destination: z.string().describe("実行先（宛先・サービス名など）"),
  reason: z.string(),
  estimated_cost_jpy: z.number(),
  risks: z.string(),
  after_effect: z.string(),
});

export const DraftSchema = z.object({
  message: z.string().describe("チームへのひとこと（自由に。200字くらいまで）"),
  deliverable: z.object({
    title: z.string(),
    format: z.enum(DELIVERABLE_FORMAT_IDS).describe("出力形式。チームで決めた形式に合わせる"),
    content: z.string().describe("成果物の本文すべて（完成品として、そのまま使える内容。専門用語を使わず、やさしい言葉で）"),
  }),
  external_actions: z
    .array(externalAction)
    .describe("成果物を使うために外部への操作（送信・投稿・公開・購入など）が必要なら、その承認依頼の案（最大2件）。なければ空配列"),
  question_to_owner: questionToOwner,
});
export type DraftOutput = z.infer<typeof DraftSchema>;

export const ReviewSchema = z.object({
  message: z.string().describe("監査を終えてのチームへのひとこと（自由に。200字くらいまで）"),
  verdict: z.enum(["approve", "revise"]).describe("合格なら approve、修正が必要なら revise"),
  points: z.array(z.string()).describe("修正してほしい点（revise のとき。本当に大事な点だけ、最大3つ。具体的に）"),
  risks: z.array(z.string()).describe("経営者に伝えるべきリスク・注意点"),
});
export type ReviewOutput = z.infer<typeof ReviewSchema>;

export const MediaPlanSchema = z.object({
  scenes: z
    .array(
      z.object({
        caption: z.string().describe("画面に出す文字（テロップ）。20字以内"),
        narration: z.string().describe("この場面で話す言葉（ナレーション）。台本どおりに"),
        image_prompt: z.string().describe("この場面の絵の説明（何が・どこで・どんな雰囲気か）。文字・ロゴ・実在の人物は入れない"),
      }),
    )
    .describe("動画の場面（台本の順に3〜6個）"),
  voice: z.string().describe("ナレーションの読み方の雰囲気（例の言い回しではなく、速さ・明るさ・声のトーンなど）"),
});
export type MediaPlanOutput = z.infer<typeof MediaPlanSchema>;

export const FinalReportSchema = z.object({
  report: z.string().describe("経営者への報告（社長として、自分の言葉で自然に。何ができたか・見てほしいこと・気になることが伝わればよい。500字以内。難しい言葉は使わない）"),
  summary: z.string().describe("一行の要約（60字以内）"),
  lessons: z
    .array(z.object({ employee_id: z.string(), lesson: z.string().describe("この業務から学んだこと（次に活かす注意点）") }))
    .describe("チームの各社員が次に活かすべき学び（各1つまで）"),
  next_steps: z.array(z.string()).describe("今後の提案（最大3件）"),
});
export type FinalReportOutput = z.infer<typeof FinalReportSchema>;
