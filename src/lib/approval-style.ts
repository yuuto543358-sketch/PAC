import type { ApprovalActionType } from "@/lib/constants";
import type { IconName } from "@/components/Icon";

/** 承認の種類ごとのアイコンと色 */
export const APPROVAL_ACTION_STYLE: Record<ApprovalActionType, { icon: IconName; color: string }> = {
  send_message: { icon: "send", color: "#2563eb" },
  sns_post: { icon: "chat", color: "#0891b2" },
  publish_web: { icon: "document", color: "#7c3aed" },
  purchase: { icon: "wallet", color: "#c2410c" },
  subscribe: { icon: "clock", color: "#b45309" },
  contract: { icon: "edit", color: "#be123c" },
  share_file: { icon: "document", color: "#0f766e" },
  modify_external: { icon: "settings", color: "#475569" },
  send_personal_info: { icon: "lock", color: "#dc2626" },
  other: { icon: "alert", color: "#64748b" },
};
