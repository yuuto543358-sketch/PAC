import "server-only";
import type { Db } from "@/lib/db";

// AIが作った動画の材料（絵・声）の保存と読み出し。

export type MediaAssetInfo = {
  id: string;
  kind: "image" | "audio";
  scene_no: number;
  mime: string;
  bytes: number;
  created_at: Date;
};

export async function saveMediaAsset(
  db: Db,
  a: { taskId: string; version: number; kind: "image" | "audio"; sceneNo: number; mime: string; data: Buffer; prompt: string; usageId: string | null },
) {
  await db`
    insert into media_assets (task_id, deliverable_version, kind, scene_no, mime, data, bytes, prompt, api_usage_id)
    values (${a.taskId}, ${a.version}, ${a.kind}, ${a.sceneNo}, ${a.mime}, ${a.data}, ${a.data.length},
      ${a.prompt.slice(0, 2000)}, ${a.usageId})
    on conflict (task_id, deliverable_version, kind, scene_no) do nothing`;
}

export async function listMediaAssets(db: Db, taskId: string, version: number): Promise<MediaAssetInfo[]> {
  return db<MediaAssetInfo[]>`
    select id, kind, scene_no, mime, bytes, created_at from media_assets
    where task_id = ${taskId} and deliverable_version = ${version}
    order by kind, scene_no`;
}

export async function getMediaAssetData(db: Db, id: string): Promise<{ mime: string; data: Buffer; kind: string; scene_no: number } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db<{ mime: string; data: Buffer; kind: string; scene_no: number }[]>`
    select mime, data, kind, scene_no from media_assets where id = ${id}`;
  return row ?? null;
}
