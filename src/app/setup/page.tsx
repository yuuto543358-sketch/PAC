import { redirect } from "next/navigation";
import { checkRequiredEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "初期設定 | PERSONAL AI COMPANY" };

/** 必須の設定が足りないときに表示する案内画面（設定値そのものは表示しません） */
export default function SetupPage() {
  const issues = checkRequiredEnv();
  if (issues.length === 0) redirect("/login");
  return (
    <main className="pt-safe mx-auto max-w-lg px-5 py-10">
      <h1 className="text-xl font-bold">初期設定が必要です</h1>
      <p className="mt-2 text-sm text-muted">
        アプリを動かすための設定（環境変数）が足りません。Vercel の「Settings → Environment Variables」で、次の項目を追加してから再デプロイしてください。
        くわしい手順は README の「セットアップ方法」にあります。
      </p>
      <ul className="mt-5 space-y-2">
        {issues.map((i) => (
          <li key={i.key + i.message} className="card p-3.5">
            <code className="text-sm font-bold">{i.key}</code>
            <p className="mt-1 text-sm text-muted">{i.message}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
