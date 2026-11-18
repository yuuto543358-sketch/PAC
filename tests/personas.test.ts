// 社員7人の性格・話し方（ペルソナ）のテスト。
// AIの応答そのもの（本物のAI）はテストでは呼べないので、「AIへの指示に、その社員の話し方と守るルールが必ず入ること」と
// 「データベースの設定」「固定文のあいさつ」を確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { getEmployee, listEmployees } from "@/lib/repo/employees";
import { buildChatSystemPrompt } from "@/lib/ai/prompts";
import { buildTeamContext } from "@/lib/workflow/prompts";
import { chatGreeting } from "@/lib/greetings";
import { SEED_EMPLOYEES } from "@/lib/db/seed";
import { ARTICLE_STYLE_RULES } from "@/lib/mediaco/style";
import { writeTask } from "@/lib/mediaco/engine";
import { buildStepInstruction } from "@/lib/workflow/prompts";

// 【訂正版】（経営者の指示 2026年11月）。名前はテスト用データベースの名前（経営者は画面で名前を変えていることがあるので、社員は id で指定している）
const PERSONAS = [
  { id: "president", name: "天城 翔", role: "CEO（最高経営責任者）", video: "smile", personality: "笑顔が印象的な明るいリーダー", first: "俺", endings: [] as string[], catch: "まずやってみよう" },
  { id: "bizdev", name: "朝日 ひかり", role: "事業開発担当", video: "employee7", personality: "爽やかでフットワークの軽い開拓者", first: "僕", endings: ["〜しようよ", "〜だね"], catch: "それ、面白そう！" },
  { id: "research", name: "宮下 理", role: "市場調査担当", video: "employee6", personality: "笑うと目が細くなる優しい聞き上手", first: "私", endings: [], catch: "なるほど、面白いね" },
  { id: "creative", name: "春野 創太", role: "編集・ライター", video: "student2", personality: "穏やかな言葉の職人", first: "ぼく", endings: [], catch: "それ、いい響きだね" },
  { id: "secretary", name: "白石 結衣", role: "マーケティング担当", video: "employee4", personality: "トレンドに敏感で人懐っこい", first: "僕", endings: ["〜だね！"], catch: "それ、ウケそう！" },
  { id: "finance", name: "堅田 守", role: "品質管理・監査担当", video: "employee2", personality: "几帳面で誠実", first: "私", endings: ["丁寧語"], catch: "念のため、確認します" },
  { id: "life", name: "森野 結", role: "経営分析担当", video: "employee5", personality: "静かで洞察の鋭い数字派", first: "僕", endings: [], catch: "数字がそう言ってる" },
];

beforeAll(async () => {
  await closeDb();
});
afterAll(async () => {
  await closeDb();
});

describe("社員のペルソナ（データベースの設定）", () => {
  it("7人それぞれに、決めた性格と話し方（一人称・語尾・口癖・トーン）が入っている", async () => {
    const sql = await getDb();
    for (const p of PERSONAS) {
      const e = (await getEmployee(sql, p.id))!;
      expect(e.personality).toContain(p.personality);
      expect(e.speaking_style).toContain(`一人称は「${p.first}」`);
      for (const end of p.endings) expect(e.speaking_style).toContain(end);
      expect(e.speaking_style).toContain(`口癖は「${p.catch}」`);
    }
  });

  it("名前・役職・動画の割り当ては変わっていない", async () => {
    const sql = await getDb();
    for (const p of PERSONAS) {
      const e = (await getEmployee(sql, p.id))!;
      expect(e.name).toBe(p.name);
      expect(e.role_title).toBe(p.role);
      expect((e.avatar_videos as Record<string, string>).idle).toBe(`/avatars/${p.video}/idle.mp4`);
    }
  });

  it("新しく入れたときの初期データも同じペルソナ", () => {
    for (const p of PERSONAS) {
      const e = SEED_EMPLOYEES.find((x) => x.id === p.id)!;
      expect(e.speaking_style).toContain(`一人称は「${p.first}」`);
      expect(e.speaking_style).toContain(`口癖は「${p.catch}」`);
      expect(e.personality).toContain(p.personality);
    }
  });
});

