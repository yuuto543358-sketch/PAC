"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";
import { FormError, SubmitButton } from "@/components/forms";

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="card space-y-4 p-5 shadow-pop">
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
      <FormError message={state.error} />
      <SubmitButton pendingText="確認中…">ログイン</SubmitButton>
    </form>
  );
}
