import type { EmployeeStatus } from "@/lib/avatar-videos";

// 社員の状態（アイコンの動画の切り替えに使う）を、いまやっている仕事の種類から決める。
// - 考え中（thinking）：調べる・考える・判断する仕事（市場調査・企画・品質検査・分析・会議・話し合い・監査・会話の返事）
// - 作業中（working）：形にする仕事（執筆・修正・投稿案・ブランド設計・情報源の調査・動画の材料）
// - 待機中（idle）：仕事をしていない

const THINKING_KINDS = new Set([
  // メディア事業
  "research.screen",
  "research.deep",
  "research.select",
  "research.weekly",
  "article.plan",
  "article.check",
  "analysis.weekly",
  "ceo.monthly",
  // チームの仕事の段階
  "team.kickoff",
  "team.discussion",
  "team.review",
  // そのほか
  "chat.reply",
]);

export function activityStatusFor(kind: string): Exclude<EmployeeStatus, "idle" | "offline"> {
  return THINKING_KINDS.has(kind) ? "thinking" : "working";
}
