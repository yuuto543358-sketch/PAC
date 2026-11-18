"use client";

import { useSyncExternalStore } from "react";
import type { EmployeeStatus } from "@/lib/avatar-videos";

// 社員の状態（待機中・考え中・作業中）を、画面を開いたまま数秒ごとに読み直す（ページ全体は読み直さない）。
// - 画面に出ている部品がいくつあっても、読みにいくのは1つだけ（全員分をまとめて読む）
// - アプリが裏にあるとき（画面を見ていないとき）は読みにいかない。戻ってきたらすぐ読む

export type LiveEmployee = { id: string; status: EmployeeStatus; activeTasks: number; running: string | null; activity: string | null };

export const LIVE_STATUS_INTERVAL_MS = 4000;

let states: ReadonlyMap<string, LiveEmployee> | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function poll() {
  if (inFlight || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
  inFlight = true;
  try {
    const res = await fetch("/api/employees/status", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { employees?: LiveEmployee[] };
    if (!Array.isArray(data.employees)) return;
    const next = new Map(data.employees.map((e) => [e.id, e]));
    // 変わったときだけ画面を描き直す
    const changed =
      !states ||
      states.size !== next.size ||
      [...next].some(([id, e]) => {
        const p = states!.get(id);
        return !p || p.status !== e.status || p.activeTasks !== e.activeTasks || p.running !== e.running || p.activity !== e.activity;
      });
    if (changed) {
      states = next;
      for (const l of listeners) l();
    }
  } catch {
    // 通信できないときは、前の表示のまま（次の回にまた読む）
  } finally {
    inFlight = false;
  }
}

function onVisible() {
  if (document.visibilityState === "visible") void poll();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void poll();
    timer = setInterval(() => void poll(), LIVE_STATUS_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    }
  };
}

const getSnapshot = () => states;
const getServerSnapshot = () => null;

/** 全員のいまの状態（まだ読めていないときは null。そのときはページを開いたときの状態を使う） */
export function useLiveEmployees(): ReadonlyMap<string, LiveEmployee> | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** 1人のいまの仕事（読めていないときは、ページを開いたときの値） */
export function useLiveRunning(id: string, initial: string | null): string | null {
  const now = useLiveEmployees()?.get(id);
  return now ? now.running : initial;
}

/** 1人のいまの状態（読めていないときは、ページを開いたときの状態） */
export function useLiveStatus(id: string, initial: EmployeeStatus): EmployeeStatus {
  return useLiveEmployees()?.get(id)?.status ?? initial;
}
