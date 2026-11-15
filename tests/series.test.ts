// 動画の実物（場面の絵・ナレーションの声）づくりと、作り続けるシリーズのテスト（AIはテスト用のモック）
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { createTask } from "@/lib/repo/tasks";
import { decideApproval } from "@/lib/repo/approvals";
import { mockHooks } from "@/lib/ai/client";
import { getWorkflow, initWorkflow, listDeliverables, listRoomMessages } from "@/lib/workflow/repo";
import { runWorkflows, phaseAfterCheck } from "@/lib/workflow/engine";
import { listMediaAssets } from "@/lib/media/repo";
import { remakeMissingMedia } from "@/lib/media/produce";
import { baseTitle, getSeries, runDueSeries, updateSeries } from "@/lib/series";
import { addDaysJst, jstDateParts } from "@/lib/format";
import { isTextModel } from "@/lib/pricing";
import { productByFormat } from "@/lib/workflow/product";

const today = jstDateParts(new Date()).date;
const dayAt = (date: string) => new Date(`${date}T03:00:00Z`); // 日本時間の正午

async function newTask(title: string, description = "") {
  const sql = await getDb();
  const r = await createTask(sql, {
    title: `${title}（テスト${crypto.randomUUID()}${crypto.randomUUID()}）`,
    description,
    source: "user",
    createdBy: { type: "user" },
  });
  if (!r.created) throw new Error("not created");
  await initWorkflow(sql, r.task.id, true);
  return { sql, taskId: r.task.id };
}

async function runAll(taskIds: string[]) {
  const sql = await getDb();
  return runWorkflows(sql, { taskIds, maxSteps: 40, deadlineMs: 60_000 });
}

async function acceptLatest(taskId: string) {
  const sql = await getDb();
  const [a] = await sql<{ id: string; content_hash: string; after_effect: string }[]>`
    select id, content_hash, after_effect from approvals where task_id = ${taskId} and action_type = 'accept_deliverable' and status = 'pending'`;
  if (!a) {
    const wf = await getWorkflow(sql, taskId);
    const last = await sql<{ content: string }[]>`select content from task_messages where task_id = ${taskId} order by id desc limit 3`;
    throw new Error(`承認待ちがありません：phase=${wf?.phase} reason=${wf?.waiting_reason} 最近の発言=${last.map((m) => m.content.slice(0, 80)).join(" / ")}`);
  }
  await decideApproval(sql, a.id, "approve", "", a.content_hash);
  return a;
}

beforeAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  const sql = await getDb();
  await sql`update budgets set monthly_limit_jpy = 100000, emergency_stop_jpy = 100000, daily_limit_jpy = 100000,
    max_calls_per_day = 2000, max_calls_per_minute = 60, max_calls_per_task = 20, per_task_limit_jpy = 30, per_video_limit_jpy = 100`;
  await sql`update company_settings set emergency_stop = false`;
  // ほかのテストのシリーズは止めておく
  await sql`update content_series set active = false`;
  mockHooks.failNext = 0;
  await sql.begin(async (tx) => {
    await tx`alter table api_usage disable trigger api_usage_guard`;
    await tx`update api_usage set created_at = created_at - interval '2 minutes' where created_at > now() - interval '2 minutes'`;
    await tx`alter table api_usage enable trigger api_usage_guard`;
  });
});
afterAll(async () => {
  const sql = await getDb();
  // ほかのテスト（定期実行の結果を見るもの）に影響しないよう、シリーズを止めておく
  await sql`update content_series set active = false`;
  await closeDb();
});

