"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { showToast } from "@/components/Toaster";
import {
  markPublishedAction,
  recordMetricsAction,
  recordPostAction,
  runMediaNowAction,
  updateBrandAccountsAction,
  updateMediaSettingsAction,
} from "@/app/actions/mediaco";

export function RunNowButton({ label = "今すぐAI社員を動かす" }: { label?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className="btn-tinted w-full"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const r: ActionState = await runMediaNowAction();
        setPending(false);
        if (r.ok) showToast(r.message ?? "始めました", "success");
        else showToast(r.error ?? "始められませんでした", "error");
      }}
    >
      {pending ? "準備中…" : label}
    </button>
  );
}

const numField = (name: string, label: string, value: number, unit = "") => (
  <label className="block">
    <span className="label">{label}</span>
    <div className="flex items-center gap-1.5">
      <input name={name} type="number" inputMode="numeric" min={0} defaultValue={value} required className="field" />
      {unit && <span className="shrink-0 text-sm text-muted">{unit}</span>}
    </div>
  </label>
);

export function PublishForm({ id, url }: { id: string; url: string }) {
  return (
    <ActionForm action={markPublishedAction}>
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="label">note の記事のURL</span>
        <input name="url" type="url" inputMode="url" defaultValue={url} placeholder="https://note.com/…/n/…" required className="field" />
      </label>
      <SubmitButton className="btn-primary w-full">公開した</SubmitButton>
    </ActionForm>
  );
}

export function MetricsForm({ id, m }: { id: string; m: { views: number; likes: number; sales: number; revenue: number } }) {
  return (
    <ActionForm action={recordMetricsAction}>
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-2 gap-3">
        {numField("views", "閲覧数", m.views)}
        {numField("likes", "スキ数", m.likes)}
        {numField("sales", "販売数", m.sales, "件")}
        {numField("revenue", "売上（合計）", m.revenue, "円")}
      </div>
      <p className="text-xs text-muted">note の「ダッシュボード」に出ている数字を入れてください。売上が増えた分は、お金の記録（収益）にも自動で入ります。</p>
      <SubmitButton className="btn-secondary w-full">数字を記録する</SubmitButton>
    </ActionForm>
  );
}

export function PostRecordForm({ id }: { id: string }) {
  return (
    <ActionForm action={recordPostAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input name="url" type="url" inputMode="url" placeholder="投稿のURL（なくてもOK）" className="field" />
      <div className="grid grid-cols-4 gap-2">
        {[
          ["impressions", "表示"],
          ["likes", "いいね"],
          ["reposts", "リポスト"],
          ["clicks", "クリック"],
        ].map(([n, l]) => (
          <label key={n} className="block">
            <span className="block text-[11px] font-semibold text-muted">{l}</span>
            <input name={n} type="number" inputMode="numeric" min={0} defaultValue={0} className="field px-2" />
          </label>
        ))}
      </div>
      <SubmitButton className="btn-secondary w-full">投稿した（記録する）</SubmitButton>
    </ActionForm>
  );
}

export function BrandAccountsForm({ id, noteUrl, xHandle }: { id: string; noteUrl: string; xHandle: string }) {
  return (
    <ActionForm action={updateBrandAccountsAction}>
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="label">note のアカウント（URL）</span>
        <input name="note_url" type="url" inputMode="url" defaultValue={noteUrl} placeholder="https://note.com/あなたのID" className="field" />
      </label>
      <label className="block">
        <span className="label">X のアカウント（ID）</span>
        <input name="x_handle" defaultValue={xHandle} placeholder="@なしのID" className="field" />
      </label>
      <SubmitButton className="btn-secondary w-full">アカウントを記録する</SubmitButton>
    </ActionForm>
  );
}

export function MediaSettingsForm({ initial }: { initial: { media_enabled: boolean; media_articles_per_day: number; media_posts_per_day: number } }) {
  return (
    <ActionForm action={updateMediaSettingsAction}>
      <label className="flex items-center gap-3 text-[15px]">
        <input type="checkbox" name="media_enabled" defaultChecked={initial.media_enabled} className="h-5 w-5 accent-[var(--brand)]" />
        メディア事業を自動で動かす（1日4回）
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">1日に作る記事</span>
          <select name="media_articles_per_day" defaultValue={String(initial.media_articles_per_day)} className="field">
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}本
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">1日のXの投稿案</span>
          <select name="media_posts_per_day" defaultValue={String(initial.media_posts_per_day)} className="field">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}件
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted">月の経営会議で、CEOが「1日に作る記事」を見直すことがあります。予算の上限は「設定 → 予算」で、あなたが決めます。</p>
      <SubmitButton className="btn-secondary w-full">保存</SubmitButton>
    </ActionForm>
  );
}
