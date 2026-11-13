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
import { Icon, type IconName } from "./Icon";

export { PageHeader } from "./PageHeader";

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-2xl space-y-6 px-4 pt-3 pb-32 ${className}`}>{children}</main>;
}

export function Section({ title, children, action, footer }: { title?: string; children: ReactNode; action?: ReactNode; footer?: ReactNode }) {
  return (
    <section>
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between px-1">
          {title && <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>}
          {action && <div className="text-[15px]">{action}</div>}
        </div>
      )}
      {children}
      {footer && <p className="mt-2 px-1 text-xs leading-relaxed text-muted">{footer}</p>}
    </section>
  );
}

/** iPhone の設定画面のような、角丸の「まとまったリスト」 */
export function List({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={`card divide-y divide-separator overflow-hidden ${className}`}>{children}</ul>;
}

/** 色付きの四角いアイコン（リストの先頭などに使う） */
export function IconTile({ name, color, size = 30 }: { name: IconName; color: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[9px] text-white"
      style={{ width: size, height: size, background: color }}
      aria-hidden
    >
      <Icon name={name} size={Math.round(size * 0.62)} stroke={2} />
    </span>
  );
}

/** リストの1行。href があればタップで移動します。 */
export function ListRow({
  href,
  leading,
  title,
  subtitle,
  trailing,
  chevron = true,
}: {
  href?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
}) {
  const body = (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px]">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</div>}
      </div>
      {trailing}
      {href && chevron && <ChevronRight />}
    </div>
  );
  return <li>{href ? <Link href={href} className="block transition-colors active:bg-surface-3">{body}</Link> : body}</li>;
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
  rejected: "bg-surface-3 text-muted",
  on_hold: "bg-surface-3 text-muted",
  failed: "bg-danger-soft text-danger",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${TASK_TONE[status]}`}>
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

const APPROVAL_TONE: Record<ApprovalStatus, string> = {
  pending: "bg-accent text-white",
  on_hold: "bg-accent-soft text-accent",
  approved: "bg-success-soft text-success",
  rejected: "bg-surface-3 text-muted",
  superseded: "bg-surface-3 text-muted",
  executing: "bg-info-soft text-brand",
  executed: "bg-success-soft text-success",
  execution_failed: "bg-danger-soft text-danger",
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${APPROVAL_TONE[status]}`}>
      {APPROVAL_STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const dot = priority === "high" ? "bg-danger" : priority === "medium" ? "bg-accent" : "bg-faint";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-medium text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      優先度 {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  href,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  tone?: "accent" | "danger";
  icon?: IconName;
}) {
  const body = (
    <div className="card h-full p-4">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        {icon && <Icon name={icon} size={16} stroke={2} />}
        {label}
      </div>
      <div className={`tabular mt-1.5 text-[26px] leading-none font-bold tracking-tight ${tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : ""}`}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="press block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Empty({ children, icon = "inbox" }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center text-[15px] text-muted">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-faint">
        <Icon name={icon} size={28} />
      </span>
      {children}
    </div>
  );
}

/** 未実装の機能であることをはっきり示す表示 */
export function PhaseNotice({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-[18px] border border-dashed border-line bg-surface-2/60 px-4 py-3.5 text-[13px] leading-relaxed text-muted">
      <Icon name="clock" size={18} className="mt-0.5 shrink-0 text-faint" />
      <div>
        <span className="mr-1.5 inline-flex rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink ring-1 ring-line">
          {phase}で実装予定
        </span>
        {children}
      </div>
    </div>
  );
}

export function Alert({ tone, children, icon }: { tone: "info" | "warn" | "error" | "success"; children: ReactNode; icon?: IconName }) {
  const cls =
    tone === "error"
      ? "bg-danger-soft text-danger"
      : tone === "warn"
        ? "bg-accent-soft text-accent"
        : tone === "success"
          ? "bg-success-soft text-success"
          : "bg-info-soft text-brand";
  const defaultIcon: IconName = tone === "error" || tone === "warn" ? "alert" : tone === "success" ? "check" : "info";
  return (
    <div className={`flex items-start gap-2.5 rounded-[14px] px-3.5 py-3 text-[14px] font-medium ${cls}`}>
      <Icon name={icon ?? defaultIcon} size={18} stroke={2} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ChevronRight() {
  return <Icon name="chevronRight" size={16} stroke={2.4} className="shrink-0 text-faint" />;
}

export function Meter({ value, max, marks }: { value: number; max: number; marks?: { at: number; label: string }[] }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone = pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-accent" : "bg-brand";
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${Math.max(pct, value > 0 ? 1.5 : 0)}%` }} />
      {marks?.map((m) => (
        <span key={m.label} className="absolute top-0 h-full w-0.5 bg-ink/30" style={{ left: `${Math.min(100, (m.at / max) * 100)}%` }} title={m.label} />
      ))}
    </div>
  );
}

/** 予算の使用率を表す円グラフ */
export function Ring({ value, max, size = 92, children }: { value: number; max: number; size?: number; children?: ReactNode }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 40;
  const c = 2 * Math.PI * r;
  const color = pct >= 0.9 ? "var(--danger)" : pct >= 0.75 ? "var(--accent)" : "var(--brand)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          opacity={pct > 0.004 ? 1 : 0}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

/** 選択式のタブ（iPhone のセグメントコントロール風）。リンクで切り替えます。 */
export function SegmentedLinks({ items, active }: { items: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <div className="flex gap-1 rounded-[12px] bg-surface-3 p-1" role="tablist">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          role="tab"
          aria-selected={active === i.key}
          className={`flex-1 rounded-[9px] py-1.5 text-center text-[14px] font-semibold transition-colors ${
            active === i.key ? "bg-surface text-ink shadow-card" : "text-muted"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/** 画面右下の「＋」ボタン */
export function Fab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="press fixed right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-fg shadow-pop"
      style={{ bottom: "calc(72px + env(safe-area-inset-bottom))" }}
    >
      <Icon name="plus" size={26} stroke={2.4} />
    </Link>
  );
}
