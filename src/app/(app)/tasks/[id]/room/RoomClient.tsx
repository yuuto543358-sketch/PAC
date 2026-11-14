"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { advanceTeamAction, pauseTeamAction, postInstructionAction, resumeTeamAction } from "@/app/actions/workflow";
import type { ActionState } from "@/components/forms";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { showToast } from "@/components/Toaster";

export function RoomScroll({ lastId }: { lastId: number }) {
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [lastId]);
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * グループチャットの下部（指示の入力欄）と、画面を開いている間の自動進行。
 * チームの作業を1段階ずつ進め、終わるたびに画面を更新します。
 */
export function RoomClient({
  taskId,
  active,
  lastMessageId,
  phase,
  autopilot,
  speaker,
  canResume,
  modelLabel,
}: {
  taskId: string;
  active: boolean;
  lastMessageId: number;
  phase: string;
  autopilot: boolean;
  speaker: { name: string; color: string; style: string } | null;
  canResume: boolean;
  modelLabel: string;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [tick, setTick] = useState(0);
  const [stopNote, setStopNote] = useState<string | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(postInstructionAction, {});
  const [pauseState, pauseAction, pausePending] = useActionState<ActionState, FormData>(
    canResume ? resumeTeamAction : pauseTeamAction,
    {},
  );
  const lastTs = useRef<number | undefined>(undefined);
  const lastPauseTs = useRef<number | undefined>(undefined);

  // 自動進行：1段階進める → 画面を更新 → 新しい状態で次の段階へ
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      if (document.hidden) return;
      setWorking(true);
      const r = await advanceTeamAction(taskId);
      if (cancelled) return;
      setWorking(false);
      if (r.status === "busy") {
        // 他の場所（バックグラウンド）で作業中。少し待ってから画面を更新する
        await sleep(3500);
        if (cancelled) return;
        router.refresh();
        setTick((t) => t + 1);
        return;
      }
      if (r.status === "blocked" || r.status === "error") {
        setStopNote(r.message);
        router.refresh();
        return;
      }
      setStopNote(null);
      router.refresh();
      if (r.status === "idle") return;
      if (r.status === "failed") await sleep(1500);
      setTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, lastMessageId, phase, tick, taskId, router]);

  useEffect(() => {
    if (!state.ts || state.ts === lastTs.current) return;
    lastTs.current = state.ts;
    // 指示を送ると新しい発言が増えるので、自動進行はそれをきっかけに再開する
    if (state.ok && state.message) showToast(state.message);
  }, [state]);

  useEffect(() => {
    if (!pauseState.ts || pauseState.ts === lastPauseTs.current) return;
    lastPauseTs.current = pauseState.ts;
    if (pauseState.ok && pauseState.message) showToast(pauseState.message, "info");
  }, [pauseState]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-20">
      {active && working && speaker && (
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 pb-3" role="status" aria-label={`${speaker.name}が作業中`}>
          <Avatar color={speaker.color} styleId={speaker.style} size={30} label={speaker.name} />
          <div className="flex items-center gap-2 rounded-[20px] rounded-tl-[6px] bg-surface px-4 py-3 shadow-card ring-1 ring-line/60">
            <span className="flex items-center gap-1">
              <span className="typing-dot h-2 w-2 rounded-full bg-faint" />
              <span className="typing-dot h-2 w-2 rounded-full bg-faint" />
              <span className="typing-dot h-2 w-2 rounded-full bg-faint" />
            </span>
            <span className="text-[13px] text-muted">{speaker.name}が考えています…</span>
          </div>
        </div>
      )}
      {stopNote && (
        <div className="mx-auto max-w-2xl px-3 pb-2">
          <p className="flex items-start gap-2 rounded-[12px] bg-accent-soft px-3 py-2 text-[12px] font-medium text-accent">
            <Icon name="alert" size={15} stroke={2} className="mt-px shrink-0" />
            {stopNote}
          </p>
        </div>
      )}
      <div className="bg-[var(--tabbar)] shadow-[0_-0.5px_0_var(--separator)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto max-w-2xl px-3 pt-2 pb-2">
          <form
            action={(fd) => {
              setText("");
              action(fd);
            }}
          >
            <input type="hidden" name="taskId" value={taskId} />
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
                  placeholder="チームへの指示（任意）"
                  className="max-h-[140px] w-full resize-none bg-transparent py-2.5 text-[16px] leading-6 outline-none placeholder:text-faint"
                  disabled={pending}
                />
              </div>
              <button
                type="submit"
                disabled={pending || !text.trim()}
                className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg shadow-card disabled:opacity-35"
                aria-label="指示を送る"
              >
                <Icon name="send" size={20} stroke={2.2} />
              </button>
            </div>
          </form>
          <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-faint">
            <span>
              {active
                ? `チームが自動で進めています（使用モデル：${modelLabel}）`
                : phase === "waiting_human"
                  ? "経営者の確認待ちです"
                  : phase === "done"
                    ? "完了しました（指示を送ると修正版を作ります）"
                    : autopilot
                      ? "待機中"
                      : "一時停止中"}
            </span>
            {phase !== "done" && (
              <form action={pauseAction}>
                <input type="hidden" name="taskId" value={taskId} />
                <button type="submit" disabled={pausePending} className="press rounded-full px-2 py-1 font-semibold text-brand">
                  {canResume ? "再開する" : "一時停止"}
                </button>
              </form>
            )}
          </div>
          {state.error && (
            <p role="alert" className="mt-1.5 rounded-[10px] bg-danger-soft px-3 py-1.5 text-[12px] font-medium text-danger">
              {state.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
