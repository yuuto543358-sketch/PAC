"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "ホーム", icon: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z" },
  { href: "/employees", label: "社員", icon: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c0-4 4-6 8-6s8 2 8 6" },
  { href: "/tasks", label: "業務", icon: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" },
  { href: "/approvals", label: "承認", icon: "M5 12l4 4L19 6" },
  { href: "/more", label: "メニュー", icon: "M4 7h16M4 12h16M4 17h16" },
];

const MORE_PATHS = ["/more", "/business", "/reports", "/finance", "/settings"];

export function TabBar({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/more") return MORE_PATHS.some((p) => pathname.startsWith(p));
    return pathname.startsWith(href);
  };
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[var(--tabbar)] backdrop-blur" aria-label="メインメニュー">
      <ul className="mx-auto grid max-w-2xl grid-cols-5">
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={`relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-brand" : "text-muted"}`}
                aria-current={active ? "page" : undefined}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={t.icon} />
                </svg>
                {t.label}
                {t.href === "/approvals" && pendingApprovals > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2 min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] leading-5 font-bold text-white">
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
