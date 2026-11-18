"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 社員アイコンの動画（ループ再生）。下にある静止画のアイコンの上に重ねて表示する。
 * - 画面に見えているときだけ動画を読み込み・再生する（見えなくなったら止める）
 * - 読み込めない・再生できない・動きを減らす設定の端末では、動画を出さない（静止画のアイコンがそのまま見える）
 * - 状態が変わって動画のファイルが変わったら、新しい動画に切り替える
 */
function prefersReducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function AvatarVideo({ src, size }: { src: string; size?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // 画面に見えているかを見張る（動きを減らす設定の端末では、動画を読み込まない）
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 見えているときだけ再生し、見えなくなったら止める
  useEffect(() => {
    const el = ref.current;
    if (!el || failed) return;
    if (visible) el.play().catch(() => setFailed(true));
    else el.pause();
  }, [visible, failed]);

  if (failed) return null;
  return (
    <video
      ref={ref}
      // 見えるまでは読み込まない（src を付けない）。状態が変わると、この部品ごと作り直される（新しい動画に切り替わる）
      src={visible ? src : undefined}
      muted
      autoPlay
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      aria-hidden
      data-avatar-video={ready ? "playing" : "loading"}
      onLoadedData={() => setReady(true)}
      onPlaying={() => setReady(true)}
      onError={() => setFailed(true)}
      className="pointer-events-none absolute inset-0 rounded-full object-cover transition-opacity duration-300"
      style={{ width: size ?? "100%", height: size ?? "100%", opacity: ready ? 1 : 0 }}
    />
  );
}
