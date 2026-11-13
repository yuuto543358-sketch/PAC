// アプリ全体で使う定数（表示名など）。ブラウザ側からも読み込まれるため、秘密情報は置かないこと。

export const TASK_STATUSES = [
  "discovered",
  "researching",
  "analyzing",
  "producing",
  "ready",
  "awaiting_approval",
  "approved",
  "executing",
  "completed",
  "rejected",
  "on_hold",
  "failed",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  discovered: "発見",
  researching: "調査中",
  analyzing: "分析中",
  producing: "制作中",
  ready: "準備完了",
  awaiting_approval: "承認待ち",
  approved: "承認済み",
  executing: "実行中",
  completed: "完了",
  rejected: "却下",
  on_hold: "保留",
  failed: "失敗",
};

/** 稼働中（＝終わっていない）とみなす状態 */
export const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  "discovered",
  "researching",
  "analyzing",
  "producing",
  "ready",
  "awaiting_approval",
  "approved",
  "executing",
];

/** 終了済みの状態 */
export const CLOSED_TASK_STATUSES: TaskStatus[] = ["completed", "rejected", "failed"];

/**
 * 業務ステータスの変更ルール。
 * 「承認済み」「実行中」は承認システムを通さないと入れないため、手動変更の候補には含めない。
 */
export const MANUAL_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  discovered: ["researching", "analyzing", "producing", "ready", "on_hold", "rejected"],
  researching: ["analyzing", "producing", "ready", "on_hold", "failed", "rejected"],
  analyzing: ["researching", "producing", "ready", "on_hold", "failed", "rejected"],
  producing: ["researching", "analyzing", "ready", "on_hold", "failed", "rejected"],
  ready: ["producing", "completed", "on_hold", "rejected"],
  awaiting_approval: ["on_hold"],
  approved: ["completed", "on_hold", "failed"],
  executing: ["completed", "failed"],
  completed: [],
  rejected: ["discovered"],
  on_hold: ["discovered", "researching", "analyzing", "producing", "ready", "rejected"],
  failed: ["discovered"],
};

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { high: "高", medium: "中", low: "低" };

export const TASK_SOURCES = ["user", "ai_discovered", "scheduled"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];
export const TASK_SOURCE_LABEL: Record<TaskSource, string> = {
  user: "経営者からの指示",
  ai_discovered: "AI社員が発見",
  scheduled: "定期業務",
};

export const APPROVAL_ACTION_TYPES = [
  "send_message",
  "sns_post",
  "publish_web",
  "purchase",
  "subscribe",
  "contract",
  "share_file",
  "modify_external",
  "send_personal_info",
  "other",
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];
export const APPROVAL_ACTION_LABEL: Record<ApprovalActionType, string> = {
  send_message: "メール・メッセージの送信",
  sns_post: "SNSへの投稿",
  publish_web: "Webサイトへの公開",
  purchase: "商品の購入",
  subscribe: "有料サービスへの登録",
  contract: "契約・申し込み",
  share_file: "外部へのファイル共有",
  modify_external: "外部データの変更・削除",
  send_personal_info: "個人情報の送信",
  other: "その他の取り消しが難しい操作",
};

export const APPROVAL_STATUSES = [
  "pending",
  "on_hold",
  "approved",
  "rejected",
  "superseded",
  "executing",
  "executed",
  "execution_failed",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "未確認",
  on_hold: "保留中",
  approved: "承認済み",
  rejected: "却下",
  superseded: "修正版に置き換え",
  executing: "実行中",
  executed: "実行完了",
  execution_failed: "実行失敗",
};

export const EMPLOYEE_STATUS_LABEL: Record<string, string> = {
  idle: "待機中",
  working: "業務中",
  offline: "休止中",
};

/** 選べるAIモデル（料金は src/lib/pricing.ts。ここに無いモデルは使えません） */
export const MODEL_OPTIONS = [
  { id: "gpt-5-nano", label: "GPT-5 nano（最安・簡単な作業向け）" },
  { id: "gpt-5-mini", label: "GPT-5 mini（低価格・通常業務向け）" },
  { id: "gpt-5", label: "GPT-5（高性能・高価格）" },
] as const;

export const DEFAULT_MODEL_STANDARD = "gpt-5-mini";
export const DEFAULT_MODEL_ADVANCED = "gpt-5";

export const AUTORUN_OPTIONS = [
  { id: "off", label: "停止（初期設定）" },
  { id: "weekly", label: "週1回" },
  { id: "daily", label: "1日1回" },
] as const;
