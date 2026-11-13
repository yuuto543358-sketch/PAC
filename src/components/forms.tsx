"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export type ActionState = { ok?: boolean; error?: string; message?: string; ts?: number };

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
      {pending ? pendingText : children}
    </button>
  );
}

/**
 * サーバーアクションを呼び出し、結果（成功・エラー）を表示するフォーム。
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
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state.error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="rounded-xl bg-success-soft px-3 py-2 text-sm font-medium text-success">
          {state.message}
        </p>
      )}
    </form>
  );
}
