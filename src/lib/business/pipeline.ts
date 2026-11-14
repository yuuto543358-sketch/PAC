import "server-only";
import type { Sql } from "@/lib/db";
import { createApproval } from "@/lib/repo/approvals";
import { audit } from "@/lib/repo/audit";
import { getBusinessProject, type BusinessProject } from "@/lib/repo/business";
import { createTask } from "@/lib/repo/tasks";
import { getDeliverable, initWorkflow } from "@/lib/workflow/repo";

// 事業を「採用」したら、AI社員が販売まで自動で進める。
//   商品づくり → 出品パッケージ（そのまま貼れる形）→ 出品の承認（経営者）→ 出品（経営者が貼り付け）→ 販売中
// それぞれの段階の成果物を経営者が受け取る（承認する）と、次の段階の業務が自動で始まる。
// note・BOOTH などは自動で出品できないため、出品そのものは経営者が行う（アプリは外部に何も送らない）。

const DONE = new Set(["completed"]);
const STOPPED = new Set(["rejected", "failed"]);

const TEMPLATES = {
  product: {
    title: (b: BusinessProject) => `商品づくり：${b.name}`,
    assignee: "creative",
    lines: (b: BusinessProject) => [
      `事業「${b.name}」で売る商品の「完成品」を作ってください（そのまま売れる状態まで）。`,
      `事業の概要: ${b.summary}`,
      `お客さん: ${b.target_customer}`,
      `お客さんの困りごと: ${b.customer_problem}`,
      b.monetization ? `売り方の案: ${b.monetization}` : "",
      "成果物: お客さんにそのまま渡せる商品の本体（文章・手引き・テンプレート・チェックリストなど、データで渡せるもの）。売る場所が note なら形式は note_article にする。",
      "あわせて、値段の案と、お客さんが受け取るもの・受け取り方を短くまとめる。",
      "取材・外注はせず、AIの知識とWeb調査だけで作る。架空の体験談・お客さんの声は書かない。",
      "注意: 出品・販売・外部への連絡はしない（経営者が自分で行う）。",
    ],
  },
  listing: {
    title: (b: BusinessProject) => `出品の準備：${b.name}`,
    assignee: "bizdev",
    lines: (b: BusinessProject, product: string) => [
      `事業「${b.name}」の商品を出品するための「出品パッケージ」を作ってください。経営者がコピーして貼るだけで出品できる状態にします。`,
      "形式は listing_package にして、次の見出しをこの順で書く：",
      "「## 出品先」（方針に合う、いちばん良い売る場所1つと、その理由を1〜2行）",
      "「## 商品名」「## 価格」（数字と、その値段にした理由を1行）「## 説明文」（そのまま貼れる販売ページの文章）「## タグ」",
      "「## サムネイル画像」（画像に入れる文字と、画像の雰囲気の説明）",
      "「## 商品ファイル」（お客さんに渡すデータの中身、またはファイルの作り方）",
      "「## 出品の手順」（選んだ売る場所での登録から公開までを、番号つきの手順で。必要なら公式ページのURL）",
      "「## 公開前チェックリスト」（表示が必要な情報、禁止されていることに当たらないか、など）",
      "「## 宣伝の投稿文」（SNSに投稿する文を2〜3個。ネタツイくらいラフに）",
      "注意: 出品・登録・投稿は経営者が自分で行う。チームは準備だけをする。",
      product ? `\n【できあがった商品（前の段階の成果物）】\n${product.slice(0, 6000)}` : "",
    ],
  },
  improve: {
    title: (b: BusinessProject, what: string) => `運営の改善：${b.name}（${what}）`,
    assignee: "bizdev",
    lines: (b: BusinessProject, detail: string) => [
      `販売中の事業「${b.name}」を、もっと売れるように改善してください。`,
      `改善すること: ${detail}`,
      b.listing_url ? `いまの販売ページ: ${b.listing_url}（${b.platform}）` : "",
      "成果物: そのまま使える改善版（新しい説明文・タイトル・値段の案・宣伝の投稿文・新しい商品の中身など）と、経営者がやることの手順。形式は listing_package か内容に合うもの。",
      "注意: 販売ページの書きかえ・値段の変更・投稿は経営者が自分で行う（チームは準備だけ）。売上の数字は経営者の記録だけを使い、作らない。",
    ],
  },
} as const;

async function startStageTask(
  sql: Sql,
  b: BusinessProject,
  stage: "product" | "listing" | "improve",
  extra = "",
  what = "",
): Promise<string | null> {
  const title =
    stage === "improve" ? TEMPLATES.improve.title(b, what) : stage === "product" ? TEMPLATES.product.title(b) : TEMPLATES.listing.title(b);
  const lines =
    stage === "improve" ? TEMPLATES.improve.lines(b, extra) : stage === "product" ? TEMPLATES.product.lines(b) : TEMPLATES.listing.lines(b, extra);
  const r = await createTask(sql, {
    title: title.slice(0, 200),
    description: lines.filter(Boolean).join("\n"),
    source: "ai_discovered",
    priority: "medium",
    assigneeId: TEMPLATES[stage].assignee,
    businessProjectId: b.id,
    createdBy: { type: "employee", employeeId: "bizdev" },
  });
  const taskId = r.created ? r.task.id : r.duplicateOf.id;
  if (r.created) await initWorkflow(sql, taskId, true);
  return taskId;
}

/**
 * 事業を次の段階へ進める（採用されていて、自動で進める設定のときだけ）。
 * 戻り値：新しく始めた業務のid（チームの作業を動かすため）
 */
