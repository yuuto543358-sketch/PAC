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
};

export function EmployeeEditForm({ e, department, roleKey }: { e: E; department: string; roleKey: string }) {
  const [color, setColor] = useState(e.avatar_color);
  const [style, setStyle] = useState(e.avatar_style);
  const area = (name: keyof E, label: string, rows = 3, hint?: string) => (
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
        <Avatar color={color} styleId={style} size={72} label="プレビュー" />
        <div className="flex-1 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">色</span>
            <input type="color" name="avatar_color" value={color} onChange={(ev) => setColor(ev.target.value)} className="h-9 w-14 rounded" />
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
      <SubmitButton>保存する</SubmitButton>
    </ActionForm>
  );
}
