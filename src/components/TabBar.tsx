"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "ホーム", icon: "home" },
  { href: "/employees", label: "社員", icon: "users" },
  { href: "/tasks", label: "業務", icon: "tasks" },
  { href: "/approvals", label: "承認", icon: "approve" },
  { href: "/more", label: "メニュー", icon: "menu" },
];

const MORE_PATHS = ["/more", "/business", "/reports", "/finance", "/settings"];

/** チャット画面では、メッセージアプリのように下のメニューを隠して全画面にする */
function isFullScreen(pathname: string) {
  return /^\/employees\/[^/]+\/chat/.test(pathname);
}

export function TabBar({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  if (isFullScreen(pathname)) return null;
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/more") return MORE_PATHS.some((p) => pathname.startsWith(p));
    return pathname.startsWith(href);
  };
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-30 bg-[var(--tabbar)] shadow-[0_-0.5px_0_var(--separator)] backdrop-blur-xl backdrop-saturate-150"
      aria-label="メインメニュー"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-5">
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={`relative flex h-[54px] flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors ${
                  active ? "text-brand" : "text-faint"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={t.icon} size={25} stroke={active ? 2.1 : 1.7} filled={active} />
                {t.label}
                {t.href === "/approvals" && pendingApprovals > 0 && (
                  <span className="absolute top-1 left-1/2 ml-1.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[11px] leading-[18px] font-bold text-white ring-2 ring-[var(--surface)]">
                    {pendingApprovals > 99 ? "99+" : pendingApprovals}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