export async function advanceBusiness(sql: Sql, businessId: string): Promise<string[]> {
  const b = await getBusinessProject(sql, businessId);
  if (!b || b.status !== "adopted" || !b.auto_advance) return [];
  const taskDone = b.stage_task_status ? DONE.has(b.stage_task_status) : false;
  const taskStopped = b.stage_task_status ? STOPPED.has(b.stage_task_status) : false;
  const started: string[] = [];

  if (b.stage === "idea" || b.stage === "research" || b.stage === "paused") {
    const id = await startStageTask(sql, b, "product");
    if (id) {
      await sql`update business_projects set stage = 'product', stage_task_id = ${id}, updated_at = now() where id = ${b.id}`;
      started.push(id);
    }
  } else if (b.stage === "product" && (taskDone || !b.stage_task_id)) {
    const product = b.stage_task_id ? await getDeliverable(sql, b.stage_task_id) : null;
    const id = await startStageTask(sql, b, "listing", product?.content ?? "");
    if (id) {
      await sql`update business_projects set stage = 'listing', stage_task_id = ${id}, updated_at = now() where id = ${b.id}`;
      started.push(id);
    }
  } else if (b.stage === "listing" && (taskDone || !b.stage_task_id) && !b.launch_approval_id) {
    const pkg = b.stage_task_id ? await getDeliverable(sql, b.stage_task_id) : null;
    const platform = pkg?.content.match(/^##\s*出品先\s*\n+([^\n]+)/m)?.[1]?.trim() ?? "";
    const approvalId = await createApproval(sql, {
      requestedByEmployeeId: "bizdev",
      taskId: b.stage_task_id,
      actionType: "publish_web",
      title: `出品の承認：${b.name}`.slice(0, 200),
      content: pkg?.content.slice(0, 8000) || `事業「${b.name}」の出品`,
      reason: "出品パッケージができました。内容を確認して、出品してよいか判断してください。",
      destination: platform.slice(0, 200) || "売る場所（出品パッケージを参照）",
      estimatedCostJpy: 0,
      risks: "公開すると誰でも見られます。商品の中身・値段・表示が必要な情報（特定商取引法に基づく表記など）・売る場所の決まりに合っているか確認してください。",
      afterEffect: "",
      payload: { businessId: b.id, kind: "launch" },
    });
    await sql`update business_projects set stage = 'launch', launch_approval_id = ${approvalId}, platform = ${platform.slice(0, 100)}, updated_at = now() where id = ${b.id}`;
  }
  if (taskStopped) {
    // 業務が失敗・却下で止まったときは、自動では進めない（経営者が「この段階をやり直す」を押す）
    return started;
  }
  if (started.length) await audit(sql, "system", "business_advanced", "business_project", b.id, { tasks: started });
  return started;
}

/** 採用中の事業をまとめて確認して、進められるものを進める（定期実行の安全網） */
export async function advanceAllBusinesses(sql: Sql): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from business_projects where status = 'adopted' and auto_advance and stage <> 'selling' order by updated_at limit 10`;
  const out: string[] = [];
  for (const r of rows) out.push(...(await advanceBusiness(sql, r.id)));
  return out;
}

/** この段階をやり直す（業務が失敗・却下されたとき） */
export async function retryStage(sql: Sql, businessId: string): Promise<string[]> {
  const b = await getBusinessProject(sql, businessId);
  if (!b) throw new Error("事業が見つかりません");
  if (b.stage !== "product" && b.stage !== "listing") throw new Error("この段階はやり直せません");
  const id = await startStageTask(sql, b, b.stage, b.stage === "listing" ? "" : "");
  await sql`update business_projects set stage_task_id = ${id}, updated_at = now() where id = ${b.id}`;
  return id ? [id] : [];
}

/** 経営者が出品した（URLを記録）。出品の承認がまだなら記録できない（サーバー側で確認） */
export async function markListed(sql: Sql, businessId: string, platform: string, url: string) {
  const b = await getBusinessProject(sql, businessId);
  if (!b) throw new Error("事業が見つかりません");
  if (b.launch_approval_id && b.launch_approval_status !== "approved") {
    throw new Error("先に「出品の承認」をしてください（承認センター）");
  }
  let clean = url.trim();
  if (clean) {
    try {
      const u = new URL(clean);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      clean = u.toString();
    } catch {
      throw new Error("URLが正しくありません（https:// から始まるURLを入れてください）");
    }
  }
  await sql`
    update business_projects set stage = 'selling', platform = ${platform.trim().slice(0, 100) || b.platform},
      listing_url = ${clean.slice(0, 500)}, launched_at = coalesce(launched_at, now()), status = 'adopted', updated_at = now()
    where id = ${b.id}`;
  await audit(sql, "owner", "business_listed", "business_project", b.id, { platform, url: clean });
}

export async function setAutoAdvance(sql: Sql, businessId: string, on: boolean) {
  const rows = await sql`update business_projects set auto_advance = ${on}, updated_at = now() where id = ${businessId} returning id`;
  if (rows.length === 0) throw new Error("事業が見つかりません");
}

/** 運営の改善の業務を始める（運営レポートから） */
export async function startImprovement(sql: Sql, businessId: string, what: string, detail: string): Promise<string | null> {
  const b = await getBusinessProject(sql, businessId);
  if (!b) return null;
  const id = await startStageTask(sql, b, "improve", detail, what);
  if (id) await sql`update business_projects set stage_task_id = ${id}, last_improve_at = now(), updated_at = now() where id = ${b.id}`;
  return id;
}
