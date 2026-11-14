/** 目標の進み具合のバー（縦線は、期限までの時間がどれだけ過ぎたか） */
export function GoalBar({ pct, timePct }: { pct: number | null; timePct: number | null }) {
  if (pct == null) return null;
  return (
    <div className="relative mt-2 h-2.5 rounded-full bg-surface-3" role="img" aria-label={`進み具合 ${pct}%`}>
      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, pct)}%` }} />
      {timePct != null && <span className="absolute -top-1 h-4.5 w-0.5 rounded bg-ink/40" style={{ left: `${timePct}%` }} title={`時間の経過 ${timePct}%`} />}
    </div>
  );
}
