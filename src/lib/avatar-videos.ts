// 社員アイコンの「状態ごとの動画」。社員ごとのデータ（employees.avatar_videos）として持ち、社員ごとに差し替えられる。
// 例：{ "idle": "/avatars/student2/idle.mp4", "working": "/avatars/student2/working.mp4", "thinking": "/avatars/student2/thinking.mp4" }
// 動画がない状態・読み込めない環境では、これまでの静止画（イラスト）のアイコンを使う。

export const EMPLOYEE_STATUSES = ["idle", "working", "thinking", "offline"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** 動画を割り当てられる状態（offline は静止画のまま） */
export const VIDEO_STATES = ["idle", "working", "thinking"] as const;
export type VideoState = (typeof VIDEO_STATES)[number];
export type AvatarVideos = Partial<Record<VideoState, string>>;

export const STATUS_LABEL: Record<EmployeeStatus, string> = {
  idle: "待機中",
  working: "作業中",
  thinking: "考え中",
  offline: "オフライン",
};

/** 動画の場所として使ってよいか（このアプリの中にある .mp4 / .webm だけ。外部のURLは使わない） */
export function isSafeVideoPath(p: unknown): p is string {
  return typeof p === "string" && /^\/[A-Za-z0-9_\-./]+\.(mp4|webm)$/.test(p) && !p.includes("..") && !p.startsWith("//") && p.length <= 200;
}

/** データベースの値を、安全な形に整える（おかしな値は捨てる） */
export function parseAvatarVideos(v: unknown): AvatarVideos {
  const out: AvatarVideos = {};
  if (!v || typeof v !== "object") return out;
  for (const s of VIDEO_STATES) {
    const p = (v as Record<string, unknown>)[s];
    if (isSafeVideoPath(p)) out[s] = p;
  }
  return out;
}

/** その状態で流す動画（なければ null ＝ 静止画のアイコン） */
export function videoForStatus(videos: AvatarVideos | null | undefined, status: EmployeeStatus | null | undefined): string | null {
  if (!videos || !status || status === "offline") return null;
  return videos[status] ?? null;
}
