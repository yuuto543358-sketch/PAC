import "server-only";
import type { Db, Sql, Tx } from "@/lib/db";
import { begin } from "@/lib/db";
import { addDaysJst, jstDateParts } from "@/lib/format";
import { createTask } from "@/lib/repo/tasks";
import { audit } from "@/lib/repo/audit";
import { initWorkflow } from "@/lib/workflow/repo";
import { productByFormat, requestedProductFor } from "@/lib/workflow/product";

// 「作り続けるシリーズ」：動画やnote記事を承認したら、そこで終わりにせず、次の回を自動で作り始めます。
// - 間隔は「何日ごとか」で決める（はじめは3日ごと＝週2〜3本）
// - 作っている途中の回があるときは、次の回を作らない
// - 承認待ちの回が2本たまったら、あなたが確認するまで次の回を作らない（作りすぎ・費用の使いすぎを防ぐ）
// - 費用の上限・緊急停止は、ふつうどおりAIを呼ぶ前に確認される

/** シリーズにする成果品の形式 */
export const SERIES_FORMATS = ["video_script", "note_article"] as const;
/** はじめの間隔（日）。週2〜3本 */
export const DEFAULT_INTERVAL_DAYS = 3;
/** 承認待ちがこの本数たまったら、次の回を作らない */
export const MAX_WAITING_EPISODES = 2;

export type Series = {
  id: string;
  title: string;
  theme: string;
  product_format: string;
  source_task_id: string | null;
  episodes: number;
  interval_days: number;
  active: boolean;
  next_run_on: string | null;
  last_task_id: string | null;
  created_at: Date;
};

const SELECT = `select id, title, theme, product_format, source_task_id, episodes, interval_days, active,
  to_char(next_run_on, 'YYYY-MM-DD') as next_run_on, last_task_id, created_at from content_series`;

export async function listSeries(db: Db): Promise<Series[]> {
  return db.unsafe<Series[]>(`${SELECT} order by active desc, created_at desc`, [], { simple: false });
}

export async function getSeries(db: Db, id: string): Promise<Series | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.unsafe<Series[]>(`${SELECT} where id = $1`, [id]);
  return rows[0] ?? null;
}

/** 「（第3回）」などを取った、シリーズの名前 */
export function baseTitle(title: string) {
  return title.replace(/[（(]第\d+回[）)]\s*$/, "").replace(/[（(]テスト[^）)]*[）)]\s*$/, "").trim().slice(0, 120) || title.slice(0, 120);
}

/**
 * 成果物が承認されたとき：動画・note記事ならシリーズを始める（すでにシリーズの回なら、次の予定を決め直す）。
 * 承認の処理と同じトランザクションの中で呼ばれます。
 */
export async function onEpisodeAccepted(tx: Tx, taskId: string, today: string): Promise<Series | null> {
  const [task] = await tx<{ id: string; title: string; description: string; source: string; product_format: string | null; series_id: string | null }[]>`
    select id, title, description, source, product_format, series_id from tasks where id = ${taskId}`;
  if (!task) return null;
  const owner = await tx<{ content: string }[]>`
    select content from task_messages where task_id = ${taskId} and author_type = 'owner' order by id`;
  const product = requestedProductFor(task, owner.map((m) => m.content));
  if (!product || !(SERIES_FORMATS as readonly string[]).includes(product.format)) return null;

  if (task.series_id) {
    const [s] = await tx<{ id: string }[]>`
      update content_series set last_task_id = ${taskId},
        next_run_on = case when active then coalesce(next_run_on, ${addDaysJst(today, DEFAULT_INTERVAL_DAYS)}::date) else next_run_on end,
        updated_at = now()
      where id = ${task.series_id} returning id`;
    return s ? getSeries(tx, s.id) : null;
  }
  const [created] = await tx<{ id: string }[]>`
    insert into content_series (title, theme, product_format, source_task_id, episodes, interval_days, active, next_run_on, last_task_id)
    values (${baseTitle(task.title)}, ${task.description.slice(0, 2000)}, ${product.format}, ${taskId}, 1, ${DEFAULT_INTERVAL_DAYS}, true,
      ${addDaysJst(today, DEFAULT_INTERVAL_DAYS)}::date, ${taskId})
    on conflict (source_task_id) do nothing
    returning id`;
  if (!created) return null;
  await tx`update tasks set series_id = ${created.id}, series_episode = 1 where id = ${taskId}`;
  await audit(tx, "system", "series_started", "content_series", created.id, { title: baseTitle(task.title), format: product.format });
  return getSeries(tx, created.id);
}

