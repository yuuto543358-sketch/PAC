"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendChatAction, type ChatActionState } from "@/app/actions/chat";

export function ScrollToBottom({ count }: { count: number }) {
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [count]);
  return null;
}

export function ChatComposer({
  employeeId,
  conversationId,
  disabledReason,
  advancedAllowed,
}: {
  employeeId: string;
  conversationId: string | null;
  disabledReason: string | null;
  advancedAllowed: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sentText, setSentText] = useState("");
  const [state, action, pending] = useActionState<ChatActionState, FormData>(sendChatAction, {});
  const lastTs = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.ts || state.ts === lastTs.current) return;
    lastTs.current = state.ts;
    // 新しい会話を始めたときは、URLに会話IDを付けて再読み込みしても同じ会話が開くようにする
    if (state.conversationId && new URLSearchParams(window.location.search).get("c") !== state.conversationId) {
      router.replace(`/employees/${employeeId}/chat?c=${state.conversationId}`, { scroll: false });
    }
  }, [state, conversationId, employeeId, router]);

  useEffect(() => {
    if (pending) window.scrollTo({ top: document.body.scrollHeight });
  }, [pending]);

  return (
    <div className="fixed inset-x-0 z-20 border-t border-line bg-[var(--tabbar)] backdrop-blur" style={{ bottom: "calc(56px + env(safe-area-inset-bottom))" }}>
      <div className="mx-auto max-w-2xl px-3 py-2.5">
        {pending && (
          <div className="mb-2 space-y-1.5">
            <div className="ml-auto w-fit max-w-[85%] truncate rounded-2xl bg-brand/70 px-3 py-1.5 text-sm text-brand-fg">{sentText}</div>
            <div className="text-xs text-muted" role="status">
              考えています…
            </div>
          </div>
        )}
        {disabledReason ? (
          <p className="rounded-xl bg-surface-2 px-3 py-3 text-sm text-muted">{disabledReason}</p>
        ) : (
          <form
            action={(fd) => {
              setSentText(String(fd.get("message") ?? ""));
              setText("");
              action(fd);
            }}
          >
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="conversationId" value={conversationId ?? ""} />
            <div className="flex items-end gap-2">
              <textarea
                name="message"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={1}
                maxLength={2000}
                required
                placeholder="メッセージを入力"
                className="field max-h-36 min-h-11 flex-1 resize-none py-2.5"
                style={{ height: Math.min(144, 44 + Math.max(0, text.split("\n").length - 1) * 22) }}
                disabled={pending}
              />
              <button type="submit" disabled={pending || !text.trim()} className="btn-primary h-11 w-14 shrink-0 px-0" aria-label="送信">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
              {advancedAllowed ? (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" name="advanced" className="h-4 w-4" disabled={pending} />
                  高性能モデルで考える（費用が高くなります）
                </label>
              ) : (
                <span>軽量モデルで応答します</span>
              )}
              <span>{text.length}/2000</span>
            </div>
          </form>
        )}
        {state.error && !pending && (
          <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger">
            {state.error}
          </p>
        )}
      </div>
    </div>
  );
}
