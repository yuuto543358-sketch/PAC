import "server-only";
import type { Sql } from "@/lib/db";
import { begin } from "@/lib/db";
import { ACTIVE_WORKFLOW_PHASES, type WorkflowPhase } from "@/lib/constants";
import { addTaskLog } from "@/lib/repo/tasks";
import { addRoomMessage, getDeliverable, getWorkflow, initWorkflow, setTaskStatusSystem, updateWorkflow } from "./repo";

// 経営者（人間）や社長が、チームの進行に関わる操作。

/** チームで自動的に進め始める（まだチームが無い業務にも使える） */
export async function startTeam(sql: Sql, taskId: string) {
  await begin(sql, async (tx) => {
    const [t] = await tx<{ status: string }[]>`select status from tasks where id = ${taskId} for update`;
    if (!t) throw new Error("業務が見つかりません");
    if (t.status === "completed" || t.status === "rejected") throw new Error("完了・却下した業務はチームで進められません");
    await initWorkflow(tx, taskId, true);
    const wf = await getWorkflow(tx, taskId);
    if (wf && (wf.phase === "stopped" || !wf.autopilot)) {
      await updateWorkflow(tx, taskId, { autopilot: true, phase: wf.phase === "stopped" ? (wf.resume_phase ?? "kickoff") : wf.phase, failures: 0 });
    }
    if (t.status === "on_hold" || t.status === "failed") {
      await setTaskStatusSystem(tx, taskId, "discovered", { type: "user" }, "チームで再開");
    }
    await addTaskLog(tx, taskId, { type: "user" }, "team_started", "チームで自動的に進めるよう指示しました");
    await addRoomMessage(tx, { taskId, authorType: "system", kind: "system", content: "経営者がチームでの進行を開始しました。", meta: { tone: "info" } });
  });
}

export async function pauseTeam(sql: Sql, taskId: string) {
  await begin(sql, async (tx) => {
    const wf = await getWorkflow(tx, taskId);
    if (!wf) throw new Error("この業務にはチームがありません");
    await updateWorkflow(tx, taskId, { autopilot: false });
    await addRoomMessage(tx, { taskId, authorType: "system", kind: "system", content: "経営者がチームの作業を一時停止しました。", meta: { tone: "warn" } });
    await addTaskLog(tx, taskId, { type: "user" }, "team_paused", "チームの作業を一時停止");
  });
}

/** 一時停止・停止・失敗から再開する（失敗の回数はリセット） */
export async function resumeTeam(sql: Sql, taskId: string) {
  await begin(sql, async (tx) => {
    const wf = await getWorkflow(tx, taskId);
    if (!wf) throw new Error("この業務にはチームがありません");
    const phase: WorkflowPhase = wf.phase === "stopped" ? (wf.resume_phase ?? "kickoff") : wf.phase;
    await updateWorkflow(tx, taskId, { autopilot: true, phase, failures: 0, steps: wf.phase === "stopped" ? 0 : wf.steps });
    const [t] = await tx<{ status: string }[]>`select status from tasks where id = ${taskId}`;
    if (t && (t.status === "failed" || t.status === "on_hold")) {
      await setTaskStatusSystem(tx, taskId, "researching", { type: "user" }, "チームを再開");
    }
    await addRoomMessage(tx, { taskId, authorType: "system", kind: "system", content: "経営者がチームの作業を再開しました。", meta: { tone: "info" } });
    await addTaskLog(tx, taskId, { type: "user" }, "team_resumed", "チームの作業を再開");
  });
}

/**
 * グループチャットへの指示（経営者 または 社長から）。
 * 確認待ちで止まっている場合は、指示を受けて作業を再開します。
 */
export async function postInstruction(
  sql: Sql,
  taskId: string,
  author: { type: "owner" } | { type: "ceo" },
  rawText: string,
): Promise<{ resumed: boolean }> {
  const text = rawText.trim();
  if (!text) throw new Error("指示を入力してください");
  if (text.length > 2000) throw new Error("指示は2000文字以内にしてください");
  return begin(sql, async (tx) => {
    const wf = await getWorkflow(tx, taskId);
    if (!wf) throw new Error("この業務にはチームがありません。先に「チームで進める」を押してください。");
    await addRoomMessage(tx, {
      taskId,
      authorType: author.type === "owner" ? "owner" : "employee",
      employeeId: author.type === "ceo" ? "president" : null,
      kind: "instruction",
      content: text,
    });
    await addTaskLog(
      tx,
      taskId,
      author.type === "owner" ? { type: "user" } : { type: "employee", employeeId: "president" },
      "comment",
      `チームへの指示：${text.slice(0, 200)}`,
    );

    let resumed = false;
    if (wf.phase === "waiting_human" || wf.phase === "done" || wf.phase === "stopped") {
      let next: WorkflowPhase;
      if (wf.waiting_reason === "question" || wf.waiting_reason === "budget") {
        next = wf.resume_phase && ACTIVE_WORKFLOW_PHASES.includes(wf.resume_phase) ? wf.resume_phase : "discussion";
      } else if (wf.phase === "stopped") {
        next = wf.resume_phase ?? "kickoff";
      } else {
        // 成果物の確認待ち・完了後の追加指示 → 修正版を作る
        const latest = await getDeliverable(tx, taskId);
        next = latest ? "rework" : wf.lead_id ? "drafting" : "kickoff";
        // 確認待ちだった成果物の承認依頼は、新しい版で出し直すため無効にする
        const pend = await tx<{ id: string; status: string }[]>`
          select id, status from approvals
          where task_id = ${taskId} and action_type = 'accept_deliverable' and status in ('pending','on_hold')`;
        for (const a of pend) {
          await tx`update approvals set status = 'superseded', decided_at = now() where id = ${a.id}`;
          await tx`insert into approval_events (approval_id, event, from_status, to_status, note, actor_type)
            values (${a.id}, 'superseded', ${a.status}, 'superseded', '追加の指示により修正版を作成するため', 'user')`;
        }
      }
      await updateWorkflow(tx, taskId, { phase: next, waiting_reason: "", resume_phase: null, autopilot: true, failures: 0, rework_count: 0 });
      const status = next === "discussion" ? "researching" : next === "review" ? "analyzing" : next === "kickoff" ? "discovered" : "producing";
      await setTaskStatusSystem(tx, taskId, status, { type: "system" }, "指示を受けて再開");
      resumed = true;
    }
    return { resumed };
  });
}
