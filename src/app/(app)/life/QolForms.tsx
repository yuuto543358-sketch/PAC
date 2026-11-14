"use client";

import { useState } from "react";
import {
  addGoalProgressAction,
  createEventAction,
  createGoalAction,
  createHabitAction,
  eventAction,
  runReviewAction,
  dismissNudgeAction,
  runResearchNowAction,
  saveCheckinAction,
  setGoalStatusAction,
  setHabitStatusAction,
  toggleHabitAction,
} from "@/app/actions/qol";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Icon } from "@/components/Icon";

const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" };

const METRICS = [
  { key: "mood", label: "気分", low: "しんどい", high: "とても良い" },
  { key: "energy", label: "体調", low: "だるい", high: "元気" },
  { key: "sleep", label: "睡眠", low: "眠れなかった", high: "ぐっすり" },
  { key: "stress", label: "ストレス", low: "少ない", high: "多い" },
] as const;

type CheckinValues = { mood: number; energy: number; sleep: number; stress: number; note: string };

/** 毎日のQOLチェック（4つを1〜5でタップ） */
export function CheckinForm({ date, initial }: { date: string; initial?: CheckinValues | null }) {
  const [v, setV] = useState<Record<string, number>>({
    mood: initial?.mood ?? 0,
    energy: initial?.energy ?? 0,
    sleep: initial?.sleep ?? 0,
    stress: initial?.stress ?? 0,
  });
  const ready = METRICS.every((m) => v[m.key] > 0);
  return (
    <ActionForm action={saveCheckinAction} className="space-y-3">
      <input type="hidden" name="date" value={date} />
      {METRICS.map((m) => (
        <fieldset key={m.key}>
          <legend className="mb-1 flex w-full items-baseline justify-between text-[13px]">
            <span className="font-semibold">{m.label}</span>
            <span className="text-[11px] text-faint">
              1 {m.low} ／ 5 {m.high}
            </span>
          </legend>
          <div className="grid grid-cols-5 gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <label
                key={n}
                className={`flex h-10 cursor-pointer items-center justify-center rounded-[12px] text-[15px] font-bold ring-1 transition-colors ${
                  v[m.key] === n ? "bg-brand text-brand-fg ring-brand" : "bg-surface text-ink ring-line"
                }`}
              >
                <input type="radio" name={m.key} value={n} checked={v[m.key] === n} onChange={() => setV({ ...v, [m.key]: n })} className="sr-only" />
                {n}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <input name="note" maxLength={500} defaultValue={initial?.note ?? ""} className="field" placeholder="ひとことメモ（なくてもOK）" />
      <SubmitButton className={`w-full ${ready ? "btn-primary" : "btn-secondary"}`}>{initial ? "チェックを直す" : "今日のチェックを記録する"}</SubmitButton>
    </ActionForm>
  );
}

/** 習慣のチェック（タップで「できた」⇔「まだ」） */
export function HabitCheck({ id, date, done, title, meta }: { id: string; date: string; done: boolean; title: string; meta?: string }) {
  return (
    <ActionForm action={toggleHabitAction} className="contents">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="done" value={done ? "0" : "1"} />
      <button type="submit" className="press flex w-full items-center gap-3 px-4 py-3 text-left" aria-pressed={done} aria-label={`${title}を${done ? "まだにする" : "できたにする"}`}>
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 ${done ? "bg-success text-white ring-success" : "text-transparent ring-line"}`}
        >
          <Icon name="check" size={16} stroke={3} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] ${done ? "text-muted line-through" : "font-medium"}`}>{title}</span>
          {meta && <span className="block text-[12px] text-muted">{meta}</span>}
        </span>
      </button>
    </ActionForm>
  );
}

export function NewHabitForm({ prefill }: { prefill?: { title?: string; why?: string; suggestionId?: string } }) {
  const [freq, setFreq] = useState("daily");
  return (
    <ActionForm action={createHabitAction} resetOnSuccess>
      {prefill?.suggestionId && <input type="hidden" name="suggestionId" value={prefill.suggestionId} />}
      <label className="block">
        <span className="label">習慣の名前（小さく、具体的に）</span>
        <input name="title" required maxLength={80} defaultValue={prefill?.title} className="field" placeholder="例：寝る前にスマホを机に置く" />
      </label>
      <label className="block">
        <span className="label">なぜ続けたい？（なくてもOK）</span>
        <input name="why" maxLength={300} defaultValue={prefill?.why} className="field" placeholder="例：ぐっすり眠りたい" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="label">ペース</span>
          <select name="frequency" value={freq} onChange={(e) => setFreq(e.target.value)} className="field">
            <option value="daily">毎日</option>
            <option value="weekly">週に何回か</option>
          </select>
        </label>
        {freq === "weekly" && (
          <label className="block">
            <span className="label">週に何回？</span>
            <select name="target" defaultValue="3" className="field">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}回
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <SubmitButton className="btn-primary w-full">習慣を始める</SubmitButton>
    </ActionForm>
  );
}

export function HabitStatusButtons({ id, status }: { id: string; status: string }) {
  const buttons =
    status === "proposed"
      ? [
          { s: "active", label: "始める", cls: "btn-primary" },
          { s: "archived", label: "いらない", cls: "btn-secondary" },
        ]
      : status === "active"
        ? [
            { s: "paused", label: "お休み", cls: "btn-secondary" },
            { s: "done", label: "身についた", cls: "btn-secondary" },
            { s: "archived", label: "やめる", cls: "btn-secondary" },
          ]
        : [
            { s: "active", label: "再開する", cls: "btn-secondary" },
            { s: "archived", label: "片づける", cls: "btn-secondary" },
          ];
  return (
    <div className={`grid gap-2 ${COLS[buttons.length]}`}>
      {buttons.map((b) => (
        <ActionForm key={b.s} action={setHabitStatusAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={b.s} />
          <SubmitButton className={`${b.cls} w-full px-1 text-[13px]`} pendingText="…">
            {b.label}
          </SubmitButton>
        </ActionForm>
      ))}
    </div>
  );
}

export function NewEventForm() {
  return (
    <ActionForm action={createEventAction} resetOnSuccess>
      <label className="block">
        <span className="label">何がある？</span>
        <input name="title" required maxLength={80} className="field" placeholder="例：車検、自動車税、保険の更新、母の誕生日" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="label">日付</span>
          <input name="date" type="date" required className="field" />
        </label>
        <label className="block">
          <span className="label">くり返し</span>
          <select name="repeat" defaultValue="none" className="field">
            <option value="none">1回だけ</option>
            <option value="monthly">毎月</option>
            <option value="yearly">毎年</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="label">かかるお金（円・なくてもOK）</span>
          <input name="amount" inputMode="numeric" className="field" placeholder="例：80000" />
        </label>
        <label className="block">
          <span className="label">何日前に知らせる？</span>
          <select name="remindDays" defaultValue="7" className="field">
            {[0, 1, 3, 7, 14, 30].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "当日" : `${n}日前`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input name="note" maxLength={500} className="field" placeholder="メモ（なくてもOK）" />
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="prep" defaultChecked className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]" />
        <span>
          近づいたら、白石にチームで下調べを頼んでもらう
          <span className="block text-xs text-muted">30日前から、相場・やること・安くする方法などを報告書にしておきます（1件 約10〜20円）</span>
        </span>
      </label>
      <SubmitButton className="btn-primary w-full">予定を登録する</SubmitButton>
    </ActionForm>
  );
}

export function EventButtons({ id }: { id: string }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <ActionForm action={eventAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="act" value="done" />
        <SubmitButton className="btn-tinted w-full text-[13px]" pendingText="…">
          済んだ
        </SubmitButton>
      </ActionForm>
      <ActionForm action={eventAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="act" value="archive" />
        <SubmitButton className="btn-secondary w-full text-[13px]" pendingText="…" confirmText="この予定を消しますか？">
          消す
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

export function NewGoalForm({ prefill }: { prefill?: { title?: string; why?: string } }) {
  return (
    <ActionForm action={createGoalAction} resetOnSuccess>
      <label className="block">
        <span className="label">目標</span>
        <input name="title" required maxLength={80} defaultValue={prefill?.title} className="field" placeholder="例：貯金を30万円にする、体重を3kg減らす" />
      </label>
      <label className="block">
        <span className="label">なぜ？（なくてもOK）</span>
        <input name="why" maxLength={300} defaultValue={prefill?.why} className="field" placeholder="例：引っ越しの費用にしたい" />
      </label>
      <p className="text-xs text-muted">数字で測れる目標なら、下も入れると進み具合（%）が出ます。</p>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="label">いま</span>
          <input name="start" inputMode="decimal" className="field" placeholder="70" />
        </label>
        <label className="block">
          <span className="label">目標</span>
          <input name="target" inputMode="decimal" className="field" placeholder="67" />
        </label>
        <label className="block">
          <span className="label">単位</span>
          <input name="unit" maxLength={20} className="field" placeholder="kg" />
        </label>
      </div>
      <label className="block">
        <span className="label">いつまでに？（なくてもOK）</span>
        <input name="due" type="date" className="field" />
      </label>
      <SubmitButton className="btn-primary w-full">目標を登録する</SubmitButton>
    </ActionForm>
  );
}

export function GoalProgressForm({ id, unit }: { id: string; unit: string }) {
  return (
    <ActionForm action={addGoalProgressAction} resetOnSuccess>
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <input name="value" inputMode="decimal" className="field" placeholder="いまの数字" aria-label="いまの数字" />
        {unit && <span className="shrink-0 text-[14px] text-muted">{unit}</span>}
      </div>
      <input name="note" maxLength={500} className="field" placeholder="メモ（数字がない目標はメモだけでOK）" />
      <SubmitButton className="btn-primary w-full">進み具合を記録する</SubmitButton>
    </ActionForm>
  );
}

export function GoalStatusButtons({ id, status }: { id: string; status: string }) {
  const options = status === "active" ? [{ s: "achieved", l: "達成した" }, { s: "paused", l: "お休み" }, { s: "dropped", l: "やめる" }] : [{ s: "active", l: "再開する" }];
  return (
    <div className={`grid gap-2 ${COLS[options.length]}`}>
      {options.map((o) => (
        <ActionForm key={o.s} action={setGoalStatusAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={o.s} />
          <SubmitButton className="btn-secondary w-full px-1 text-[13px]" pendingText="…">
            {o.l}
          </SubmitButton>
        </ActionForm>
      ))}
    </div>
  );
}

export function RunReviewButton() {
  return (
    <ActionForm action={runReviewAction}>
      <SubmitButton className="btn-primary w-full" pendingText="森野がふりかえっています…（1分ほど）">
        この1週間をふりかえる（約1円）
      </SubmitButton>
    </ActionForm>
  );
}

export function DismissNudgeButton({ id }: { id: string }) {
  return (
    <ActionForm action={dismissNudgeAction} className="contents">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-faint" aria-label="このひとことを閉じる">
        <Icon name="close" size={16} stroke={2.4} />
      </button>
    </ActionForm>
  );
}

export function ResearchNowButton() {
  return (
    <ActionForm action={runResearchNowAction}>
      <SubmitButton className="btn-secondary w-full" pendingText="社員が調べています…（1分ほど）">
        今週の担当に、いま自主研究を頼む（約3〜6円）
      </SubmitButton>
    </ActionForm>
  );
}
