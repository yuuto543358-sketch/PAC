"use client";

import { useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { showToast } from "./Toaster";
import { Icon } from "./Icon";

export type ActionState = { ok?: boolean; error?: string; message?: string; ts?: number };

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function SubmitButton({
  children,
  pendingText = "処理中…",
  className = "btn-primary w-full",
  name,
  value,
  confirmText,
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
  confirmText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={className}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[14px] font-medium text-danger">
      <Icon name="alert" size={18} stroke={2} className="mt-px shrink-0" />
      {message}
    </p>
  );
}

/**
 * サーバーアクションを呼び出すフォーム。
 * 成功したら画面上部にお知らせ（トースト）を出し、失敗したらフォームの中にエラーを表示します。
 * （承認のように、成功するとフォーム自体が画面から消える場合でも、お知らせは必ず出ます）
 */
export function ActionForm({
  action,
  children,
  className = "space-y-3",
  resetOnSuccess = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, setState] = useState<ActionState>({});
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={async (formData) => {
        const r = await action(state, formData);
        if (r.ok && r.message) showToast(r.message, "success");
        if (r.ok && resetOnSuccess) ref.current?.reset();
        setState(r);
      }}
      className={className}
    >
      {children}
      <FormError message={state.ok ? undefined : state.error} />
    </form>
  );
}
