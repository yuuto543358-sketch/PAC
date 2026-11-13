import Link from "next/link";
import type { ReactNode } from "react";
import {
  APPROVAL_STATUS_LABEL,
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type ApprovalStatus,
  type Priority,
  type TaskStatus,
} from "@/lib/constants";

export function PageHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: ReactNode;
}) {
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-2xl items-center gap-2 px-4">
        {back && (
          <Link href={back} className="-ml-2 flex h-11 w-11 items-center justify-center text-brand" aria-label="戻る">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-[19px] font-bold">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-2xl space-y-5 px-4 pt-4 pb-28">{children}</main>;
}

export function Section({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      {(title || action) && (
        <div className="flex items-end justify-between">
          {title && <h2 className="section-title">{title}</h2>}
          {action && <div className="mb-2 text-sm">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const TASK_TONE: Record<TaskStatus, string> = {
  discovered: "bg-info-soft text-brand",
  researching: "bg-info-soft text-brand",
  analyzing: "bg-info-soft text-brand",
  producing: "bg-info-soft text-brand",
  ready: "bg-success-soft text-success",
  awaiting_approval: "bg-accent-soft text-accent",
  approved: "bg-success-soft text-success",
  executing: "bg-info-soft text-brand",
  completed: "bg-success-soft text-success",
  rejected: "bg-surface-2 text-muted",
  on_hold: "bg-surface-2 text-muted",
  failed: "bg-danger-soft text-danger",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TASK_TONE[status]}`}>
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

const APPROVAL_TONE: Record<ApprovalStatus, string> = {
  pending: "bg-accent text-white",
  on_hold: "bg-accent-soft text-accent",
  approved: "bg-success-soft text-success",
  rejected: "bg-surface-2 text-muted",
  superseded: "bg-surface-2 text-muted",
  executing: "bg-info-soft text-brand",
  executed: "bg-success-soft text-success",
  execution_failed: "bg-danger-soft text-danger",
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${APPROVAL_TONE[status]}`}>
      {APPROVAL_STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const tone = priority === "high" ? "text-danger border-danger/40" : priority === "medium" ? "text-ink border-line" : "text-muted border-line";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      優先度 {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: string; sub?: string; href?: string; tone?: "accent" | "danger" }) {
  const body = (
    <div className="card h-full p-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-[22px] leading-tight font-bold ${tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : ""}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block active:opacity-70">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

/** 未実装の機能であることをはっきり示す表示 */
export function PhaseNotice({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface-2 px-4 py-3 text-sm text-muted">
      <span className="mr-2 inline-flex rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-ink">{phase}で実装予定</span>
      {children}
    </div>
  );
}

export function Alert({ tone, children }: { tone: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "bg-danger-soft text-danger"
      : tone === "warn"
        ? "bg-accent-soft text-accent"
        : tone === "success"
          ? "bg-success-soft text-success"
          : "bg-info-soft text-brand";
  return <div className={`rounded-xl px-3.5 py-2.5 text-sm font-medium ${cls}`}>{children}</div>;
}

export function ChevronRight() {
  return (
    <svg className="shrink-0 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function Meter({ value, max, marks }: { value: number; max: number; marks?: { at: number; label: string }[] }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone = pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-accent" : "bg-brand";
  return (
    <div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        {marks?.map((m) => (
          <span key={m.label} className="absolute top-0 h-full w-0.5 bg-ink/40" style={{ left: `${Math.min(100, (m.at / max) * 100)}%` }} title={m.label} />
        ))}
      </div>
    </div>
  );
}
