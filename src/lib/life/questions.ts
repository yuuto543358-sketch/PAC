import "server-only";
import { begin, type Db, type Sql } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { getSettings } from "@/lib/repo/settings";
import { jstDateParts } from "@/lib/format";
import { addRecord, latestRecords, listCategories, listFields } from "./repo";
import { isQuestionDay, nextQuestionDay, planQuestions, type Candidate, type LastQuestion } from "./planner";

// AI社員（ライフ担当）からの質問。一度に1〜3問だけ。回答待ちがたまっているときは増やさない。

export const LIFE_EMPLOYEE_ID = "life";
/** 回答待ちがこれ以上あれば、新しい質問は作らない */
const MAX_PENDING = 3;
/** 回答されないまま、この日数がたった質問は「期限切れ」にする */
const EXPIRE_DAYS = 14;
/** 「後で回答」を選んだ質問を、もう一度出すまでの日数 */
const LATER_DAYS = 2;
/** 本人の回答がこの数より少ないあいだは「使い始め」として、毎日少しずつ聞く */
const ONBOARDING_RECORDS = 8;

export type LifeQuestion = {
  id: string;
  field_id: string | null;
  text: string;
  reason: string;
  status: string;
  source: string;
  batch_on: string;
  period_start: string | null;
  period_end: string | null;
  asked_at: Date;
  answered_at: Date | null;
  remind_after: Date | null;
  record_id: string | null;
  field_label: string | null;
  value_type: string | null;
  unit: string | null;
  choices: string[] | null;
  category_id: string | null;
};

const Q_SELECT = `
  select q.id, q.field_id, q.text, q.reason, q.status, q.source, to_char(q.batch_on, 'YYYY-MM-DD') as batch_on,
    to_char(q.period_start, 'YYYY-MM-DD') as period_start, to_char(q.period_end, 'YYYY-MM-DD') as period_end,
    q.asked_at, q.answered_at, q.remind_after, q.record_id,
    f.label as field_label, f.value_type, f.unit, f.choices, f.category_id
  from life_questions q left join life_fields f on f.id = q.field_id`;

export async function listQuestions(db: Db, statuses: string[], limit = 50): Promise<LifeQuestion[]> {
  return db.unsafe<LifeQuestion[]>(
    `${Q_SELECT} where q.status = any($1::text[]) order by q.asked_at desc limit ${Math.min(Math.max(limit, 1), 200)}`,
    [statuses],
  );
}

/** 回答待ちとして画面に出す質問（「後で」を選んで、もう一度出す時期が来たものも含む） */
export async function openQuestions(db: Db): Promise<LifeQuestion[]> {
  return db.unsafe<LifeQuestion[]>(
    `${Q_SELECT} where q.status = 'pending' or (q.status = 'later' and q.remind_after <= now())
     order by q.asked_at limit 20`,
    [],
    { simple: false },
  );
}

async function lastQuestionsByField(db: Db): Promise<Map<string, LastQuestion>> {
  const rows = await db<({ field_id: string } & LastQuestion)[]>`
    select distinct on (field_id) field_id, status, asked_at, remind_after, to_char(period_end, 'YYYY-MM-DD') as period_end
    from life_questions where field_id is not null order by field_id, asked_at desc`;
  return new Map(rows.map((r) => [r.field_id, r]));
}

async function countOwnerRecords(db: Db) {
  const [r] = await db<{ n: number }[]>`select count(distinct field_id)::int as n from life_records where source = 'owner'`;
  return r.n;
}

export async function previewNextQuestions(db: Db, now = new Date()): Promise<{ candidates: Candidate[]; nextDay: string | null }> {
  const settings = await getSettings(db);
  const { date, weekday } = jstDateParts(now);
  const [fields, categories, latest, lastQ, owned] = await Promise.all([
    listFields(db),
    listCategories(db),
    latestRecords(db),
    lastQuestionsByField(db),
    countOwnerRecords(db),
  ]);
  const candidates = planQuestions({ fields, categories, latest, lastQuestions: lastQ, today: date, now, limit: settings.life_questions_per_batch });
  return { candidates, nextDay: nextQuestionDay(settings.life_question_frequency, date, weekday, owned < ONBOARDING_RECORDS) };
}

export type BatchResult = { created: number; message: string; questionIds: string[] };

/**
 * 質問を作る。trigger='scheduled' のときは頻度の設定に従う（manual は「今すぐ質問をもらう」ボタン）。
 */
