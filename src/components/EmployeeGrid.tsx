"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Avatar } from "./Avatar";
import { EMPLOYEE_STATUS_LABEL } from "@/lib/constants";
import { useLiveEmployees } from "@/lib/live-status";
import type { EmployeeStatus } from "@/lib/avatar-videos";

// 社員を「アイコン（動画）が主役」のグリッドで並べる（ホーム・社員一覧）。
// iPhone の画面で7人全員がスクロールなしに1画面に収まるよう、アイコンの大きさを「実際に空いている高さ」に合わせて決める。
// - fit="below"：グリッドの上端から、下のタブバーまでに収める（社員一覧：開いたままの画面で全員が見える）
// - fit="screen"：画面の高さ（タブバーと見出しを除く）に収める（ホーム：スクロールしてここに来たとき全員が見える）
// 計算できないあいだ（最初の表示・JavaScript なし）は、globals.css の .emp-av の目安の大きさで表示する。

export type EmployeeGridItem = {
  id: string;
  name: string;
  department_name: string | null;
  avatar_color: string;
  avatar_style: string;
  avatar_videos: unknown;
  status: EmployeeStatus;
  /** 状態のあとに続ける短い説明（例：「担当 1件」「記事の執筆」） */
  detail?: string;
};

const DOT: Record<string, string> = { working: "bg-success", thinking: "bg-accent", idle: "bg-faint", offline: "bg-muted" };

const COLS = 3;
const GAP = 8;
const MIN_AV = 44;
const MAX_AV = 140;

/** 画面の下にあるタブバーの上端（なければ画面の下端） */
function bottomLimit(): number {
  const tab = document.querySelector<HTMLElement>("[data-tabbar]");
  return tab ? tab.getBoundingClientRect().top : window.innerHeight;
}

export function EmployeeGrid({
  employees,
  fit,
  detail,
  label = "社員",
}: {
  employees: EmployeeGridItem[];
  fit: "below" | "screen";
  /** 状態のあとに出すひとこと（tasks：担当している業務の数／activity：いまの仕事・最後の仕事）。数秒ごとに最新にする */
  detail: "tasks" | "activity";
  label?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  // 待機中・考え中・作業中を、画面を開いたまま数秒ごとに最新にする（ページ全体は読み直さない）
  const live = useLiveEmployees();

  useEffect(() => {
    const ul = ref.current;
    if (!ul) return;
    const rows = Math.ceil(employees.length / COLS);
    const update = () => {
      const tile = ul.querySelector<HTMLElement>("[data-employee-tile] > a");
      const av = ul.querySelector<HTMLElement>(".emp-av");
      if (!tile || !av) return;
      // アイコン以外（名前・部署・状態・余白）の高さ
      const extra = tile.getBoundingClientRect().height - av.getBoundingClientRect().height;
      const limit = bottomLimit() - 8;
      // below：ページのいちばん上にいるときの、グリッドの上端からタブバーまで。screen：画面の高さから見出しの分を引いたもの
      const room = fit === "below" ? limit - (ul.getBoundingClientRect().top + window.scrollY) : limit - 40;
      const size = Math.floor(Math.min(MAX_AV, Math.max(MIN_AV, (room - GAP * (rows - 1)) / rows - extra)));
      ul.style.setProperty("--emp-av-px", `${size}px`);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [employees.length, fit]);

  return (
    <ul ref={ref} aria-label={label} className="emp-grid flex flex-wrap justify-center gap-2">
      {employees.map((initial) => {
        const now = live?.get(initial.id);
        const e = now
          ? {
              ...initial,
              status: now.status,
              detail: detail === "tasks" ? `担当 ${now.activeTasks}件` : (now.activity ?? undefined),
            }
          : initial;
        const status = EMPLOYEE_STATUS_LABEL[e.status] ?? e.status;
        const line = e.detail ? `${status}・${e.detail}` : status;
        return (
          <li key={e.id} className="w-[calc((100%-1rem)/3)]" data-employee-tile={e.id} data-status={e.status}>
            <Link
              href={`/employees/${e.id}`}
              className="card press flex h-full flex-col items-center px-1.5 py-1.5 text-center"
              aria-label={`${e.name}（${e.department_name ?? ""}・${line}）`}
            >
              <span className="emp-av">
                <Avatar
                  fluid
                  color={e.avatar_color}
                  styleId={e.avatar_style}
                  status={e.status}
                  label={e.name}
                  videos={e.avatar_videos}
                />
              </span>
              <span className="mt-1 block w-full truncate text-[14px] leading-tight font-bold">{e.name}</span>
              <span className="block w-full truncate text-[11px] leading-tight font-semibold" style={{ color: e.avatar_color }}>
                {e.department_name}
              </span>
              <span className="flex w-full items-center justify-center gap-1 text-[11px] leading-tight text-muted" title={line}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[e.status] ?? "bg-faint"}`} aria-hidden />
                <span className="truncate">{line}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
