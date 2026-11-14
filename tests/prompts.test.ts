// AIへの指示（プロンプト）に「やさしい言葉で話す」ルールが必ず入っていることを確かめる
import { describe, expect, it } from "vitest";
import { buildChatSystemPrompt, PLAIN_LANGUAGE_RULES } from "@/lib/ai/prompts";
import { buildStepInstruction, buildTeamContext } from "@/lib/workflow/prompts";
import { buildSalesChannelGuide, netPerSale, SALES_CHANNEL_POLICY, SALES_CHANNELS } from "@/lib/sales-channels";

const settings = { company_name: "テスト会社", philosophy: "理念", custom_rules: "" };
const employee = {
  id: "research",
  role_key: "research",
  name: "宮下 理",
  name_kana: "みやした おさむ",
  role_title: "調査担当",
  department_name: "調査部",
  personality: "慎重",
  speaking_style: "丁寧語",
  expertise: ["市場調査"],
  strengths: ["正確さ"],
  weaknesses: ["スピード"],
  judgment_criteria: "出典",
};

describe("やさしい言葉のルール", () => {
  it("ルールに、専門用語を使わないこと・言い換えの例が書かれている", () => {
    expect(PLAIN_LANGUAGE_RULES).toContain("専門用語");
    expect(PLAIN_LANGUAGE_RULES).toContain("小学校高学年");
    expect(PLAIN_LANGUAGE_RULES).toContain("マネタイズ");
  });

  it("1対1のチャットの指示に入っている", () => {
    const p = buildChatSystemPrompt({
      settings: settings as never,
      employee: employee as never,
      roster: [employee] as never,
      openTasks: [],
      todayJst: "2026-11-14",
    });
    expect(p).toContain(PLAIN_LANGUAGE_RULES);
  });

  it("チームの議論・成果物・監査・報告の指示に入っている", () => {
    const ctx = {
      settings,
      task: { title: "テスト業務", description: "", priority: "medium", due_date: null },
      workflow: { phase: "discussion", plan: {}, lead_id: "research", rework_count: 0 },
      speaker: employee,
      roster: [employee],
      members: [],
      messages: [],
      deliverable: null,
      knowledge: [],
      todayJst: "2026-11-14",
    } as never;
    expect(buildTeamContext(ctx)).toContain(PLAIN_LANGUAGE_RULES);
    expect(buildStepInstruction("discussion", ctx)).toContain("やさしい言葉");
    expect(buildStepInstruction("drafting", ctx)).toContain("やさしい言葉");
    // 監査役は言葉づかいの添削はしない（内容だけを見る）
    expect(buildStepInstruction("review", ctx)).toContain("添削はしない");
    expect(buildStepInstruction("final_report", ctx)).toContain("やさしい言葉");
  });

  it("事業・販売に関係する業務だけ、売る場所の選び方（経営者の方針）が入る", () => {
    const base = {
      settings,
      workflow: { phase: "drafting", plan: {}, lead_id: "bizdev", rework_count: 0 },
      speaker: employee,
      roster: [employee],
      members: [],
      messages: [],
      deliverable: null,
      knowledge: [],
      todayJst: "2026-11-14",
    };
    const sales = buildTeamContext({
      ...base,
      task: { title: "販売の準備：テスト", description: "", priority: "medium", due_date: null, business_project_id: "x" },
    } as never);
    expect(sales).toContain("売る場所の選び方（経営者の方針）");
    expect(sales).toContain("無料で始められること");
    const other = buildTeamContext({
      ...base,
      task: { title: "今週の予定を整理", description: "", priority: "medium", due_date: null, business_project_id: null },
    } as never);
    expect(other).not.toContain("売る場所の選び方");
  });
});

describe("売る場所の手取りの計算", () => {
  it("手数料の目安から1件あたりの手取りを出す", () => {
    const by = Object.fromEntries(SALES_CHANNELS.map((c) => [c.id, netPerSale(c, 1000)]));
    expect(by.note).toEqual({ fee: 145, net: 855 }); // 5% + 残りの10%
    expect(by.booth).toEqual({ fee: 101, net: 899 }); // 5.6% + 45円
    expect(by.coconala).toEqual({ fee: 220, net: 780 }); // 22%
    expect(by.mercari_shops).toEqual({ fee: 100, net: 900 }); // 10%
    expect(by.base).toEqual({ fee: 106, net: 894 }); // 3.6% + 40円 + 3%
    expect(by.stripe_links).toEqual({ fee: 36, net: 964 }); // 3.6%
    // 安すぎる値段でも、手取りがマイナスにはならない
    expect(netPerSale(SALES_CHANNELS.find((c) => c.id === "booth")!, 30).net).toBe(0);
  });

  it("経営者の方針とWeb検索での確認の指示が入る", () => {
    const g = buildSalesChannelGuide({ webSearch: true });
    for (const p of SALES_CHANNEL_POLICY) expect(g).toContain(p);
    expect(g).toContain("公式ページで確かめ");
    expect(buildSalesChannelGuide()).toContain("要確認");
  });
});
