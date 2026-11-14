import "server-only";
import type { Sql } from "@/lib/db";
import { MAX_ACTIVE_LIFE_TASKS } from "@/lib/constants";
import { audit } from "@/lib/repo/audit";
import { getSettings } from "@/lib/repo/settings";
import { createTask } from "@/lib/repo/tasks";
import { initWorkflow, setMember } from "@/lib/workflow/repo";
import { LIFE_EMPLOYEE_ID } from "./questions";
import { getSuggestion } from "./suggestions";

// 改善提案を「業務」にして、AI社員のチームで検討する。
// 流れ：ライフ担当が発見 → 社長がチームを編成 → 調査担当が調べて比べる → 企画担当が具体案
//      → 財務・監査担当が費用とリスクを確認 → 社長が経営者に報告（すべてグループチャットに記録が残る）
// チームが行うのは調べる・比べる・まとめるところまで。契約・購入などは承認依頼の案を出すだけ。

/** 提案からの業務のうち、まだ終わっていないものの数 */
async function activeLifeTasks(sql: Sql) {
  const [r] = await sql<{ n: number }[]>`
    select count(*)::int as n from life_suggestions s join tasks t on t.id = s.task_id
    where t.status not in ('completed','rejected','failed','on_hold')`;
  return r.n;
}

export async function suggestionToTeam(
  sql: Sql,
  id: string,
  trigger: "manual" | "auto",
): Promise<{ ok: boolean; message: string; taskId: string | null }> {
  const s = await getSuggestion(sql, id);
  if (!s) throw new Error("提案が見つかりません");
  if (s.task_id && s.task_status && !["completed", "rejected", "failed"].includes(s.task_status)) {
    return { ok: false, message: "この提案は、すでにチームが検討しています", taskId: s.task_id };
  }
  if (trigger === "auto" && (await activeLifeTasks(sql)) >= MAX_ACTIVE_LIFE_TASKS) {
    return { ok: false, message: "生活の改善の業務が上限まで進行中のため、自動では始めませんでした", taskId: null };
  }
  const r = await createTask(sql, {
    title: `生活の改善：${s.title}`.slice(0, 200),
    description: [
      `ライフ担当（森野 結）が、経営者の暮らしの情報から見つけた改善のきっかけです。チームで検討して、具体的な改善案にしてください。`,
      `見つけた問題: ${s.problem}`,
      `根拠: ${s.evidence}${s.is_estimate ? "（推測を含む）" : ""}`,
      `考えられるメリット: ${s.benefit}`,
      `ライフ担当のおすすめ: ${s.recommendation}`,
      "進め方の目安: 調査担当が今の状況と代わりの選択肢を調べて比べる → 企画担当が具体的な改善案を作る → 財務・監査担当が費用とリスクを確認 → 社長が報告。",
      "成果物: いまの状況、選択肢の比較（費用・手間・メリット）、おすすめの案、経営者がやることの手順。",
      "注意: 契約変更・購入・申し込み・外部への連絡はしない（必要なら承認依頼の案として出す。実行は経営者が自分で行う）。分からない情報は推測で埋めず、経営者への質問にする。",
    ].join("\n"),
    source: "ai_discovered",
    priority: s.priority === "high" ? "high" : "medium",
    assigneeId: "research",
    createdBy: { type: "employee", employeeId: LIFE_EMPLOYEE_ID },
  });
  if (!r.created) {
    return { ok: false, message: `似た業務「${r.duplicateOf.title}」がすでにあります`, taskId: r.duplicateOf.id };
  }
  await initWorkflow(sql, r.task.id, true);
  // ライフ担当もメンバーとして議論に入る（見つけた本人なので）
  await setMember(sql, r.task.id, LIFE_EMPLOYEE_ID, "member");
  await sql`
    update life_suggestions set task_id = ${r.task.id},
      status = case when status = 'new' then 'considering' else status end, updated_at = now()
    where id = ${id}`;
  await audit(sql, trigger === "manual" ? "owner" : "system", "life_suggestion_to_team", "life_suggestion", id, { taskId: r.task.id });
  return { ok: true, message: "チームが検討を始めました", taskId: r.task.id };
}

/** 自動の業務化：優先度が高く、チームでの検討が必要な提案だけ（設定がオンのとき・同時に2件まで） */
export async function autoTasksFromSuggestions(sql: Sql, suggestionIds: string[]): Promise<string[]> {
  const settings = await getSettings(sql);
  if (!settings.life_auto_task || settings.emergency_stop || suggestionIds.length === 0) return [];
  const rows = await sql<{ id: string }[]>`
    select id from life_suggestions
    where id = any(${suggestionIds}::uuid[]) and priority = 'high' and needs_team and task_id is null and status = 'new'
    order by created_at`;
  const taskIds: string[] = [];
  for (const row of rows) {
    const r = await suggestionToTeam(sql, row.id, "auto");
    if (!r.ok || !r.taskId) break;
    taskIds.push(r.taskId);
  }
  return taskIds;
}
