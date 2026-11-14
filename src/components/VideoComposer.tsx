"use client";

import { useEffect, useRef, useState } from "react";
import { showToast } from "@/components/Toaster";

// AIが作った「場面の絵」と「ナレーションの声」と「テロップ」を、この端末（iPhone）の中で1本の縦長動画につなげます。
// 動画づくりはすべて端末の中で行い、どこにも送信しません。書き出した動画は「保存」で写真アプリなどに保存できます。

export type ComposerScene = { no: number; caption: string; narration: string; imageUrl: string };

const W = 720;
const H = 1280;
const FPS = 30;
const MIN_SCENE = 1.2;
const TAIL = 0.6;
const FADE = 0.35;

type Loaded = { images: HTMLImageElement[]; audio: AudioBuffer | null; durations: number[]; total: number };

function pickMime(): string {
  const candidates = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("絵を読み込めませんでした"));
    img.src = url;
  });
}

/** 場面ごとの長さ：声の長さを、ナレーションの文字数の割合で分ける（声がなければ1場面3秒） */
export function sceneDurations(narrations: string[], audioSeconds: number | null): number[] {
  if (!audioSeconds) return narrations.map(() => 3);
  const weights = narrations.map((n) => Math.max(8, n.trim().length));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.max(MIN_SCENE, (audioSeconds * w) / sum));
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else line += ch;
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines;
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, zoom: number, alpha: number) {
  const iw = img.naturalWidth || W;
  const ih = img.naturalHeight || H;
  const scale = Math.max(W / iw, H / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

function drawFrame(ctx: CanvasRenderingContext2D, t: number, loaded: Loaded, scenes: ComposerScene[]) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  let start = 0;
  let idx = scenes.length - 1;
  for (let i = 0; i < loaded.durations.length; i++) {
    if (t < start + loaded.durations[i] || i === loaded.durations.length - 1) {
      idx = i;
      break;
    }
    start += loaded.durations[i];
  }
  const d = loaded.durations[idx];
  const p = Math.min(1, Math.max(0, (t - start) / d));
  // 前の場面からふわっと切り替える
  if (idx > 0 && t - start < FADE) {
    drawCover(ctx, loaded.images[idx - 1], 1.08, 1);
    drawCover(ctx, loaded.images[idx], 1 + 0.08 * p, (t - start) / FADE);
  } else {
    drawCover(ctx, loaded.images[idx], 1 + 0.08 * p, 1);
  }
  // テロップ
  const caption = scenes[idx].caption.trim();
  if (caption) {
    ctx.font = "bold 52px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
    const lines = wrapLines(ctx, caption, W - 120, 2);
    const boxH = lines.length * 70 + 44;
    const y = H - 230 - boxH;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(40, y, W - 80, boxH, 28);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + 22 + 35 + i * 70));
  }
}

