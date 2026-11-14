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
  "accept_deliverable",
  "other",
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];
/** AI社員が承認を求められる「外部への操作」（成果物の最終確認は除く） */
export const EXTERNAL_ACTION_TYPES = APPROVAL_ACTION_TYPES.filter((t) => t !== "accept_deliverable") as [
  Exclude<ApprovalActionType, "accept_deliverable">,
  ...Exclude<ApprovalActionType, "accept_deliverable">[],
];
/**
 * 経営者が自分で行う操作。アプリは自動で実行せず、承認後に「コピー」「メールアプリで開く」を出すだけ。
 * （経営者の方針：外部とのメールのやり取りは、必要なら自分で行う）
 */
export const OWNER_SENDS_ACTION_TYPES: ApprovalActionType[] = ["send_message"];
export const OWNER_SENDS_AFTER_EFFECT =
  "承認しても、アプリが自動で送ることはありません。承認後に表示される「コピー」または「メールアプリで開く」を使って、経営者がご自身で送ります。";

export const APPROVAL_ACTION_LABEL: Record<ApprovalActionType, string> = {
  send_message: "メール・メッセージ（あなたが送る）",
  sns_post: "SNSへの投稿",
  publish_web: "Webサイトへの公開",
  purchase: "商品の購入",
  subscribe: "有料サービスへの登録",
  contract: "契約・申し込み",
  share_file: "外部へのファイル共有",
  modify_external: "外部データの変更・削除",
  send_personal_info: "個人情報の送信",
  accept_deliverable: "成果物の最終確認（完了の承認）",
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

/** 画面に表示するモデルの名前（例：「GPT-5 mini」） */
export function modelName(id: string): string {
  const names: Record<string, string> = { "gpt-5-nano": "GPT-5 nano", "gpt-5-mini": "GPT-5 mini", "gpt-5": "GPT-5" };
  return names[id] ?? id;
}

export const DEFAULT_MODEL_STANDARD = "gpt-5-mini";
export const DEFAULT_MODEL_ADVANCED = "gpt-5";

export const AUTORUN_OPTIONS = [
  { id: "off", label: "停止（初期設定）" },
  { id: "weekly", label: "週1回" },
  { id: "daily", label: "1日1回" },
] as const;

// ===== Phase 2: チームでの自動進行 =====

export const WORKFLOW_PHASES = [
  "kickoff",
  "discussion",
  "drafting",
  "review",
  "rework",
  "final_report",
  "waiting_human",
  "done",
  "stopped",
] as const;
export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];

export const WORKFLOW_PHASE_LABEL: Record<WorkflowPhase, string> = {
  kickoff: "チーム編成・計画",
  discussion: "チームで議論",
  drafting: "成果物を作成",
  review: "監査・品質確認",
  rework: "修正対応",
  final_report: "社長が報告書を作成",
  waiting_human: "経営者の確認待ち",
  done: "完了",
  stopped: "停止中",
};

/** 自動で進める段階（AIが動く段階） */
export const ACTIVE_WORKFLOW_PHASES: WorkflowPhase[] = ["kickoff", "discussion", "drafting", "review", "rework", "final_report"];

/** 進行状況の表示に使う段階の並び */
export const WORKFLOW_STEPS: { key: WorkflowPhase; label: string }[] = [
  { key: "kickoff", label: "計画" },
  { key: "discussion", label: "議論" },
  { key: "drafting", label: "作成" },
  { key: "review", label: "監査" },
  { key: "final_report", label: "報告" },
  { key: "waiting_human", label: "承認" },
];

export const MEMBER_ROLE_LABEL: Record<string, string> = {
  lead: "リーダー",
  member: "メンバー",
  reviewer: "監査",
  ceo: "社長",
};

export const DELIVERABLE_FORMATS = [
  { id: "markdown_report", label: "レポート（文書）", ext: "md", mime: "text/markdown" },
  { id: "plain_text", label: "テキスト", ext: "txt", mime: "text/plain" },
  { id: "email_draft", label: "メール文面（下書き）", ext: "txt", mime: "text/plain" },
  { id: "sns_post", label: "SNS投稿案", ext: "txt", mime: "text/plain" },
  { id: "csv_table", label: "表（CSV）", ext: "csv", mime: "text/csv" },
  { id: "checklist", label: "チェックリスト", ext: "md", mime: "text/markdown" },
  { id: "slide_outline", label: "スライド構成案", ext: "md", mime: "text/markdown" },
] as const;
export type DeliverableFormat = (typeof DELIVERABLE_FORMATS)[number]["id"];
export const DELIVERABLE_FORMAT_IDS = DELIVERABLE_FORMATS.map((f) => f.id) as [DeliverableFormat, ...DeliverableFormat[]];

export const DELIVERABLE_STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  in_review: "監査中",
  revise: "修正依頼",
  passed: "監査合格",
  accepted: "経営者が承認",
  rejected: "差し戻し",
};

export const ROOM_MESSAGE_KIND_LABEL: Record<string, string> = {
  plan: "計画",
  opinion: "意見",
  proposal: "提案",
  question: "質問",
  question_to_owner: "経営者への質問",
  findings: "調査メモ",
  deliverable: "成果物",
  review: "監査",
  decision: "決定",
  report: "報告",
  instruction: "指示",
  message: "発言",
  system: "お知らせ",
};

// ===== Phase 3: 自主的な仕事・事業候補・自動報告 =====

export const BUSINESS_STATUSES = ["idea", "validating", "promising", "adopted", "rejected", "on_hold"] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];
export const BUSINESS_STATUS_LABEL: Record<BusinessStatus, string> = {
  idea: "アイデア",
  validating: "調査中",
  promising: "有望",
  adopted: "採用",
  rejected: "見送り",
  on_hold: "保留",
};
/** 経営者が選べる状態（「調査中」はチームで調べ始めたときに自動で付く） */
export const OWNER_BUSINESS_STATUSES: BusinessStatus[] = ["idea", "promising", "adopted", "on_hold", "rejected"];

export const REPORT_TYPE_LABEL: Record<string, string> = {
  daily: "日報",
  weekly: "週報",
  monthly: "月報",
  bizdev: "事業開発",
  employee: "社員",
  task: "業務の完了報告",
};

/** 自動で仕事を探したとき、同時に進める「AIが見つけた業務」の上限（費用を抑えるため） */
export const MAX_ACTIVE_DISCOVERED_TASKS = 2;
export const BUSINESS_STATUS_TONE: Record<BusinessStatus, string> = {
  idea: "bg-info-soft text-brand",
  validating: "bg-accent-soft text-accent",
  promising: "bg-success-soft text-success",
  adopted: "bg-success text-white",
  rejected: "bg-surface-3 text-muted",
  on_hold: "bg-surface-3 text-muted",
};