/** 経営者がシリーズの間隔・オン/オフを変える */
export async function updateSeries(sql: Sql, id: string, opts: { active?: boolean; intervalDays?: number }, today: string) {
  await begin(sql, async (tx) => {
    const [s] = await tx<{ id: string; active: boolean; next_run_on: string | null }[]>`
      select id, active, to_char(next_run_on, 'YYYY-MM-DD') as next_run_on from content_series where id = ${id} for update`;
    if (!s) throw new Error("シリーズが見つかりません");
    const interval = opts.intervalDays != null ? Math.min(30, Math.max(1, Math.round(opts.intervalDays))) : null;
    const active = opts.active ?? s.active;
    // 再開したときは、今日から間隔をあけて次の回を作る
    const next = active && (!s.active || !s.next_run_on) ? addDaysJst(today, interval ?? DEFAULT_INTERVAL_DAYS) : s.next_run_on;
    await tx`
      update content_series set active = ${active}, interval_days = ${interval ?? tx`interval_days`},
        next_run_on = ${next}, updated_at = now()
      where id = ${id}`;
    await audit(tx, "owner", "series_updated", "content_series", id, { active, intervalDays: interval });
  });
}

export type SeriesRunResult = { created: { seriesId: string; taskId: string; episode: number }[]; waiting: string[] };

/** 予定日になったシリーズの、次の回を作り始める（定期実行から呼ばれる。AIはここでは使わない） */
export async function runDueSeries(sql: Sql, now: Date = new Date()): Promise<SeriesRunResult> {
  const { date: today } = jstDateParts(now);
  const result: SeriesRunResult = { created: [], waiting: [] };
  const due = await sql<{ id: string }[]>`
    select id from content_series where active and next_run_on is not null and next_run_on <= ${today}::date order by next_run_on`;
  for (const { id } of due) {
    // 1) 次の回を作ってよいかを確かめ、予定を先に進めておく（同時に2回動いても二重に作らない）
    const claim = await begin(sql, async (tx) => {
      const [s] = await tx<Series[]>`
        select id, title, theme, product_format, episodes, interval_days, active, to_char(next_run_on, 'YYYY-MM-DD') as next_run_on
        from content_series where id = ${id} for update`;
      if (!s || !s.active || !s.next_run_on || s.next_run_on > today) return null;
      const [{ producing, waiting }] = await tx<{ producing: number; waiting: number }[]>`
        select
          count(*) filter (where w.phase not in ('waiting_human','done','stopped') and t.status not in ('completed','rejected','failed'))::int as producing,
          count(*) filter (where w.phase = 'waiting_human' and w.waiting_reason = 'acceptance' and t.status <> 'completed')::int as waiting
        from tasks t join task_workflows w on w.task_id = t.id
        where t.series_id = ${id}`;
      if (producing > 0) return { kind: "wait" as const, waiting: `${s.title}（作っている途中の回があります）` };
      if (waiting >= MAX_WAITING_EPISODES) return { kind: "wait" as const, waiting: `${s.title}（承認待ちが${waiting}本あります）` };
      const past = await tx<{ title: string; dtitle: string | null }[]>`
        select t.title, (select d.title from deliverables d where d.task_id = t.id order by d.version desc limit 1) as dtitle
        from tasks t where t.series_id = ${id} order by t.series_episode desc nulls last limit 12`;
      const episode = s.episodes + 1;
      await tx`
        update content_series set episodes = ${episode}, next_run_on = ${addDaysJst(today, s.interval_days)}::date, updated_at = now()
        where id = ${id}`;
      return { kind: "go" as const, series: s, episode, past };
    });
    if (!claim) continue;
    if (claim.kind === "wait") {
      result.waiting.push(claim.waiting);
      continue;
    }

    // 2) 次の回の業務を登録して、チームに渡す
    const { series: s, episode, past } = claim;
    const label = productByFormat(s.product_format)?.label ?? "成果品";
    const created = await createTask(sql, {
      title: `${s.title}（第${episode}回）`,
      description: [
        `シリーズ「${s.title}」の第${episode}回の${label}を作ってください。`,
        s.theme ? `シリーズのテーマ・はじめの依頼: ${s.theme}` : "",
        past.length ? `これまでの回（同じ内容・同じ切り口にしない）:\n${past.map((p) => `- ${p.dtitle ?? p.title}`).join("\n")}` : "",
        `調べるだけで終わらせず、${label}の完成品まで作る。`,
      ]
        .filter(Boolean)
        .join("\n"),
      source: "scheduled",
      productFormat: s.product_format,
      seriesId: id,
      seriesEpisode: episode,
      allowSimilar: true,
      createdBy: { type: "employee", employeeId: "president" },
    });
    if (!created.created) {
      // 登録できなければ、予定を元に戻す
      await sql`update content_series set episodes = ${episode - 1}, next_run_on = ${today}::date where id = ${id} and episodes = ${episode}`;
      result.waiting.push(`${s.title}（登録できませんでした）`);
      continue;
    }
    await initWorkflow(sql, created.task.id, true);
    await sql`update content_series set last_task_id = ${created.task.id}, updated_at = now() where id = ${id}`;
    await audit(sql, "system", "series_episode_started", "content_series", id, { episode, taskId: created.task.id });
    result.created.push({ seriesId: id, taskId: created.task.id, episode });
  }
  return result;
}
