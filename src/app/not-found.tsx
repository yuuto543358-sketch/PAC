import Link from "next/link";

/** 存在しないアドレスを開いたときの画面（どのバージョンのアプリが応答したかも表示） */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-bold">ページが見つかりません（404）</h1>
      <p className="mt-2 text-sm text-muted">アドレスが正しいか確認してください。</p>
      <Link href="/" className="btn-primary mt-6">
        ホームへ
      </Link>
      <p className="mt-6 text-[11px] text-muted">PERSONAL AI COMPANY ・ バージョン {process.env.NEXT_PUBLIC_BUILD_COMMIT}</p>
    </main>
  );
}
