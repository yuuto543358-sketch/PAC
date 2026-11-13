// データベースのエラーを、利用者が対処できる日本語の説明に変換します（秘密情報は含めない）。

export function describeDbError(err: unknown): string {
  const e = (err ?? {}) as { name?: string; code?: string; message?: string };
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (e.name === "TimeoutError") {
    return "データベースから時間内に応答がありませんでした。Supabase のプロジェクトが一時停止していないか確認し、1分ほど待ってからもう一度お試しください。";
  }
  if (code === "28P01" || msg.includes("password authentication failed")) {
    return "データベースのパスワードが違います。Vercel の DATABASE_URL に入れたパスワードを確認してください。";
  }
  if (msg.includes("tenant or user not found")) {
    return "データベースのユーザー名が違います。Supabase の「Connect → Transaction pooler」の文字をそのままコピーして、DATABASE_URL に入れ直してください。";
  }
  if (code === "55P03") {
    return "データベースの準備処理が混み合っています。1分ほど待ってからもう一度お試しください。";
  }
  if (code === "QUERY_TIMEOUT" || code === "QUEUE_TIMEOUT" || code === "CANCEL_UNANSWERED") {
    return "データベースの応答が時間内に返ってきませんでした。少し待ってからもう一度お試しください（接続は自動で作り直されます）。";
  }
  if (code === "57014") {
    return "データベースの処理が時間内に終わりませんでした。もう一度お試しください。";
  }
  if (
    code === "CONNECT_TIMEOUT" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    code === "CONNECTION_CLOSED" ||
    code === "CONNECTION_ENDED" ||
    code === "CONNECTION_DESTROYED"
  ) {
    return "データベースに接続できませんでした。DATABASE_URL が Supabase の「Transaction pooler」（ポート 6543）の文字になっているか、Supabase のプロジェクトが一時停止していないか確認してください。";
  }
  if ((e.message ?? "").startsWith("DATABASE_URL の設定に問題があります")) {
    return e.message as string;
  }
  return "データベースでエラーが発生しました。時間をおいてもう一度お試しください。続く場合は Vercel の Logs で「[pac]」を含む行を確認してください。";
}
