import { getDb } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth/dal";
import { employeeLiveStates } from "@/lib/repo/employee-live";

export const dynamic = "force-dynamic";

/** 社員のいまの状態（待機中・考え中・作業中）。画面が数秒ごとに読みにくる。ログインした経営者だけが見られます。 */
export async function GET() {
  if (!(await isAuthenticated())) return Response.json({ error: "ログインが必要です" }, { status: 401 });
  const sql = await getDb();
  return Response.json(
    { employees: await employeeLiveStates(sql), at: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
