import { redirect } from "next/navigation";
import { checkRequiredEnv } from "@/lib/env";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "ログイン | PERSONAL AI COMPANY" };

export default function LoginPage() {
  if (checkRequiredEnv().length > 0) redirect("/setup");
  return (
    <div className="relative min-h-dvh overflow-hidden bg-gradient-to-b from-brand-deep via-[#1d3a99] to-[#3157d0]">
      <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute top-40 -left-24 h-64 w-64 rounded-full bg-sky-300/10 blur-3xl" aria-hidden />
      <main className="pt-safe relative mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pb-16">
        <div className="mb-8 text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" width={84} height={84} className="mx-auto mb-5 rounded-[22px] shadow-pop ring-1 ring-white/20" />
          <h1 className="text-[22px] font-bold tracking-wide">PERSONAL AI COMPANY</h1>
          <p className="mt-1.5 text-[14px] text-white/75">AIの力で、個人の可能性を最大化する。</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-[12px] text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.25)]">経営者専用の管理画面です。</p>
        <p className="mt-1 text-center text-[11px] text-white/65 [text-shadow:0_1px_2px_rgba(0,0,0,0.25)]">バージョン {process.env.NEXT_PUBLIC_BUILD_COMMIT}</p>
      </main>
    </div>
  );
}
