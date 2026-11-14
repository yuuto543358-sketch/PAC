import "server-only";
import { z } from "zod";
import type { Db, Sql } from "@/lib/db";
import { AiUnavailableError, BudgetBlockedError, callStructured } from "@/lib/ai/client";
import { PLAIN_LANGUAGE_RULES } from "@/lib/ai/prompts";
import { getEmployee } from "@/lib/repo/employees";
import { getSettings } from "@/lib/repo/settings";
import { listCheckins, qolScore } from "./checkins";
import { listEvents } from "./events";
import { listGoals } from "./goals";
import { habitProgressList } from "./habits";
import { addDays } from "./planner";
import { LIFE_EMPLOYEE_ID } from "./questions";

// 変化に気づいて声かけ：毎日の記録から、プログラムが変化を見つける（AIは使わない）。
// 見つけたときだけ、森野がやさしい「ひとこと」に書き直す（AI・1日1回まで）。AIが使えなければ決まった文で送る。

export type NudgeCandidate = { kind: string; subject: string; title: string; body: string; url: string };

export async function detectNudges(db: Db, today: string): Promise<NudgeCandidate[]> {
  const [checkins, habits, goals, events] = await Promise.all([
    listCheckins(db, addDays(today, -14)),
    habitProgressList(db, today),
    listGoals(db, today),
    listEvents(db, today),
  ]);
  const out: NudgeCandidate[] = [];
  const recent = checkins.slice(-3);
  const consecutive = recent.length === 3 && recent[2].check_date >= addDays(today, -1) && recent[0].check_date === addDays(recent[2].check_date, -2);
  if (consecutive && recent.every((c) => qolScore(c) <= 2.5)) {
    out.push({ kind: "qol_low", subject: "", title: "ここ3日、調子が低めです", body: "無理をしすぎていませんか。今日は早めに休むなど、自分をいたわる時間をとってみてください。", url: "/life/checkins" });
  } else if (consecutive && qolScore(recent[0]) > qolScore(recent[1]) && qolScore(recent[1]) > qolScore(recent[2]) && qolScore(recent[2]) <= 3) {
    out.push({ kind: "qol_down", subject: "", title: "調子が少しずつ下がっています", body: "気になることがあれば、森野に話してみてください。小さなことでも大丈夫です。", url: "/employees/life/chat" });
  }
  if (checkins.length > 0 && checkins[checkins.length - 1].check_date < addDays(today, -3)) {
    out.push({ kind: "no_checkin", subject: "", title: "最近、毎日のチェックがお休みです", body: "10秒だけ、今日の調子をタップしてみませんか。", url: "/" });
  }
  const week = checkins.filter((c) => c.check_date >= addDays(today, -6));
  if (week.length >= 4 && week.reduce((a, c) => a + c.sleep, 0) / week.length <= 2.3) {
    out.push({ kind: "sleep_low", subject: "", title: "この1週間、眠りが浅い日が多いようです", body: "寝る前の過ごし方を少し変えると、楽になるかもしれません。", url: "/life/checkins" });
  }
  for (const h of habits) {
    if (h.frequency !== "daily" || h.start_date > addDays(today, -5)) continue;
    const last3 = [1, 2, 3].map((d) => addDays(today, -d));
    const doneBefore = h.recent.length > 0 || h.streak > 0;
    if (!h.doneToday && last3.every((d) => !h.recent.includes(d)) && doneBefore) {
      out.push({ kind: "habit_break", subject: h.id, title: `「${h.title}」が3日お休みしています`, body: "また今日から1回だけ、やってみませんか。続けるより「戻ること」が大事です。", url: "/life/habits" });
    }
  }
  for (const g of goals.filter((x) => x.behind)) {
    out.push({ kind: "goal_behind", subject: g.id, title: `「${g.title}」が少し遅れ気味です`, body: "目標を少し小さくするか、期限を見直すのもひとつの方法です。", url: `/life/goals/${g.id}` });
  }
  for (const e of events.filter((x) => x.daysLeft != null && x.daysLeft < 0)) {
    out.push({ kind: "event_overdue", subject: e.id, title: `「${e.title}」の日を過ぎています`, body: "済んでいたら「済んだ」を押してください。まだなら、早めに対応しましょう。", url: "/life/events" });
  }
  return out;
}

const RewriteSchema = z.object({
  messages: z.array(z.object({ index: z.number(), title: z.string().describe("30字以内"), body: z.string().describe("60字以内。やさしく、責めない") })),
});

export async function runNudges(sql: Sql, today: string): Promise<number> {
  const settings = await getSettings(sql);
  if (!settings.life_nudge_enabled) return 0;
  const found = await detectNudges(sql, today);
  if (found.length === 0) return 0;
  // 同じ内容は7日以内に二度言わない
  const recent = await sql<{ kind: string; subject: string }[]>`
    select kind, subject from life_nudges where created_at > now() - interval '7 days'`;
  const fresh = found.filter((n) => !recent.some((r) => r.kind === n.kind && r.subject === n.subject)).slice(0, 3);
  if (fresh.length === 0) return 0;
  let texts = fresh.map((n) => ({ title: n.title, body: n.body }));
  let aiUsed = false;
  const employee = await getEmployee(sql, LIFE_EMPLOYEE_ID);
  if (!settings.emergency_stop && employee) {
    try {
      const r = await callStructured(sql, {
        model: settings.model_standard,
        effort: "low",
        maxTokens: 800,
        system: `あなたはAI社員「${employee.name}」（ライフ担当）です。性格：${employee.personality}／話し方：${employee.speaking_style}
経営者の記録から気づいたことを、友だちのようにやさしく、短いひとことに書き直してください。責めない・こわがらせない・診断しない。事実（下の文）は変えない。
${PLAIN_LANGUAGE_RULES}`,
        messages: [{ role: "user", content: JSON.stringify(fresh.map((n, i) => ({ index: i, title: n.title, body: n.body }))) }],
        schema: RewriteSchema,
        schemaName: "life_nudges",
        purpose: "life:nudge",
        employeeId: LIFE_EMPLOYEE_ID,
        mock: () => ({ messages: fresh.map((n, i) => ({ index: i, title: n.title, body: `【テスト用モック】${n.body}` })) }),
      });
      if (r.ok) {
        texts = fresh.map((n, i) => {
          const m = r.data.messages.find((x) => x.index === i);
          return m?.title.trim() && m.body.trim() ? { title: m.title.slice(0, 60), body: m.body.slice(0, 200) } : { title: n.title, body: n.body };
        });
        aiUsed = true;
      }
    } catch (err) {
      if (!(err instanceof BudgetBlockedError || err instanceof AiUnavailableError)) throw err;
    }
  }
  for (let i = 0; i < fresh.length; i++) {
    await sql`
      insert into life_nudges (kind, subject, title, body, url, ai_used)
      values (${fresh[i].kind}, ${fresh[i].subject}, ${texts[i].title}, ${texts[i].body}, ${fresh[i].url}, ${aiUsed})`;
  }
  return fresh.length;
}

export type Nudge = { id: string; kind: string; title: string; body: string; url: string; created_at: Date };

export async function activeNudges(db: Db): Promise<Nudge[]> {
  return db<Nudge[]>`
    select id, kind, title, body, url, created_at from life_nudges
    where dismissed_at is null and created_at > now() - interval '4 days' order by created_at desc limit 5`;
}

export async function dismissNudge(sql: Sql, id: string) {
  await sql`update life_nudges set dismissed_at = now() where id = ${id} and dismissed_at is null`;
}