describe("動画の実物：場面の絵とナレーションの声", () => {
  it("動画を頼むと、台本のあとに場面ごとの絵と声を作ってから、承認の依頼が来る", async () => {
    const { sql, taskId } = await newTask("家事の時短テクのショート動画を作る");
    await runAll([taskId]);
    const wf = (await getWorkflow(sql, taskId))!;
    expect(wf.phase).toBe("waiting_human");
    const [d] = await listDeliverables(sql, taskId);
    expect(d.format).toBe("video_script");
    const assets = await listMediaAssets(sql, taskId, d.version);
    expect(assets.filter((a) => a.kind === "image").map((a) => a.scene_no)).toEqual([1, 2, 3]);
    expect(assets.filter((a) => a.kind === "audio")).toHaveLength(1);
    const media = (wf.plan as { media?: { images: number[]; audio: boolean; scenes: unknown[] } }).media!;
    expect(media.scenes).toHaveLength(3);
    expect(media.audio).toBe(true);
    // 絵と声の費用は、この業務の費用として記録される
    const usage = await sql<{ purpose: string }[]>`select purpose from api_usage where task_id = ${taskId} and purpose like 'team:media%'`;
    expect(usage.map((u) => u.purpose).sort()).toEqual(["team:media_image", "team:media_image", "team:media_image", "team:media_plan", "team:media_voice"]);
    // 動画は「動画1本あたりの上限」を使う
    const [t] = await sql<{ budget_limit_jpy: number }[]>`select budget_limit_jpy::float8 as budget_limit_jpy from tasks where id = ${taskId}`;
    expect(t.budget_limit_jpy).toBe(100);
    const msgs = await listRoomMessages(sql, taskId);
    expect(msgs.some((m) => m.content.includes("動画の材料（場面ごとの絵・ナレーションの声）ができました"))).toBe(true);
  });

  it("絵や声を作れなくても止まらない：絵のない場面は文字のスライド・声なしで動画にでき、あとで足りない分を作り直せる", async () => {
    const { sql, taskId } = await newTask("節約レシピのショート動画を作る");
    // 議論・作成・監査までは進めてから、絵づくりと声づくりを失敗させる
    for (let i = 0; i < 20; i++) {
      const wf = (await getWorkflow(sql, taskId))!;
      if (wf.phase === "media") break;
      await runWorkflows(sql, { taskIds: [taskId], maxSteps: 1, deadlineMs: 30_000 });
    }
    expect((await getWorkflow(sql, taskId))!.phase).toBe("media");
    await runWorkflows(sql, { taskIds: [taskId], maxSteps: 1, deadlineMs: 30_000 }); // 場面に分ける
    mockHooks.failNext = 2; // 1枚目の絵と、声を失敗させる
    await runAll([taskId]);
    let wf = (await getWorkflow(sql, taskId))!;
    expect(wf.phase).toBe("waiting_human");
    const media = (wf.plan as { media?: { imageError?: string; voiceError?: string; scenes: unknown[] } }).media!;
    expect(media.imageError).toBeTruthy();
    expect(media.voiceError).toBeTruthy();
    expect(media.scenes).toHaveLength(3);
    const msgs = await listRoomMessages(sql, taskId);
    expect(msgs.some((m) => m.content.includes("文字のスライドで動画にします"))).toBe(true);
    expect(msgs.some((m) => m.content.includes("声なし"))).toBe(true);
    // 承認の依頼はちゃんと届く
    const [a] = await sql<{ reason: string }[]>`select reason from approvals where task_id = ${taskId} and action_type = 'accept_deliverable' and status = 'pending'`;
    expect(a.reason).toContain("文字のスライド");

    // 「足りない絵と声を作る」：作れなかった分だけ作り直す
    const r = await remakeMissingMedia(sql, taskId);
    expect(r.ok).toBe(true);
    wf = (await getWorkflow(sql, taskId))!;
    const after = (wf.plan as { media?: { imageError?: string; voiceError?: string; images: number[]; audio: boolean } }).media!;
    expect(after.imageError).toBeUndefined();
    expect(after.images.sort()).toEqual([1, 2, 3]);
    expect(after.audio).toBe(true);
    const [d] = await listDeliverables(sql, taskId);
    expect((await listMediaAssets(sql, taskId, d.version)).length).toBe(4);
  });

  it("完了報告はAIで作らない（承認の依頼はアプリが作る・報告書は増えない）", async () => {
    const { sql, taskId } = await newTask("片付けのコツのショート動画をもう1本作る");
    await runAll([taskId]);
    const purposes = await sql<{ purpose: string }[]>`select purpose from api_usage where task_id = ${taskId}`;
    expect(purposes.some((p) => p.purpose === "team:final_report")).toBe(false);
    expect(await sql`select 1 from reports where task_id = ${taskId}`).toHaveLength(0);
    const [a] = await sql<{ reason: string }[]>`select reason from approvals where task_id = ${taskId} and action_type = 'accept_deliverable'`;
    expect(a.reason).toContain("を作りました");
    expect(a.reason).toContain("動画を書き出す");
  });

  it("動画以外は絵と声を作らない／絵と声のモデルは設定で選べない", () => {
    expect(phaseAfterCheck(productByFormat("video_script"), "video_script")).toBe("media");
    expect(phaseAfterCheck(productByFormat("video_script"), "markdown_report")).toBe("final_report");
    expect(phaseAfterCheck(productByFormat("note_article"), "note_article")).toBe("final_report");
    expect(phaseAfterCheck(null, "markdown_report")).toBe("final_report");
    expect(isTextModel("gpt-5-mini")).toBe(true);
    expect(isTextModel("gpt-image-1-mini")).toBe(false);
    expect(isTextModel("gpt-4o-mini-tts")).toBe(false);
  });
});

