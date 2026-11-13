import { redirect } from "next/navigation";
import { checkRequiredEnv } from "@/lib/env";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "ログイン | PERSONAL AI COMPANY" };

export default function LoginPage() {
  if (checkRequiredEnv().length > 0) redirect("/setup");
  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pb-16">
      <div className="mb-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" width={72} height={72} className="mx-auto mb-4 rounded-[20px] shadow-sm" />
        <h1 className="text-xl font-bold tracking-wide">PERSONAL AI COMPANY</h1>
        <p className="mt-1 text-sm text-muted">AIの力で、個人の可能性を最大化する。</p>
      </div>
      <LoginForm />
      <p className="mt-6 text-center text-xs text-muted">経営者専用の管理画面です。</p>
    </main>
  );
}
