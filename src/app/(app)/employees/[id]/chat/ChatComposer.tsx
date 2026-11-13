"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendChatAction, type ChatActionState } from "@/app/actions/chat";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";

export function ScrollToBottom({ count }: { count: number }) {
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [count]);
  return null;
}

export function ChatComposer({
  employeeId,
  conversationId,
  employee,
  suggestions,
  disabledReason,
  advancedAllowed,
}: {
  employeeId: string;
  conversationId: string | null;
  employee: { name: string; color: string; style: string };
  suggestions: string[];
  disabledReason: string | null;
  advancedAllowed: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sentText, setSentText] = useState("");
  const [state, action, pending] = useActionState<ChatActionState, FormData>(sendChatAction, {});
  const lastTs = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!state.ts || state.ts === lastTs.current) return;
    lastTs.current = state.ts;
    // 新しい会話を始めたときは、URLに会話IDを付けて再読み込みしても同じ会話が開くようにする
    if (state.conversationId && new URLSearchParams(window.location.search).get("c") !== state.conversationId) {
      router.replace(`/employees/${employeeId}/chat?c=${state.conversationId}`, { scroll: false });
    }
  }, [state, employeeId, router]);

  useEffect(() => {
    if (pending) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }, [pending]);

  // 入力に合わせて高さを自動で伸ばす（最大6行程度）
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);

  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-20">
      {pending && (
        <div className="mx-auto max-w-2xl space-y-2.5 px-3 pb-3">
          <div className="flex justify-end">
            <div className="max-w-[82%] rounded-[20px] rounded-br-[6px] bg-brand/80 px-3.5 py-2.5 text-[16px] leading-relaxed whitespace-pre-wrap text-brand-fg">
              {sentText}
            </div>
          </div>
          <div className="flex items-end gap-2" role="status" aria-label="考えています">
            <Avatar color={employee.color} styleId={employee.style} size={30} label={employee.name} />
            <div className="flex items-center gap-1 rounded-[20px] rounded-bl-[6px] bg-surface px-4 py-3.5 shadow-card ring-1 ring-line/60">
              <span className="typing-dot h-2 w-2 rounded-full bg-faint" />
              <span className="typing-dot h-2 w-2 rounded-full bg-faint" />
              <span className="typing-dot h-2 w-2 rounded-full bg-faint" />
              <span className="sr-only">考えています…</span>
            </div>
          </div>
        </div>
      )}

      {!pending && !disabledReason && suggestions.length > 0 && !text && (
        <div className="mx-auto max-w-2xl px-3 pb-2">
          <p className="mb-1.5 px-1 text-[11px] font-semibold text-faint">話しかけてみましょう</p>
          <div className="flex flex-col items-start gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setText(s);
                  inputRef.current?.focus();
                }}
                className="press max-w-full rounded-[16px] bg-surface px-3.5 py-2 text-left text-[14px] leading-snug font-medium text-brand shadow-card ring-1 ring-line"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[var(--tabbar)] shadow-[0_-0.5px_0_var(--separator)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto max-w-2xl px-3 pt-2 pb-2">
          {disabledReason ? (
            <p className="flex items-start gap-2 rounded-[14px] bg-surface-2 px-3.5 py-3 text-[14px] text-muted">
              <Icon name="lock" size={18} className="mt-px shrink-0" />
              {disabledReason}
            </p>
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
                <div className="flex min-h-11 flex-1 items-end rounded-[22px] bg-surface px-4 ring-1 ring-line focus-within:ring-brand/60">
                  <textarea
                    ref={inputRef}
                    name="message"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={1}
                    maxLength={2000}
                    required
                    placeholder={`${employee.name.split(" ")[1] ?? employee.name}さんにメッセージ`}
                    className="max-h-[150px] w-full resize-none bg-transparent py-2.5 text-[16px] leading-6 outline-none placeholder:text-faint"
                    disabled={pending}
                  />
                </div>
                <button
                  type="submit"
                  disabled={pending || !text.trim()}
                  className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg shadow-card transition-opacity disabled:opacity-35"
                  aria-label="送信"
                >
                  <Icon name="send" size={20} stroke={2.2} />
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-faint">
                {advancedAllowed ? (
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" name="advanced" className="h-4 w-4 accent-[var(--brand)]" disabled={pending} />
                    高性能モデルで考える（費用が高くなります）
                  </label>
                ) : (
                  <span>軽量モデルで応答します</span>
                )}
                <span className="tabular">{text.length}/2000</span>
              </div>
            </form>
          )}
          {state.error && !pending && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-[12px] bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">
              <Icon name="alert" size={15} stroke={2} className="mt-px shrink-0" />
              {state.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