describe("作り続けるシリーズ", () => {
  it("動画を承認すると、そこで終わらずシリーズになり、予定日に次の回を作り始める", async () => {
    const { sql, taskId } = await newTask("片付けのコツのショート動画を作る");
    await runAll([taskId]);
    const a = await acceptLatest(taskId);
    expect(a.after_effect).toContain("次の回を自動で作り始めます");

    const [t] = await sql<{ series_id: string; series_episode: number; status: string }[]>`
      select series_id, series_episode, status from tasks where id = ${taskId}`;
    expect(t.status).toBe("completed");
    expect(t.series_episode).toBe(1);
    const s = (await getSeries(sql, t.series_id))!;
    expect(s.active).toBe(true);
    expect(s.title).toBe("片付けのコツのショート動画を作る");
    expect(s.next_run_on).toBe(addDaysJst(today, 3));
    expect((await listRoomMessages(sql, taskId)).some((m) => m.content.includes("として作り続けます"))).toBe(true);

    // 予定日の前は作らない
    expect((await runDueSeries(sql, dayAt(addDaysJst(today, 2)))).created).toHaveLength(0);
    // 予定日になったら、第2回を作り始める
    const r = await runDueSeries(sql, dayAt(addDaysJst(today, 3)));
    expect(r.created).toHaveLength(1);
    const ep2 = r.created[0];
    expect(ep2.episode).toBe(2);
    const [task2] = await sql<{ title: string; description: string; product_format: string; source: string }[]>`
      select title, description, product_format, source from tasks where id = ${ep2.taskId}`;
    expect(task2.title).toBe("片付けのコツのショート動画を作る（第2回）");
    expect(task2.product_format).toBe("video_script");
    expect(task2.description).toContain("同じ内容・同じ切り口にしない");
    expect((await getSeries(sql, t.series_id))!.next_run_on).toBe(addDaysJst(today, 6));

    // 作っている途中の回があるうちは、次の回を作らない
    const r2 = await runDueSeries(sql, dayAt(addDaysJst(today, 9)));
    expect(r2.created).toHaveLength(0);
    expect(r2.waiting.join()).toContain("作っている途中");

    // 第2回もチームが動画（絵と声つき）まで作る
    await runAll([ep2.taskId]);
    const [d2] = await listDeliverables(sql, ep2.taskId);
    expect(d2.format).toBe("video_script");
    expect((await listMediaAssets(sql, ep2.taskId, d2.version)).length).toBe(4);
    expect((await getWorkflow(sql, ep2.taskId))!.phase).toBe("waiting_human");

    // 承認待ちが1本なら、次の回（第3回）は作る。2本たまったら、それ以上は作らない
    const r3 = await runDueSeries(sql, dayAt(addDaysJst(today, 9)));
    expect(r3.created.map((c) => c.episode)).toEqual([3]);
    await runAll([r3.created[0].taskId]);
    const r4 = await runDueSeries(sql, dayAt(addDaysJst(today, 30)));
    expect(r4.created).toHaveLength(0);
    expect(r4.waiting.join()).toContain("承認待ちが2本");

    // 第2回を承認すると、また作れるようになる（シリーズは同じまま）
    await acceptLatest(ep2.taskId);
    const r5 = await runDueSeries(sql, dayAt(addDaysJst(today, 30)));
    expect(r5.created.map((c) => c.episode)).toEqual([4]);
    expect((await getSeries(sql, t.series_id))!.episodes).toBe(4);
  });

  it("止めたシリーズは作らない。再開すると、今日から間隔をあけて作る", async () => {
    const { sql, taskId } = await newTask("在宅ワークのコツをnote記事にする");
    await runAll([taskId]);
    await acceptLatest(taskId);
    const [t] = await sql<{ series_id: string }[]>`select series_id from tasks where id = ${taskId}`;
    expect((await getSeries(sql, t.series_id))!.product_format).toBe("note_article");

    await updateSeries(sql, t.series_id, { active: false }, today);
    expect((await runDueSeries(sql, dayAt(addDaysJst(today, 10)))).created).toHaveLength(0);

    await updateSeries(sql, t.series_id, { active: true, intervalDays: 7 }, today);
    const s = (await getSeries(sql, t.series_id))!;
    expect(s.interval_days).toBe(7);
    expect(s.next_run_on).toBe(addDaysJst(today, 7));
    const r = await runDueSeries(sql, dayAt(addDaysJst(today, 7)));
    expect(r.created.map((c) => c.episode)).toEqual([2]);
  });

  it("成果品を頼んでいない業務は、承認してもシリーズにしない", async () => {
    const { sql, taskId } = await newTask("家計の固定費を見直す");
    await runAll([taskId]);
    await acceptLatest(taskId);
    const [t] = await sql<{ series_id: string | null; status: string }[]>`select series_id, status from tasks where id = ${taskId}`;
    expect(t.status).toBe("completed");
    expect(t.series_id).toBeNull();
  });

  it("シリーズの名前から「（第N回）」を取る", () => {
    expect(baseTitle("片付けの動画（第3回）")).toBe("片付けの動画");
    expect(baseTitle("片付けの動画")).toBe("片付けの動画");
  });
});
