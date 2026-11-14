"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { startNextEpisodeNowAction, updateSeriesAction } from "@/app/actions/series";

const OPTIONS = [
  { days: 1, label: "毎日" },
  { days: 2, label: "2日ごと" },
  { days: 3, label: "3日ごと（週2〜3本）" },
  { days: 7, label: "1週間ごと" },
  { days: 14, label: "2週間ごと" },
];

export function SeriesControls({ id, active, intervalDays }: { id: string; active: boolean; intervalDays: number }) {
  return (
    <div className="space-y-2">
      <ActionForm action={updateSeriesAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <label className="block text-[13px] font-medium text-muted" htmlFor={`interval-${id}`}>
          作る間隔
        </label>
        <select id={`interval-${id}`} name="interval_days" defaultValue={String(intervalDays)} className="field">
          {OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>
              {o.label}
            </option>
          ))}
          {!OPTIONS.some((o) => o.days === intervalDays) && <option value={intervalDays}>{intervalDays}日ごと</option>}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <SubmitButton name="op" value="save" className="btn-secondary">
            間隔を保存
          </SubmitButton>
          {active ? (
            <SubmitButton name="op" value="stop" className="btn-secondary text-danger" confirmText="このシリーズを止めますか？（あとで再開できます）">
              止める
            </SubmitButton>
          ) : (
            <SubmitButton name="op" value="start" className="btn-primary">
              再開する
            </SubmitButton>
          )}
        </div>
      </ActionForm>
      {active && (
        <ActionForm action={startNextEpisodeNowAction}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton className="btn-tinted w-full" pendingText="準備中…">
            次の回を今すぐ作る
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
