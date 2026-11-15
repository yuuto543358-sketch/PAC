import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getTask } from "@/lib/repo/tasks";
import { getDeliverable, getWorkflow, listDeliverables } from "@/lib/workflow/repo";
import { listMediaAssets } from "@/lib/media/repo";
import { VideoComposer, type ComposerScene } from "@/components/VideoComposer";
import { DELIVERABLE_FORMATS, DELIVERABLE_STATUS_LABEL } from "@/lib/constants";
import { dateTime } from "@/lib/format";
import { DocumentView } from "@/components/DocumentView";
import { Page, PageHeader, Section } from "@/components/ui";
import { NoteCopyButtons, OutputButtons, SectionCopyButtons } from "./OutputButtons";

export default async function DeliverablePage({ params }: { params: Promise<{ id: string; version: string }> }) {
  const { id, version } = await params;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) notFound();
  const sql = await getDb();
  const task = await getTask(sql, id);
  if (!task) notFound();
  const [d, all, wf] = await Promise.all([getDeliverable(sql, id, v), listDeliverables(sql, id), getWorkflow(sql, id)]);
  if (!d) notFound();
  // 動画：AIが作った場面の絵とナレーションの声
  type MediaPlan = { version: number; scenes: { no: number; caption: string; narration: string }[]; images: number[]; audio: boolean; skipped?: string };
  const media = d.format === "video_script" ? ((wf?.plan as { media?: MediaPlan } | undefined)?.media ?? null) : null;
  const assets = media && media.version === d.version ? await listMediaAssets(sql, id, d.version) : [];
  const imageOf = (no: number) => assets.find((a) => a.kind === "image" && a.scene_no === no);
  const audio = assets.find((a) => a.kind === "audio") ?? null;
  const composerScenes: ComposerScene[] | null =
    media && media.version === d.version && media.scenes.length > 0 && media.scenes.every((s) => imageOf(s.no))
      ? media.scenes.map((s) => ({ no: s.no, caption: s.caption, narration: s.narration, imageUrl: `/api/media/${imageOf(s.no)!.id}` }))
      : null;
  const mediaWorking = d.format === "video_script" && wf?.phase === "media" && !composerScenes;
  const fmt = DELIVERABLE_FORMATS.find((f) => f.id === d.format) ?? DELIVERABLE_FORMATS[0];
  const safeName = d.title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "deliverable";
  const statusTone =
    d.status === "accepted" || d.status === "passed" ? "bg-success-soft text-success" : d.status === "revise" || d.status === "rejected" ? "bg-accent-soft text-accent" : "bg-info-soft text-brand";

  return (
    <>
      <PageHeader title="成果物" back={`/tasks/${id}`} backLabel="業務" large={false} />
      <Page>
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${statusTone}`}>{DELIVERABLE_STATUS_LABEL[d.status] ?? d.status}</span>
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] text-muted">第{d.version}版</span>
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] text-muted">出力形式：{fmt.label}</span>
          </div>
          <h2 className="mt-2 text-[22px] leading-snug font-bold tracking-tight">{d.title}</h2>
          <p className="mt-1 text-[13px] text-muted">
            作成：{d.author_name ?? "—"} ・ {dateTime(d.created_at)} ・ 業務：
            <Link href={`/tasks/${id}`} className="tap inline-block text-brand">
              {task.title}
            </Link>
          </p>
          <div className="mt-4">
            <OutputButtons content={d.content} filename={`${safeName}_v${d.version}.${fmt.ext}`} mime={fmt.mime} />
            {d.format === "note_article" && (
              <div className="mt-2.5">
                <NoteCopyButtons content={d.content} />
              </div>
            )}
            {d.format === "listing_package" && (
              <div className="mt-2.5">
                <SectionCopyButtons content={d.content} />
              </div>
            )}
            {d.format === "video_script" && (
              <div className="mt-2.5">
                <SectionCopyButtons content={d.content} label="投稿するときに使う（見出しごとにコピー）" />
              </div>
            )}
          </div>
        </div>

        {d.format === "video_script" && (
          <Section title="動画">
            <div className="card p-4">
              {composerScenes ? (
                <>
                  <VideoComposer title={d.title} scenes={composerScenes} audioUrl={audio && media?.audio ? `/api/media/${audio.id}` : null} />
                  <p className="mt-3 text-[12px] leading-relaxed text-muted">
                    AIが作った場面の絵・ナレーションの声・テロップを、この端末の中で1本の縦長動画につなげます（どこにも送信しません）。
                    「動画を書き出す」は動画と同じ長さの時間がかかります。BGMを付けたいときは、保存した動画を編集アプリで開いて足してください。
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer py-3 text-[14px] font-semibold text-brand">材料を1つずつ保存する</summary>
                    <ul className="mt-2 grid grid-cols-2 gap-2">
                      {media!.scenes.map((s) => (
                        <li key={s.no}>
                          <a className="btn-secondary block truncate px-2 text-[13px]" href={`/api/media/${imageOf(s.no)!.id}?download=1`}>
                            場面{s.no}の絵
                          </a>
                        </li>
                      ))}
                      {audio && (
                        <li>
                          <a className="btn-secondary block truncate px-2 text-[13px]" href={`/api/media/${audio.id}?download=1`}>
                            ナレーションの声
                          </a>
                        </li>
                      )}
                    </ul>
                  </details>
                </>
              ) : mediaWorking ? (
                <p className="text-[14px] text-muted">チームが場面の絵とナレーションの声を作っています（{media?.images.length ?? 0}/{media?.scenes.length || "?"}枚）。できたら、ここで動画を再生・保存できます。</p>
              ) : media?.skipped ? (
                <p className="text-[14px] text-muted">絵や声を作れませんでした（{media.skipped}）。グループチャットで「もう一度、絵と声を作って」と指示すると、作り直します。</p>
              ) : (
                <p className="text-[14px] text-muted">この版の絵と声はまだありません。</p>
              )}
            </div>
          </Section>
        )}

        {d.review_note && (
          <Section title={d.status === "revise" || d.status === "rejected" ? "修正の指摘" : "監査メモ（リスク・注意点）"}>
            <div className="card p-4 text-[14px] leading-relaxed whitespace-pre-wrap">{d.review_note}</div>
          </Section>
        )}

        <Section title="本文">
          <article className="card p-5">
            <DocumentView content={d.content} format={d.format} />
          </article>
        </Section>

        {all.length > 1 && (
          <Section title="版の履歴">
            <ul className="card divide-y divide-separator">
              {all.map((x) => (
                <li key={x.version}>
                  <Link href={`/tasks/${id}/deliverables/${x.version}`} className={`flex items-center justify-between px-4 py-3 text-[15px] active:bg-surface-3 ${x.version === d.version ? "font-semibold" : ""}`}>
                    <span>
                      第{x.version}版 <span className="text-[13px] text-muted">・{x.author_name ?? "—"}・{dateTime(x.created_at)}</span>
                    </span>
                    <span className="text-[12px] text-muted">{DELIVERABLE_STATUS_LABEL[x.status] ?? x.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <p className="px-1 text-[12px] text-muted">「コピー」「ファイルで保存」はこの端末の中だけの操作です。外部への送信・公開は、承認センターでの承認が必要です。</p>
      </Page>
    </>
  );
}
