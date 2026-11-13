import { WORKFLOW_STEPS, type WorkflowPhase } from "@/lib/constants";

const INDEX: Partial<Record<WorkflowPhase, number>> = {
  kickoff: 0,
  discussion: 1,
  drafting: 2,
  rework: 2,
  review: 3,
  final_report: 4,
  waiting_human: 5,
  done: 6,
};

/** チームの進み具合（計画 → 議論 → 作成 → 監査 → 報告 → 承認）を表示する */
export function WorkflowStepper({
  phase,
  resumePhase,
  compact = false,
}: {
  phase: WorkflowPhase;
  resumePhase?: WorkflowPhase | null;
  compact?: boolean;
}) {
  const base = phase === "stopped" ? (resumePhase ?? "kickoff") : phase;
  const current = INDEX[base] ?? 0;
  const stopped = phase === "stopped";
  return (
    <ol className="flex items-center gap-1" aria-label="チームの進み具合">
      {WORKFLOW_STEPS.map((s, i) => {
        const done = i < current;
        const now = i === current && current < WORKFLOW_STEPS.length;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span
              className={`h-1.5 w-full rounded-full ${
                done ? "bg-success" : now ? (stopped ? "bg-danger" : "bg-brand") : "bg-surface-3"
              }`}
            />
            {!compact || now ? (
              <span className={`truncate text-[10px] font-semibold ${now ? (stopped ? "text-danger" : "text-brand") : done ? "text-success" : "text-faint"}`}>
                {s.label}
                {now && stopped ? "（停止）" : ""}
              </span>
            ) : (
              <span className="h-[15px]" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
