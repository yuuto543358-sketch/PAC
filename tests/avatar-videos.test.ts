// 社員アイコンの「状態ごとの動画」のテスト
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { isSafeVideoPath, parseAvatarVideos, videoForStatus } from "@/lib/avatar-videos";
import { activityStatusFor } from "@/lib/employee-status";
import { finishJob, startJob } from "@/lib/mediaco/jobs";
import { getEmployee } from "@/lib/repo/employees";

beforeAll(async () => {
  await closeDb();
});
afterAll(async () => {
  const sql = await getDb();
  await sql`update employees set status = 'idle' where id = 'creative'`;
  await closeDb();
});

describe("状態 → 動画の対応（社員ごとのデータ）", () => {
  it("アプリの中の .mp4 / .webm だけを使い、外部のURLやおかしな値は捨てる", () => {
    expect(isSafeVideoPath("/avatars/student2/idle.mp4")).toBe(true);
    expect(isSafeVideoPath("https://example.com/a.mp4")).toBe(false);
    expect(isSafeVideoPath("//evil.example.com/a.mp4")).toBe(false);
    expect(isSafeVideoPath("/avatars/../secret.mp4")).toBe(false);
    expect(isSafeVideoPath("/avatars/a.mov")).toBe(false);
    expect(parseAvatarVideos({ idle: "/a/idle.mp4", working: "javascript:alert(1)", thinking: 3, extra: "/x.mp4" })).toEqual({ idle: "/a/idle.mp4" });
    expect(parseAvatarVideos(null)).toEqual({});
  });

  it("状態に合う動画を選ぶ。動画がない状態・休止中は静止画（null）", () => {
    const v = { idle: "/i.mp4", working: "/w.mp4", thinking: "/t.mp4" };
    expect(videoForStatus(v, "idle")).toBe("/i.mp4");
    expect(videoForStatus(v, "working")).toBe("/w.mp4");
    expect(videoForStatus(v, "thinking")).toBe("/t.mp4");
    expect(videoForStatus(v, "offline")).toBeNull();
    expect(videoForStatus({ idle: "/i.mp4" }, "thinking")).toBeNull();
    expect(videoForStatus({}, "idle")).toBeNull();
    expect(videoForStatus(v, undefined)).toBeNull();
  });

  it("試作：編集制作部の春野 創太に、3つの状態の動画が割り当てられている（ほかの社員はまだ静止画）", async () => {
    const sql = await getDb();
    const e = (await getEmployee(sql, "creative"))!;
    expect(e.name).toBe("春野 創太");
    expect(parseAvatarVideos(e.avatar_videos)).toEqual({
      idle: "/avatars/student2/idle.mp4",
      working: "/avatars/student2/working.mp4",
      thinking: "/avatars/student2/thinking.mp4",
    });
    const others = await sql<{ id: string }[]>`select id from employees where id <> 'creative' and avatar_videos <> '{}'::jsonb`;
    expect(others).toEqual([]);
    // 動画のファイルが実際にある
    for (const f of ["idle", "working", "thinking"]) {
      expect(fs.existsSync(path.join(process.cwd(), "public/avatars/student2", `${f}.mp4`))).toBe(true);
    }
  });
});

describe("状態の切り替え", () => {
  it("調べる・考える仕事は「考え中」、形にする仕事は「作業中」", () => {
    expect(activityStatusFor("research.screen")).toBe("thinking");
    expect(activityStatusFor("article.check")).toBe("thinking");
    expect(activityStatusFor("team.discussion")).toBe("thinking");
    expect(activityStatusFor("team.review")).toBe("thinking");
    expect(activityStatusFor("chat.reply")).toBe("thinking");
    expect(activityStatusFor("article.write")).toBe("working");
    expect(activityStatusFor("article.revise")).toBe("working");
    expect(activityStatusFor("team.drafting")).toBe("working");
    expect(activityStatusFor("posts.create")).toBe("working");
  });

  it("仕事を始めると状態が変わり、終わると待機中に戻る（データベースの状態がアイコンの動画を決める）", async () => {
    const sql = await getDb();
    await sql`update employees set status = 'idle' where id = 'creative'`;
    const j1 = await startJob(sql, { kind: "article.write", dept: "editorial", dedupeKey: `test-avatar-${crypto.randomUUID()}` });
    expect((await getEmployee(sql, "creative"))!.status).toBe("working");
    await finishJob(sql, j1!, { status: "done" });
    expect((await getEmployee(sql, "creative"))!.status).toBe("idle");
    const j2 = await startJob(sql, { kind: "article.plan", dept: "editorial", dedupeKey: `test-avatar-${crypto.randomUUID()}` });
    expect((await getEmployee(sql, "creative"))!.status).toBe("thinking");
    await finishJob(sql, j2!, { status: "done" });
    expect((await getEmployee(sql, "creative"))!.status).toBe("idle");
  });

  it("状態「考え中」をデータベースが受け付ける", async () => {
    const sql = await getDb();
    await sql`update employees set status = 'thinking' where id = 'creative'`;
    await expect(sql`update employees set status = 'sleeping' where id = 'creative'`).rejects.toThrow();
    await sql`update employees set status = 'idle' where id = 'creative'`;
  });
});
