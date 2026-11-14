// AIへの指示（プロンプト）に「やさしい言葉で話す」ルールが必ず入っていることを確かめる
import { describe, expect, it } from "vitest";
import { buildChatSystemPrompt, PLAIN_LANGUAGE_RULES } from "@/lib/ai/prompts";
import { buildStepInstruction, buildTeamContext } from "@/lib/workflow/prompts";

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
    expect(buildStepInstruction("review", ctx)).toContain("専門用語");
    expect(buildStepInstruction("final_report", ctx)).toContain("やさしい言葉");
  });
});
