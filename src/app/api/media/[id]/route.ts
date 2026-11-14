import { getDb } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth/dal";
import { getMediaAssetData } from "@/lib/media/repo";

export const dynamic = "force-dynamic";

/** AIが作った動画の材料（絵・声）を返す。ログインした経営者だけが見られます。 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return new Response("ログインが必要です", { status: 401 });
  const { id } = await params;
  const sql = await getDb();
  const asset = await getMediaAssetData(sql, id);
  if (!asset) return new Response("見つかりません", { status: 404 });
  const ext = asset.mime === "image/jpeg" ? "jpg" : asset.mime === "image/svg+xml" ? "svg" : asset.mime === "audio/mpeg" ? "mp3" : asset.mime === "audio/wav" ? "wav" : "bin";
  const name = asset.kind === "image" ? `scene-${asset.scene_no}.${ext}` : `narration.${ext}`;
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mime,
      "Content-Length": String(asset.data.length),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      // SVG（テスト用の絵）の中のスクリプトなどを動かさない
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
    },
  });
}
