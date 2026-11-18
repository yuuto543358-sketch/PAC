// 社員の「いまの状態」（待機中・考え中・作業中）を、画面が数秒ごとに読みにいくためのデータのテスト
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { employeeLiveStates } from "@/lib/repo/employee-live";
import { startJob, finishJob } from "@/lib/mediaco/jobs";

beforeAll(async () => {
  await closeDb();
});
afterAll(async () => {
  const sql = await getDb();
  await sql`update employees set status = 'idle'`;
  await closeDb();
});

describe("社員のいまの状態", () => {
  it("7人分の状態と、担当の数・いまの仕事を返す", async () => {
    const sql = await getDb();
    await sql`update employees set status = 'idle'`;
    const before = await employeeLiveStates(sql);
    expect(before).toHaveLength(7);
    expect(before.every((e) => e.status === "idle" && typeof e.activeTasks === "number")).toBe(true);

    // 市場調査部が仕事を始めると「考え中」になり、いまの仕事が分かる
    const job = await startJob(sql, { kind: "research.screen", dept: "research", dedupeKey: `live-test:${Date.now()}` });
    expect(job).not.toBeNull();
    const during = (await employeeLiveStates(sql)).find((e) => e.id === "research")!;
    expect(during.status).toBe("thinking");
    expect(during.running).toBeTruthy();
    expect(during.activity).toBe(during.running);

    // 終わると待機中に戻り、「最後：〇〇」になる
    await finishJob(sql, job!, { status: "done", summary: "テスト" });
    const after = (await employeeLiveStates(sql)).find((e) => e.id === "research")!;
    expect(after.status).toBe("idle");
    expect(after.running).toBeNull();
    expect(after.activity).toMatch(/^最後：/);
  });
});
