import { z } from "zod";
import { DELIVERABLE_FORMAT_IDS, EXTERNAL_ACTION_TYPES } from "@/lib/constants";

// AI社員がチームで仕事をするときの「返事の形」。決まった形（JSON）で返してもらう。

const questionToOwner = z
  .string()
  .nullable()
  .describe("経営者に確認しないと進められないことがある場合だけ、その質問。なければ null");

export const KickoffSchema = z.object({
  message: z.string().describe("チームへの最初の指示（社長として。目的・役割分担・進め方を簡潔に）"),
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
  message: z.string().describe("グループチャットでの発言（300字以内。専門用語を使わず、やさしい言葉で具体的に）"),
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
  message: z.string().describe("チームへの報告（成果物の要点と、議論をどう反映したか。200字以内。やさしい言葉で）"),
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
  message: z.string().describe("監査結果のチームへの発言（200字以内。やさしい言葉で）"),
  verdict: z.enum(["approve", "revise"]).describe("合格なら approve、修正が必要なら revise"),
  points: z.array(z.string()).describe("修正してほしい点（revise のとき。具体的に）"),
  risks: z.array(z.string()).describe("経営者に伝えるべきリスク・注意点"),
});
export type ReviewOutput = z.infer<typeof ReviewSchema>;

export const FinalReportSchema = z.object({
  report: z.string().describe("経営者への完了報告（社長として。結論・成果物の要点・心配なこと・決めてほしいこと。500字以内。専門用語を使わず、やさしい言葉で）"),
  summary: z.string().describe("一行の要約（60字以内）"),
  lessons: z
    .array(z.object({ employee_id: z.string(), lesson: z.string().describe("この業務から学んだこと（次に活かす注意点）") }))
    .describe("チームの各社員が次に活かすべき学び（各1つまで）"),
  next_steps: z.array(z.string()).describe("今後の提案（最大3件）"),
});
export type FinalReportOutput = z.infer<typeof FinalReportSchema>;
