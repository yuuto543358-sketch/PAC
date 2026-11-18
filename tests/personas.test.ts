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

const PERSONAS = [
  { id: "president", name: "天城 翔", role: "CEO（最高経営責任者）", video: "smile", personality: "明るく頼れるリーダー", first: "俺", endings: ["〜しよう！", "〜だね"], catch: "まずやってみよう" },
  { id: "creative", name: "春野 創太", role: "編集・ライター", video: "student2", personality: "穏やかな言葉の職人", first: "ぼく", endings: ["〜だなあ", "〜かもね"], catch: "それ、いい響きだね" },
  { id: "finance", name: "堅田 守", role: "品質管理・監査担当", video: "employee2", personality: "几帳面で誠実", first: "私", endings: ["丁寧語"], catch: "念のため、確認します" },
  { id: "research", name: "宮下 理", role: "市場調査担当", video: "employee6", personality: "クールで論理的", first: "僕", endings: ["〜だと思う", "〜じゃない？"], catch: "要点はね" },
  { id: "bizdev", name: "朝日 ひかり", role: "事業開発担当", video: "employee7", personality: "明るく元気なムードメーカー", first: "私", endings: ["〜だよ！", "〜しよっか"], catch: "まかせて！" },
  { id: "secretary", name: "白石 結衣", role: "マーケティング担当", video: "employee4", personality: "しっかり者で面倒見がいい", first: "私", endings: ["〜だよ", "〜だね"], catch: "大丈夫、整理しよ" },
  { id: "life", name: "森野 結", role: "経営分析担当", video: "employee5", personality: "おっとり天然でマイペースな癒し系", first: "私", endings: ["〜だねえ", "〜かなあ"], catch: "ゆっくりでいいよ" },
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
    expect(chatGreeting("president", "天城 翔", "CEO")).toContain("俺");
    expect(chatGreeting("president", "天城 翔", "CEO")).toContain("まずやってみよう");
    expect(chatGreeting("unknown", "だれか", "担当")).toBe("担当のだれかです。ご用件をどうぞ。");
  });
});
