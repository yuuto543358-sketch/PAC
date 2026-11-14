"use server";

import { refresh } from "next/cache";
import { assertAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { runDiscovery } from "@/lib/autonomy/discovery";
import { generateCompanyReport } from "@/lib/autonomy/reports";
import { OWNER_BUSINESS_STATUSES, type BusinessStatus } from "@/lib/constants";
import { audit } from "@/lib/repo/audit";
import { getBusinessProject, linkValidationTask, setBusinessStatus } from "@/lib/repo/business";
import { createTask } from "@/lib/repo/tasks";
import { initWorkflow } from "@/lib/workflow/repo";
import { scheduleTeamRun } from "@/lib/workflow/trigger";
import { kickNotifications } from "@/lib/notify/trigger";
import type { ActionState } from "@/components/forms";

const fail = (e: unknown): ActionState => ({ ok: false, error: e instanceof Error ? e.message : "処理に失敗しました", ts: Date.now() });

/** 「今すぐ仕事を探す」：事業開発担当に事業の候補を探してもらう */
export async function findWorkNowAction(): Promise<ActionState> {
  try {
    await assertAuth();
    const sql = await getDb();
    const r = await runDiscovery(sql, "manual");
    if (r.taskIds.length) scheduleTeamRun(r.taskIds);
    kickNotifications();
    refresh();
    return r.ok ? { ok: true, message: r.message, ts: Date.now() } : { ok: false, error: r.message, ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/** 「今すぐ報告書を作る」：社長に日報・週報を書いてもらう */
export async function createReportNowAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const k = fd.get("kind");
    const kind = k === "weekly" ? "weekly" : k === "monthly" ? "monthly" : "daily";
    const sql = await getDb();
    const r = await generateCompanyReport(sql, kind, "manual");
    refresh();
    return { ok: true, message: r.message, ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/** 経営者が事業の候補の状態を変える（有望・採用・見送り など） */
export async function setBusinessStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const id = String(fd.get("id") ?? "");
    const status = String(fd.get("status") ?? "") as BusinessStatus;
    const note = String(fd.get("note") ?? "");
    const sql = await getDb();
    const current = await getBusinessProject(sql, id);
    if (!current) throw new Error("事業の候補が見つかりません");
    // 「調査中」はチームが調べ始めたときに自動で付く状態。経営者はそのまま（メモだけ保存）にはできる
    if (!OWNER_BUSINESS_STATUSES.includes(status) && status !== current.status) {
      throw new Error("状態の指定が正しくありません");
    }
    await setBusinessStatus(sql, id, status, note);
    refresh();
    return { ok: true, message: "事業の候補の状態を変更しました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

const WORK_TEMPLATES = {
  product: {
    title: (name: string) => `商品づくり：${name}`,
    assignee: "creative",
    lines: (name: string) => [
      `事業「${name}」で売る商品（またはサービスの中身）を作ってください。`,
      "成果物: お客さんにそのまま渡せる商品の完成版（または第1版）。文章・資料・表など、内容に合う形で。",
      "あわせて、値段の案と、お客さんが受け取るもの・受け取り方を、短くまとめること。",
      "注意: 作るだけで、出品・販売・外部への連絡はしないこと（経営者が自分で行う）。",
    ],
  },
  sales: {
    title: (name: string) => `販売の準備：${name}`,
    assignee: "bizdev",
    lines: (name: string) => [
      `事業「${name}」の商品を売るための準備をしてください。`,
      "成果物: 次をまとめた資料。",
      "・商品の紹介文（そのまま販売ページに貼れる文章）",
      "・値段の案（なぜその値段か）",
      "・売る場所の候補と、それぞれの手数料（分かる範囲。未確認なら「要確認」）",
      "・SNSで知らせるときの投稿文の案（2〜3個）",
      "・経営者が自分で行う手順のチェックリスト（登録・出品・告知など）",
      "注意: 出品・投稿・登録は経営者が自分で行う。チームは準備だけをすること。",
    ],
  },
} as const;

/** 「商品を作る」「販売の準備をする」：有望・採用の事業について、チームに次の仕事を任せる */
export async function startBusinessWorkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const id = String(fd.get("id") ?? "");
    const kind = fd.get("kind") === "sales" ? "sales" : "product";
    const sql = await getDb();
    const b = await getBusinessProject(sql, id);
    if (!b) throw new Error("事業の候補が見つかりません");
    if (b.status !== "promising" && b.status !== "adopted") {
      throw new Error("「有望」か「採用」にした事業だけ、商品づくり・販売の準備を始められます");
    }
    const t = WORK_TEMPLATES[kind];
    const r = await createTask(sql, {
      title: t.title(b.name).slice(0, 200),
      description: [
        ...t.lines(b.name),
        `事業の概要: ${b.summary}`,
        `お客さん: ${b.target_customer}`,
        `お客さんの困りごと: ${b.customer_problem}`,
        b.owner_note ? `経営者のメモ: ${b.owner_note}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      source: "user",
      priority: "medium",
      assigneeId: t.assignee,
      businessProjectId: b.id,
      createdBy: { type: "user" },
    });
    if (!r.created) throw new Error(`似た業務「${r.duplicateOf.title}」がすでにあります`);
    await initWorkflow(sql, r.task.id, true);
    await audit(sql, "user", `business_${kind}`, "business_project", b.id, { taskId: r.task.id });
    scheduleTeamRun([r.task.id]);
    refresh();
    return { ok: true, message: kind === "product" ? "チームが商品づくりを始めました" : "チームが販売の準備を始めました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/** 「チームで調べる」：事業の候補を、チームに調査してもらう */
export async function investigateBusinessAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertAuth();
    const id = String(fd.get("id") ?? "");
    const sql = await getDb();
    const b = await getBusinessProject(sql, id);
    if (!b) throw new Error("事業の候補が見つかりません");
    if (b.validation_task_id && b.validation_task_status && !["completed", "rejected", "failed"].includes(b.validation_task_status)) {
      throw new Error("この候補は、すでにチームが調べています");
    }
    const r = await createTask(sql, {
      title: `事業候補の調査：${b.name}`.slice(0, 200),
      description: [
        `事業の候補「${b.name}」が、本当にうまくいきそうかを調べてください。`,
        `概要: ${b.summary}`,
        `お客さん: ${b.target_customer}`,
        `困りごと: ${b.customer_problem}`,
        `確かめる方法の案: ${b.validation_method}`,
        b.owner_note ? `経営者のメモ: ${b.owner_note}` : "",
        "成果物: 「やる価値があるか」の結論、根拠、かかるお金、心配なこと、次の一歩をまとめた報告書。",
        "注意: 調べるだけで、外部への連絡・登録・購入はしないこと（必要なら承認依頼の案として出す）。",
      ]
        .filter(Boolean)
        .join("\n"),
      source: "user",
      priority: "medium",
      assigneeId: "research",
      businessProjectId: b.id,
      createdBy: { type: "user" },
    });
    if (!r.created) throw new Error(`似た業務「${r.duplicateOf.title}」がすでにあります`);
    await initWorkflow(sql, r.task.id, true);
    await linkValidationTask(sql, b.id, r.task.id);
    await audit(sql, "user", "business_investigate", "business_project", b.id, { taskId: r.task.id });
    scheduleTeamRun([r.task.id]);
    refresh();
    return { ok: true, message: "チームが調査を始めました", ts: Date.now() };
  } catch (e) {
    return fail(e);
  }
}
