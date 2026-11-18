"use client";

import { useState } from "react";

/**
 * 社員アイコンの静止画（動画の1コマ）。下にあるイラストの上に重ねて表示する。
 * 小さいアイコンをたくさん並べる場所（チャットの発言の横・一覧など）で、動画のかわりに使う（軽い）。
 * 読み込めないときは何も出さない（イラストのまま）。
 */
export function AvatarStill({ src, size }: { src: string; size?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 小さい固定の画像なので、そのまま表示する
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      data-avatar-still={loaded ? "loaded" : "loading"}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className="pointer-events-none absolute inset-0 rounded-full object-cover"
      style={{ width: size ?? "100%", height: size ?? "100%", opacity: loaded ? 1 : 0 }}
    />
  );
}
