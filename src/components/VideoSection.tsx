import { getDb } from "@/lib/db";
import { getWorkflow } from "@/lib/workflow/repo";
import { listMediaAssets } from "@/lib/media/repo";
import { mediaReady, mediaStateOf } from "@/lib/media/produce";
import { VideoComposer, type ComposerScene } from "@/components/VideoComposer";
import { RemakeMediaButton } from "@/components/RemakeMediaButton";

/**
 * 動画の業務：AIが作った場面の絵・ナレーションの声・テロップから、その場で動画ファイルを作って保存する欄。
 * 承認の画面・成果物の画面の両方に出す（承認してもしなくても、いつでも動画を書き出せる）。
 */
export async function VideoSection({ taskId, version, title }: { taskId: string; version: number; title: string }) {
  const sql = await getDb();
  const wf = await getWorkflow(sql, taskId);
  const media = mediaStateOf(wf);
  const sameVersion = media && media.version === version;
  const assets = sameVersion ? await listMediaAssets(sql, taskId, version) : [];
  const imageOf = (no: number) => assets.find((a) => a.kind === "image" && a.scene_no === no);
  const audio = assets.find((a) => a.kind === "audio") ?? null;
  const ready = mediaReady(media, version);
  const working = wf?.phase === "media" && !ready;
  const scenes: ComposerScene[] | null =
    ready && media
      ? media.scenes.map((s) => ({ no: s.no, caption: s.caption, narration: s.narration, imageUrl: imageOf(s.no) ? `/api/media/${imageOf(s.no)!.id}` : null }))
      : null;
  const missing = sameVersion && media ? media.scenes.filter((s) => !imageOf(s.no)).length + (audio ? 0 : 1) : 0;

  return (
    <div className="card p-4">
      {scenes ? (
        <>
          <VideoComposer title={title} scenes={scenes} audioUrl={audio ? `/api/media/${audio.id}` : null} />
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            「動画を書き出す」を押すと、この端末の中で、場面の絵・ナレーションの声・テロップが1本の縦長の動画ファイル（mp4など）になります。できたら「保存する」で写真アプリなどに保存してください（どこにも送信しません）。書き出しには、動画と同じくらいの時間がかかります。
          </p>
          {(media?.imageError || media?.voiceError) && (
            <p className="mt-2 rounded-[12px] bg-accent-soft px-3 py-2 text-[12px] leading-relaxed text-accent">
              {media.imageError ? `絵を作れなかった場面は、文字のスライドになっています（${media.imageError}）。` : ""}
              {media.voiceError ? `声を作れなかったので、声なしの動画になります（${media.voiceError}）。` : ""}
            </p>
          )}
          {missing > 0 && <RemakeMediaButton taskId={taskId} />}
          {assets.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer py-3 text-[14px] font-semibold text-brand">材料を1つずつ保存する</summary>
              <ul className="mt-1 grid grid-cols-2 gap-2">
                {media!.scenes.map((s) =>
                  imageOf(s.no) ? (
                    <li key={s.no}>
                      <a className="btn-secondary block truncate px-2 text-[13px]" href={`/api/media/${imageOf(s.no)!.id}?download=1`}>
                        場面{s.no}の絵
                      </a>
                    </li>
                  ) : null,
                )}
                {audio && (
                  <li>
                    <a className="btn-secondary block truncate px-2 text-[13px]" href={`/api/media/${audio.id}?download=1`}>
                      ナレーションの声
                    </a>
                  </li>
                )}
              </ul>
            </details>
          )}
        </>
      ) : working ? (
        <p className="text-[14px] text-muted">
          チームが場面の絵とナレーションの声を作っています（{media?.images.length ?? 0}/{media?.scenes.length || "?"}枚）。できたら、ここで動画を再生・保存できます。
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[14px] text-muted">
            {media?.skipped ? `この版の絵と声は、まだありません（${media.skipped}）。` : "この版の絵と声は、まだありません。"}
          </p>
          <RemakeMediaButton taskId={taskId} label="絵と声を作って動画にする" />
        </div>
      )}
    </div>
  );
}