export async function createQuestionBatch(sql: Sql, trigger: "manual" | "scheduled", now = new Date()): Promise<BatchResult> {
  const settings = await getSettings(sql);
  const { date, weekday } = jstDateParts(now);
  const owned = await countOwnerRecords(sql);
  if (trigger === "scheduled" && !isQuestionDay(settings.life_question_frequency, weekday, owned < ONBOARDING_RECORDS)) {
    return { created: 0, message: "今日は質問の日ではありません", questionIds: [] };
  }
  return begin(sql, async (tx) => {
    // 同時に2か所で作らないようにする
    await tx`select pg_advisory_xact_lock(hashtext('pac_life_questions'))`;
    await tx`
      update life_questions set status = 'expired'
      where status in ('pending','later') and asked_at < now() - ${`${EXPIRE_DAYS} days`}::interval`;
    // 「後で」の時期が来た質問は、回答待ちに戻す
    await tx`update life_questions set status = 'pending', remind_after = null where status = 'later' and remind_after <= now()`;
    const [{ n: pending }] = await tx<{ n: number }[]>`select count(*)::int as n from life_questions where status = 'pending'`;
    const room = Math.min(settings.life_questions_per_batch, MAX_PENDING - pending);
    if (room <= 0) return { created: 0, message: "まだ回答待ちの質問があるので、新しい質問は作りませんでした", questionIds: [] };
    const [fields, categories, latest, lastQ] = await Promise.all([
      listFields(tx),
      listCategories(tx),
      latestRecords(tx),
      lastQuestionsByField(tx),
    ]);
    const picks = planQuestions({ fields, categories, latest, lastQuestions: lastQ, today: date, now, limit: room });
    const ids: string[] = [];
    for (const c of picks) {
      const [row] = await tx<{ id: string }[]>`
        insert into life_questions (field_id, text, reason, source, employee_id, batch_on, period_start, period_end)
        values (${c.field.id}, ${c.text}, ${c.reason}, 'rule', ${LIFE_EMPLOYEE_ID}, ${date}::date, ${c.periodStart}, ${c.periodEnd})
        returning id`;
      ids.push(row.id);
    }
    return {
      created: ids.length,
      message: ids.length ? `質問を${ids.length}問作りました` : "いま聞くことはありません（情報は十分そろっています）",
      questionIds: ids,
    };
  });
}

export type AnswerAction = "answer" | "skip" | "later" | "unknown";

/** 質問に答える（またはスキップ・後で・分からない）。回答は生活情報として記録される */
export async function answerQuestion(sql: Sql, questionId: string, action: AnswerAction, raw = "") {
  if (!/^[0-9a-f-]{36}$/i.test(questionId)) throw new Error("質問が見つかりません");
  return begin(sql, async (tx) => {
    const [q] = await tx<{ field_id: string | null; status: string; period_start: string | null; period_end: string | null }[]>`
      select field_id, status, to_char(period_start, 'YYYY-MM-DD') as period_start, to_char(period_end, 'YYYY-MM-DD') as period_end
      from life_questions where id = ${questionId} for update`;
    if (!q) throw new Error("質問が見つかりません");
    if (q.status !== "pending" && q.status !== "later") throw new Error("この質問には、もう答えています");
    if (action === "answer") {
      if (!q.field_id) throw new Error("この質問には答えられません");
      const recordId = await addRecord(tx, {
        fieldId: q.field_id,
        raw,
        source: "owner",
        periodStart: q.period_start,
        periodEnd: q.period_end,
        questionId,
      });
      await tx`
        update life_questions set status = 'answered', answered_at = now(), record_id = ${recordId}, remind_after = null
        where id = ${questionId}`;
      return { status: "answered" as const, recordId };
    }
    if (action === "later") {
      await tx`
        update life_questions set status = 'later', remind_after = now() + ${`${LATER_DAYS} days`}::interval
        where id = ${questionId}`;
      return { status: "later" as const };
    }
    const status = action === "skip" ? "skipped" : "unknown";
    await tx`update life_questions set status = ${status}, answered_at = now(), remind_after = null where id = ${questionId}`;
    return { status };
  });
}

export async function updateLifeSettings(
  sql: Sql,
  s: { frequency: string; perBatch: number; autoTask: boolean; review?: boolean; prep?: boolean; nudge?: boolean; research?: boolean },
) {
  if (!["off", "low", "normal", "high"].includes(s.frequency)) throw new Error("頻度が正しくありません");
  if (!(s.perBatch >= 1 && s.perBatch <= 3)) throw new Error("1回の質問数は1〜3問にしてください");
  await sql`
    update company_settings set life_question_frequency = ${s.frequency}, life_questions_per_batch = ${s.perBatch},
      life_auto_task = ${s.autoTask}, life_review_enabled = ${s.review ?? true}, life_prep_enabled = ${s.prep ?? true},
      life_nudge_enabled = ${s.nudge ?? true}, life_research_enabled = ${s.research ?? true}, updated_at = now()
    where id = 1`;
  await audit(sql, "owner", "life_settings_updated", "company_settings", "1", s);
}
