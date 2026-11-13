"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };

const EVENT = "pac-toast";

/** 画面上部に短いお知らせ（「保存しました」など）を出す */
export function showToast(message: string, tone: Toast["tone"] = "success") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, tone } }));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let id = 0;
    const onToast = (e: Event) => {
      const { message, tone } = (e as CustomEvent<{ message: string; tone: Toast["tone"] }>).detail;
      const t = { id: ++id, message, tone };
      // 同じお知らせが重ならないよう、同じ文のものは新しいものに置き換える
      setToasts((prev) => [...prev.filter((x) => x.message !== message).slice(-2), t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 2600);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="toast-in pointer-events-auto mt-2 flex max-w-md items-center gap-2.5 rounded-full bg-surface/95 px-4 py-2.5 text-[14px] font-semibold shadow-pop ring-1 ring-line backdrop-blur"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-white ${
              t.tone === "error" ? "bg-danger" : t.tone === "info" ? "bg-brand" : "bg-success"
            }`}
          >
            <Icon name={t.tone === "error" ? "alert" : t.tone === "info" ? "info" : "check"} size={14} stroke={2.6} />
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
