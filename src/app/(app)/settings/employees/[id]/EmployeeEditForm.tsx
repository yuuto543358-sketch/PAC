"use client";

import { useState } from "react";
import { updateEmployeeAction } from "@/app/actions/employees";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, AVATAR_STYLES } from "@/components/Avatar";

type E = {
  id: string;
  name: string;
  name_kana: string;
  role_title: string;
  personality: string;
  speaking_style: string;
  expertise: string;
  strengths: string;
  weaknesses: string;
  judgment_criteria: string;
  avatar_color: string;
  avatar_style: string;
  status: string;
  avatar_videos: Record<string, string>;
};

const VIDEO_FIELDS = [
  { state: "idle", label: "待機中の動画" },
  { state: "working", label: "作業中の動画" },
  { state: "thinking", label: "考え中の動画" },
] as const;

export function EmployeeEditForm({ e, department, roleKey }: { e: E; department: string; roleKey: string }) {
  const [color, setColor] = useState(e.avatar_color);
  const [style, setStyle] = useState(e.avatar_style);
  const area = (name: Exclude<keyof E, "avatar_videos">, label: string, rows = 3, hint?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <textarea name={name} defaultValue={e[name]} rows={rows} maxLength={1000} className="field" />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
  return (
    <ActionForm action={updateEmployeeAction} className="card space-y-4 p-4">
      <input type="hidden" name="id" value={e.id} />
      <div className="flex items-center gap-4">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <Avatar color={color} styleId={style} size={72} label="プレビュー" videos={e.avatar_videos} status="idle" />
          {Object.keys(e.avatar_videos ?? {}).length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted" title="動画が読み込めないときに出るイラスト（色と髪型はここで変えられます）">
              <Avatar color={color} styleId={style} size={22} label="動画が出ないときのイラスト" />
              動画がないとき
            </span>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">色</span>
            <input type="color" name="avatar_color" value={color} onChange={(ev) => setColor(ev.target.value)} className="h-11 w-14 rounded" />
          </label>
          <select name="avatar_style" value={style} onChange={(ev) => setStyle(ev.target.value)} className="field">
            {AVATAR_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">名前</span>
          <input name="name" defaultValue={e.name} required maxLength={40} className="field" />
        </label>
        <label className="block">
          <span className="label">ふりがな</span>
          <input name="name_kana" defaultValue={e.name_kana} maxLength={60} className="field" />
        </label>
        <label className="block">
          <span className="label">役職名</span>
          <input name="role_title" defaultValue={e.role_title} maxLength={60} className="field" />
        </label>
        <label className="block">
          <span className="label">稼働状態</span>
          <select name="status" defaultValue={e.status} className="field">
            <option value="idle">待機中</option>
            <option value="working">業務中</option>
            <option value="thinking">考え中</option>
            <option value="offline">休止中</option>
          </select>
        </label>
      </div>
      <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
        所属：{department} ／ 役割：{roleKey}（役割と権限は変更できません）
      </p>
      {area("personality", "性格")}
      {area("speaking_style", "話し方")}
      {area("expertise", "専門分野", 3, "1行に1つずつ")}
      {area("strengths", "得意な業務", 2, "1行に1つずつ")}
      {area("weaknesses", "苦手な業務", 2, "1行に1つずつ")}
      {area("judgment_criteria", "判断基準")}
      <fieldset className="space-y-2 rounded-xl bg-surface-2 p-3">
        <legend className="px-1 text-[13px] font-semibold">アイコンの動画（状態ごと）</legend>
        <p className="text-xs text-muted">
          アプリの中にある動画ファイルの場所を入れます（例：/avatars/student2/idle.mp4）。空にすると、その状態ではイラストのアイコンになります。動画が読み込めない端末でも、イラストのアイコンが出ます。
        </p>
        {VIDEO_FIELDS.map((f) => (
          <label key={f.state} className="block">
            <span className="label">{f.label}</span>
            <input name={`avatar_video_${f.state}`} defaultValue={e.avatar_videos?.[f.state] ?? ""} placeholder="/avatars/…/….mp4" className="field" />
          </label>
        ))}
      </fieldset>
      <SubmitButton>保存する</SubmitButton>
    </ActionForm>
  );
}
