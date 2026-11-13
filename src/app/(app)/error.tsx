"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-5 py-16 text-center">
      <h1 className="text-lg font-bold">表示中にエラーが発生しました</h1>
      <p className="mt-2 text-sm text-muted">
        データベースに接続できない、または一時的な問題の可能性があります。少し待ってから再読み込みしてください。
      </p>
      {error.digest && <p className="mt-2 text-xs text-muted">エラー番号: {error.digest}</p>}
      <button onClick={reset} className="btn-primary mt-6">
        もう一度試す
      </button>
    </main>
  );
}
