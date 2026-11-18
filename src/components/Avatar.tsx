import { AvatarVideo } from "./AvatarVideo";
import { AvatarStill } from "./AvatarStill";
import { parseAvatarVideos, posterFor, videoForStatus, type EmployeeStatus } from "@/lib/avatar-videos";

// 社員のアバター（イラスト）。画像ファイルを使わず、色と髪型の組み合わせで描きます。
// 社員に状態ごとの動画が設定されていれば、その状態の動画を上に重ねて流します（読み込めなければイラストのまま）。

export const AVATAR_STYLES = [
  { id: "tie", label: "短髪・ネクタイ" },
  { id: "ponytail", label: "ポニーテール" },
  { id: "glasses", label: "短髪・メガネ" },
  { id: "messy", label: "くせ毛" },
  { id: "bob", label: "ボブ" },
  { id: "elder", label: "グレーヘア・メガネ" },
] as const;

type Props = {
  color: string;
  styleId: string;
  size?: number;
  status?: EmployeeStatus;
  label?: string;
  /** 状態ごとの動画（社員ごとの設定）。その状態の動画があれば、静止画の上に重ねてループ再生する */
  videos?: unknown;
  /** true なら、まわりの枠いっぱいの大きさで表示する（グリッドで大きく見せるとき。size は使わない） */
  fluid?: boolean;
  /**
   * true なら、動画のかわりに静止画（動画の1コマ）を出す。小さいアイコンをたくさん並べる場所（チャットの発言の横・一覧など）で使う。
   * status がなくても、動画が設定されていれば静止画を出す。
   */
  still?: boolean;
};

export function Avatar({ color, styleId, size = 48, status, label, videos, fluid = false, still = false }: Props) {
  const parsed = parseAvatarVideos(videos);
  const videoSrc = still ? null : videoForStatus(parsed, status ?? "idle");
  const stillSrc = still ? posterFor(parsed) : null;
  const hair = styleId === "elder" ? "#a3a9b5" : "#2a2733";
  const skin = "#f4d2b5";
  return (
    <span
      className={`avatar-wrap relative shrink-0 ${fluid ? "block aspect-square w-full" : "inline-block"}`}
      style={fluid ? undefined : { width: size, height: size }}
    >
      <svg
        viewBox="0 0 64 64"
        width={fluid ? "100%" : size}
        height={fluid ? "100%" : size}
        className={fluid ? "block" : undefined}
        role="img"
        aria-label={label ?? "アバター"}
      >
        <circle cx="32" cy="32" r="32" fill={color} opacity="0.18" />
        {/* 後ろ髪 */}
        {styleId === "bob" && <path d="M15 30c0-12 7-19 17-19s17 7 17 19v12H15z" fill={hair} />}
        {styleId === "ponytail" && <path d="M44 20c8 2 10 12 6 20-1-6-3-10-7-12z" fill={hair} />}
        {/* 体 */}
        <path d="M10 64c1-12 10-18 22-18s21 6 22 18z" fill={color} />
        <path d="M27 46l5 7 5-7z" fill="#ffffff" opacity="0.9" />
        {styleId === "tie" && <path d="M31 50h2l1.5 9-2.5 3-2.5-3z" fill="#0f172a" />}
        {/* 首と顔 */}
        <rect x="28" y="38" width="8" height="9" rx="3" fill={skin} />
        <ellipse cx="32" cy="29" rx="12" ry="13" fill={skin} />
        {/* 前髪 */}
        {(styleId === "tie" || styleId === "glasses") && <path d="M20 26c0-9 5-13 12-13s12 4 12 13c-4-4-9-5-12-5s-8 1-12 5z" fill={hair} />}
        {styleId === "messy" && (
          <path d="M19 27c-1-10 6-15 13-15 8 0 14 5 13 15l-3-5-3 3-2-5-4 4-3-5-3 4-3-3z" fill={hair} />
        )}
        {styleId === "ponytail" && <path d="M20 27c0-10 6-14 12-14s12 4 12 14c-3-5-8-8-14-7-4 1-7 3-10 7z" fill={hair} />}
        {styleId === "bob" && <path d="M19 30c0-11 6-16 13-16s13 5 13 16c-2-6-7-9-13-9s-11 3-13 9z" fill={hair} />}
        {styleId === "elder" && <path d="M20 27c0-9 5-14 12-14s12 5 12 14c-2-4-6-7-10-7l-2 3-2-3c-4 0-8 3-10 7z" fill={hair} />}
        {/* 目・口 */}
        <circle cx="27.5" cy="30" r="1.4" fill="#2a2733" />
        <circle cx="36.5" cy="30" r="1.4" fill="#2a2733" />
        <path d="M29 35.5c1.8 1.6 4.2 1.6 6 0" stroke="#b5654a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        {(styleId === "glasses" || styleId === "elder") && (
          <g stroke="#2a2733" strokeWidth="1.2" fill="none">
            <circle cx="27.5" cy="30" r="3.6" />
            <circle cx="36.5" cy="30" r="3.6" />
            <path d="M31.1 30h1.8" />
          </g>
        )}
      </svg>
      {videoSrc && <AvatarVideo key={videoSrc} src={videoSrc} size={fluid ? undefined : size} />}
      {stillSrc && <AvatarStill key={stillSrc} src={stillSrc} size={fluid ? undefined : size} />}
      {status && (
        <span
          className={`absolute block rounded-full border-2 border-surface ${fluid ? "right-[6%] bottom-[6%] h-[16%] min-h-3 w-[16%] min-w-3" : "right-0 bottom-0"}`}
          style={{
            ...(fluid ? {} : { width: Math.max(10, size / 5), height: Math.max(10, size / 5) }),
            background: status === "working" ? "#22c55e" : status === "thinking" ? "#f59e0b" : status === "idle" ? "#94a3b8" : "#475569",
          }}
          aria-hidden
        />
      )}
    </span>
  );
}
