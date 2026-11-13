// DATABASE_URL（データベースの接続文字列）を確認・整形します。
// よくある貼り付けミス（前後の空白・引用符・[YOUR-PASSWORD] の置き換え忘れ・パスワード内の記号）を検出します。
// ここで作る情報には、パスワードを含めないこと。

export type DatabaseUrlInfo = {
  host: string;
  port: number;
  user: string;
  database: string;
  kind: "supabase-transaction-pooler" | "supabase-session-pooler" | "supabase-direct" | "local" | "other";
};

export type ParsedDatabaseUrl =
  | { ok: true; url: string; info: DatabaseUrlInfo; warnings: string[] }
  | { ok: false; problems: string[] };

export function parseDatabaseUrl(raw: string | undefined | null): ParsedDatabaseUrl {
  if (!raw) return { ok: false, problems: ["DATABASE_URL が設定されていません。"] };
  // 前後の空白・改行・引用符を取り除く（コピー＆貼り付けで入りやすい）
  const s = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  const problems: string[] = [];

  // パスワードに @ が含まれていても読めるよう、ホストは「最後の @ の後ろ」として読む
  const m = /^(postgres(?:ql)?):\/\/([^:/?#@]+)(?::(.*))?@([^@/?#]+?)(?::(\d+))?\/([^?#]*)(\?.*)?$/.exec(s);
  if (!m) {
    return {
      ok: false,
      problems: [
        "DATABASE_URL の形が正しくありません。postgresql://ユーザー名:パスワード@ホスト:ポート/postgres の形になっているか確認してください。",
      ],
    };
  }
  const [, , user, rawPasswordOrUndef, host, portStr, database, query] = m;
  const rawPassword = rawPasswordOrUndef ?? "";
  if (/\[|\]/.test(rawPassword) || /YOUR-PASSWORD/i.test(rawPassword)) {
    problems.push("DATABASE_URL の [YOUR-PASSWORD] を、Supabase で決めたデータベースのパスワードに置き換えてください（[ と ] も消します）。");
  }
  if (!rawPassword && /supabase\.(com|co)$/i.test(host)) problems.push("DATABASE_URL にパスワードが入っていません。");
  if (/\s/.test(s)) problems.push("DATABASE_URL の途中に空白や改行が入っています。");
  if (problems.length) return { ok: false, problems };

  // パスワードに @ # / ? などの記号があると URL として読み間違えるため、自動で安全な形（%エンコード）にする
  let password: string;
  try {
    password = encodeURIComponent(decodeURIComponent(rawPassword));
  } catch {
    password = encodeURIComponent(rawPassword);
  }
  const port = portStr ? Number(portStr) : 5432;
  const lowerHost = host.toLowerCase();
  const kind: DatabaseUrlInfo["kind"] =
    lowerHost === "localhost" || lowerHost === "127.0.0.1"
      ? "local"
      : lowerHost.endsWith(".pooler.supabase.com")
        ? port === 6543
          ? "supabase-transaction-pooler"
          : "supabase-session-pooler"
        : /^db\.[a-z0-9]+\.supabase\.co$/.test(lowerHost)
          ? "supabase-direct"
          : "other";

  const warnings: string[] = [];
  if (kind === "supabase-direct") {
    warnings.push(
      "Supabase の「Direct connection」の接続先になっています。Vercel からは接続できないことがあるため、「Transaction pooler」（ポート 6543）の接続文字列を使ってください。",
    );
  }
  if (kind === "supabase-session-pooler") {
    warnings.push("Supabase の「Session pooler」になっています。Vercel では「Transaction pooler」（ポート 6543）がおすすめです。");
  }
  if (lowerHost.endsWith(".pooler.supabase.com") && !user.includes(".")) {
    warnings.push(
      "Supabase の pooler では、ユーザー名が「postgres.（プロジェクトID）」の形になります。Connect 画面の文字をそのままコピーしたか確認してください。",
    );
  }

  const auth = rawPassword ? `${user}:${password}` : user;
  const url = `postgresql://${auth}@${host}:${port}/${database || "postgres"}${query ?? ""}`;
  return { ok: true, url, info: { host, port, user, database: database || "postgres", kind }, warnings };
}
