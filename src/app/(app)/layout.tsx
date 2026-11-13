import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { checkRequiredEnv } from "@/lib/env";
import { requireAuth } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { countPendingApprovals } from "@/lib/repo/approvals";
import { isMockMode } from "@/lib/ai/client";
import { TabBar } from "@/components/TabBar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (checkRequiredEnv().length > 0) redirect("/setup");
  await requireAuth();
  const sql = await getDb();
  const pending = await countPendingApprovals(sql);
  return (
    <div className="min-h-dvh">
      {isMockMode() && (
        <div className="pt-safe bg-danger px-4 py-1.5 text-center text-xs font-bold text-white">
          テスト用モック応答モード（AI_MOCK=1）：AIの返答は本物ではありません
        </div>
      )}
      {children}
      <TabBar pendingApprovals={pending} />
    </div>
  );
}
