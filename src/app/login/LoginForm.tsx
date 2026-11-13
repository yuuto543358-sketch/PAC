"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/forms";

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="card space-y-4 p-5">
      <div>
        <label htmlFor="password" className="label">
          パスワード
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field"
          placeholder="設定したパスワード"
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      <SubmitButton pendingText="確認中…">ログイン</SubmitButton>
    </form>
  );
}
