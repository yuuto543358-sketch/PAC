import "server-only";
import type { DiscussionOutput, DraftOutput, FinalReportOutput, KickoffOutput, ReviewOutput } from "./schemas";
import type { PromptContext } from "./prompts";

// テスト用モックモード（AI_MOCK=1）のときだけ使う、決まった内容の返事。
// 業務の内容に「[mock:revise]」があると監査で1回差し戻し、「[mock:question]」があると経営者に質問します。

const tag = (ctx: PromptContext, t: string) => `${ctx.task.title}\n${ctx.task.description}`.includes(t);

export function mockKickoff(ctx: PromptContext): KickoffOutput {
  const text = `${ctx.task.title}${ctx.task.description}`;
  const lead = /調査|競合|市場|価格/.test(text)
    ? "research"
    : /企画|文章|作成|資料|商品/.test(text)
      ? "creative"
      : /事業|副業|収益/.test(text)
        ? "bizdev"
        : "secretary";
  const member = lead === "bizdev" ? "creative" : "bizdev";
  const askOwner = tag(ctx, "[mock:question]") && !ctx.messages.some((m) => m.author_type === "owner");
  return {
    message: `【テスト用モック】社長の天城です。「${ctx.task.title}」を進めます。リーダーを任せます。必要な観点を出し合い、成果物まで仕上げてください。`,
    lead_id: lead,
    member_ids: [member],
    plan: {
      goal: `${ctx.task.title}の結果を、経営者がすぐ判断できる形にまとめる`,
      steps: ["論点の整理", "各専門の観点から意見出し", "成果物の作成", "監査", "報告"],
      output_format: tag(ctx, "表") ? "csv_table" : "markdown_report",
      deliverable_title: `${ctx.task.title}（報告書）`,
      done_criteria: "結論・根拠・リスク・次の一手が書かれていること",
    },
    question_to_owner: askOwner ? "対象とする顧客層（個人向け／法人向け）はどちらを想定すればよいですか？" : null,
  };
}

export function mockDiscussion(ctx: PromptContext): DiscussionOutput {
  return {
    message: `【テスト用モック】${ctx.speaker.name}です。${ctx.speaker.expertise[0] ?? "専門"}の観点では、まず小さく試せる案に絞るのが良いと考えます。`,
    kind: ctx.speaker.id === ctx.workflow.lead_id ? "proposal" : "opinion",
    question_to_owner: null,
  };
}

export function mockDraft(ctx: PromptContext): DraftOutput {
  const v = (ctx.deliverable?.version ?? 0) + 1;
  const format = ctx.workflow.plan?.output_format === "csv_table" ? "csv_table" : "markdown_report";
  const content =
    format === "csv_table"
      ? "項目,内容,備考\n結論,小さく試す,テスト用モック\nリスク,需要が不明,要確認"
      : `# ${ctx.workflow.plan?.deliverable_title ?? ctx.task.title}\n\n## 結論\n小さく試して検証します（テスト用モック・第${v}版）。\n\n## 根拠\n- チームの議論の要点\n\n## リスク\n- 需要は未確認（要確認）\n\n## 次の一手\n- 1週間の小規模テスト`;
  const wantsSend = /送信|送って|メール/.test(ctx.task.description);
  return {
    message: `【テスト用モック】第${v}版を作成しました。議論の要点を反映しています。`,
    deliverable: { title: ctx.workflow.plan?.deliverable_title ?? ctx.task.title, format, content },
    external_actions: wantsSend
      ? [
          {
            action_type: "send_message",
            title: "成果物を取引先にメール送信",
            content: "（テスト用モック）報告書をお送りします。",
            destination: "example@example.com",
            reason: "業務の依頼内容に送信が含まれるため",
            estimated_cost_jpy: 0,
            risks: "宛先の間違い",
            after_effect: "実行機能の実装後、メールが送信されます",
          },
        ]
      : [],
    question_to_owner: null,
  };
}

export function mockReview(ctx: PromptContext): ReviewOutput {
  const revise = tag(ctx, "[mock:revise]") && ctx.workflow.rework_count === 0;
  return revise
    ? {
        message: "【テスト用モック】数字の根拠が不足しています。修正をお願いします。",
        verdict: "revise",
        points: ["結論の根拠となる数字を追加する"],
        risks: ["需要が未検証"],
      }
    : {
        message: "【テスト用モック】監査しました。大きな問題はありません。合格です。",
        verdict: "approve",
        points: [],
        risks: ["需要は小規模テストで確認すること"],
      };
}

export function mockFinal(ctx: PromptContext): FinalReportOutput {
  return {
    report: `【テスト用モック】「${ctx.task.title}」が完了しました。成果物をご確認のうえ、承認をお願いします。`,
    summary: `${ctx.task.title}の成果物が完成`,
    lessons: ctx.members
      .filter((m) => m.role !== "ceo")
      .map((m) => ({ employee_id: m.employee_id, lesson: "根拠となる数字を最初から用意すると手戻りが減る" })),
    next_steps: ["小規模テストを実施する"],
  };
}