export function VideoComposer({ title, scenes, audioUrl }: { title: string; scenes: ComposerScene[]; audioUrl: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "playing" | "recording" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState<{ url: string; blob: Blob; ext: string } | null>(null);
  const [error, setError] = useState("");
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => () => {
    if (video) URL.revokeObjectURL(video.url);
  }, [video]);

  async function load(): Promise<Loaded> {
    if (loadedRef.current) return loadedRef.current;
    setState("loading");
    const images = await Promise.all(scenes.map((s) => loadImage(s.imageUrl)));
    let audio: AudioBuffer | null = null;
    if (audioUrl) {
      const buf = await (await fetch(audioUrl)).arrayBuffer();
      const ac = new AudioContext();
      audio = await ac.decodeAudioData(buf);
      await ac.close();
    }
    const durations = sceneDurations(scenes.map((s) => s.narration), audio ? audio.duration : null);
    const total = Math.max(durations.reduce((a, b) => a + b, 0), audio ? audio.duration : 0) + TAIL;
    loadedRef.current = { images, audio, durations, total };
    const ctx = canvasRef.current!.getContext("2d")!;
    drawFrame(ctx, 0, loadedRef.current, scenes);
    setState("ready");
    return loadedRef.current;
  }

  async function run(record: boolean) {
    setError("");
    try {
      const loaded = await load();
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const ac = new AudioContext();
      await ac.resume();
      const dest = ac.createMediaStreamDestination();
      let source: AudioBufferSourceNode | null = null;
      if (loaded.audio) {
        source = ac.createBufferSource();
        source.buffer = loaded.audio;
        source.connect(dest);
        if (!record) source.connect(ac.destination);
      }
      let recorder: MediaRecorder | null = null;
      const chunks: Blob[] = [];
      const mime = pickMime();
      if (record) {
        if (!mime || typeof canvas.captureStream !== "function") throw new Error("この端末のブラウザでは動画を書き出せません（iPhoneは最新のiOSのSafariでお試しください）");
        const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
        recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        recorder.start(500);
      }
      let lock: { release: () => Promise<void> } | null = null;
      try {
        lock = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        lock = null;
      }
      setState(record ? "recording" : "playing");
      const t0 = ac.currentTime + 0.05;
      source?.start(t0);
      let raf = 0;
      let stopped = false;
      const finish = async () => {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(raf);
        try {
          source?.stop();
        } catch {
          /* もう止まっている */
        }
        await lock?.release().catch(() => {});
        if (recorder && recorder.state !== "inactive") {
          await new Promise<void>((r) => {
            recorder!.onstop = () => r();
            recorder!.stop();
          });
          const type = mime.split(";")[0];
          const blob = new Blob(chunks, { type });
          setVideo({ url: URL.createObjectURL(blob), blob, ext: type.includes("mp4") ? "mp4" : "webm" });
          setState("done");
          showToast("動画を書き出しました");
        } else {
          setState(loadedRef.current ? "ready" : "idle");
        }
        await ac.close().catch(() => {});
        stopRef.current = null;
      };
      stopRef.current = () => void finish();
      const tick = () => {
        const t = Math.max(0, ac.currentTime - t0);
        drawFrame(ctx, t, loaded, scenes);
        setProgress(Math.min(1, t / loaded.total));
        if (t >= loaded.total) void finish();
        else raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error ? e.message : "動画を作れませんでした");
      setState("error");
    }
  }

  async function save() {
    if (!video) return;
    const name = `${title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "video"}.${video.ext}`;
    const file = new File([video.blob], name, { type: video.blob.type });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return;
      } catch {
        /* キャンセルされたときは、下のダウンロードにしない */
        return;
      }
    }
    const a = document.createElement("a");
    a.href = video.url;
    a.download = name;
    a.click();
  }

  const busy = state === "loading" || state === "playing" || state === "recording";
  return (
    <div className="space-y-3">
      <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-[20px] bg-black shadow-card">
        <canvas ref={canvasRef} width={W} height={H} className="block h-auto w-full" aria-label="動画のプレビュー" />
      </div>
      {(state === "playing" || state === "recording") && (
        <div className="mx-auto max-w-[280px]">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-brand" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-center text-[12px] text-muted" role="status">
            {state === "recording" ? "動画を書き出しています…（画面を閉じずにお待ちください）" : "再生中"}
          </p>
        </div>
      )}
      {error && <p className="text-center text-[13px] text-danger">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(false)}>
          再生してみる
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => run(true)}>
          動画を書き出す
        </button>
      </div>
      {busy && (
        <button type="button" className="btn-secondary w-full" onClick={() => stopRef.current?.()}>
          止める
        </button>
      )}
      {video && (
        <div className="space-y-2 rounded-[16px] bg-surface-2/70 p-3">
          <p className="text-[13px] font-semibold">できた動画</p>
          <video src={video.url} controls playsInline className="mx-auto block max-h-[420px] rounded-[12px]" aria-label="できた動画" />
          <button type="button" className="btn-primary w-full" onClick={save}>
            保存する（写真アプリなど）
          </button>
        </div>
      )}
    </div>
  );
}