describe("AIへの指示に、その社員の話し方が入る", () => {
  const settings = { company_name: "テスト会社", philosophy: "理念", custom_rules: "" };

  it("1対1のチャット：本人の性格・話し方と「一人称・語尾・口癖を守る」ルールが入る", async () => {
    const sql = await getDb();
    const roster = await listEmployees(sql);
    for (const p of PERSONAS) {
      const e = roster.find((x) => x.id === p.id)!;
      const prompt = buildChatSystemPrompt({ settings: settings as never, employee: e as never, roster: roster as never, openTasks: [], todayJst: "2026-11-18" });
      expect(prompt).toContain(`- 話し方: ${e.speaking_style}`);
      expect(prompt).toContain(`- 性格: ${e.personality}`);
      expect(prompt).toContain("一人称・語尾・口癖・トーンを、いつも守る");
      expect(prompt).toContain("一人称はほかの言い方に変えない");
      expect(prompt).toContain("口癖は合う場面で自然に使う");
    }
  });

  it("チームのグループチャット：発言する社員の話し方とルールが入る", async () => {
    const sql = await getDb();
    const roster = await listEmployees(sql);
    for (const p of PERSONAS) {
      const e = roster.find((x) => x.id === p.id)!;
      const ctx = buildTeamContext({
        settings,
        task: { title: "記事の企画", description: "", priority: "medium", due_date: null },
        workflow: { phase: "discussion", plan: {}, lead_id: p.id, rework_count: 0 },
        speaker: e,
        roster,
        members: [],
        messages: [],
        deliverable: null,
        knowledge: [],
        todayJst: "2026-11-18",
      } as never);
      expect(ctx).toContain(`- 話し方: ${e.speaking_style}`);
      expect(ctx).toContain("一人称・語尾・口癖・トーンを、いつも守る");
    }
  });
});

describe("チャットを開いたときのあいさつ（固定文）", () => {
  it("7人それぞれの話し方になっている（一人称か口癖が入る）", () => {
    for (const p of PERSONAS) {
      const g = chatGreeting(p.id, p.name, p.role);
      expect(g).toContain(p.name);
      expect(g.includes(p.first) || g.includes(p.catch)).toBe(true);
    }
    // 名前を画面で変えていても、その名前であいさつする
    expect(chatGreeting("bizdev", "朝日 光", "事業開発担当")).toContain("朝日 光");
    expect(chatGreeting("secretary", "白石 結", "マーケティング担当")).toContain("白石 結");
    expect(chatGreeting("president", "天城 翔", "CEO")).toContain("俺");
    expect(chatGreeting("president", "天城 翔", "CEO")).toContain("まずやってみよう");
    expect(chatGreeting("unknown", "だれか", "担当")).toBe("担当のだれかです。ご用件をどうぞ。");
  });
});

describe("全員男性（女性を前提にした言葉が残っていない）", () => {
  it("性格・話し方に「姉御肌」などが入っていない", async () => {
    const sql = await getDb();
    for (const e of await listEmployees(sql)) {
      expect(`${e.personality}${e.speaking_style}`).not.toMatch(/姉御|彼女|女性/);
    }
  });
});

describe("記事の文面：読者に話しかける口調", () => {
  it("記事の書き方のルールに、堅い報告書の文体にしない・一人称と二人称で語りかける・共感から書き出す・会話の流れ、が入っている", () => {
    expect(ARTICLE_STYLE_RULES).toContain("報告書のような堅い文体にしない");
    expect(ARTICLE_STYLE_RULES).toContain("二人称で語りかける");
    expect(ARTICLE_STYLE_RULES).toContain("共感するところから入る");
    expect(ARTICLE_STYLE_RULES).toContain("会話の流れのようにつなぐ");
    expect(ARTICLE_STYLE_RULES).toContain("個性（話し方）は少しだけ残してよい");
    // 語りかけても、事実のルールは変えない
    expect(ARTICLE_STYLE_RULES).toContain("調べた情報にないことは書かない");
  });

  it("メディアの記事を書く・直すときの指示に入る", () => {
    const t = writeTask({ theme: "家計の見直し", target: "20代", reader_pain: "お金が残らない", kind: "free", price_jpy: 0, research_notes: "" } as never);
    expect(t).toContain(ARTICLE_STYLE_RULES);
  });

  it("チームで note の記事を作るときの指示にも入る", () => {
    const ctx = {
      settings: { company_name: "テスト会社", philosophy: "", custom_rules: "" },
      task: { title: "節約のnote記事を作って", description: "", priority: "medium", due_date: null },
      workflow: { phase: "drafting", plan: {}, lead_id: "creative", rework_count: 0 },
      speaker: SEED_EMPLOYEES[0],
      roster: [],
      members: [],
      messages: [],
      deliverable: null,
      knowledge: [],
      todayJst: "2026-11-18",
    };
    expect(buildStepInstruction("drafting", ctx as never)).toContain("報告書のような堅い文体にしない");
  });
});
