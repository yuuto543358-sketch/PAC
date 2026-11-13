"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * iPhone のアプリのような見出し。
 * ページの上では大きなタイトルを表示し、下にスクロールすると上部のバーに小さなタイトルが出ます。
 */
export function PageHeader({
  title,
  subtitle,
  back,
  backLabel = "戻る",
  action,
  large = true,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  backLabel?: string;
  action?: ReactNode;
  large?: boolean;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(!large);

  useEffect(() => {
    if (!large || !sentinel.current) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { rootMargin: "-52px 0px 0px 0px" });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [large]);

  return (
    <>
      <header
        className={`pt-safe sticky top-0 z-30 transition-[background-color,box-shadow] duration-200 ${
          scrolled ? "bg-[var(--bar)] shadow-[0_0.5px_0_var(--separator)] backdrop-blur-xl backdrop-saturate-150" : "bg-bg"
        }`}
      >
        <div className="mx-auto grid h-12 max-w-2xl grid-cols-[1fr_auto_1fr] items-center px-2">
          <div className="flex min-w-0 items-center">
            {back && (
              <Link href={back} className="press flex h-11 items-center gap-0.5 pr-2 pl-1 text-[17px] text-brand" aria-label={backLabel}>
                <Icon name="chevronLeft" size={26} stroke={2.4} />
                <span className="max-w-[7.5rem] truncate">{backLabel}</span>
              </Link>
            )}
          </div>
          <div
            className={`max-w-[55vw] truncate text-center text-[17px] font-semibold transition-opacity duration-200 ${
              scrolled ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden={!scrolled}
          >
            {title}
          </div>
          <div className="flex items-center justify-end gap-1 pr-1">{action}</div>
        </div>
      </header>
      {large && (
        <div className="mx-auto max-w-2xl px-4 pt-1 pb-1">
          <h1 className="text-[32px] leading-tight font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[15px] text-muted">{subtitle}</p>}
          <div ref={sentinel} className="h-px" />
        </div>
      )}
      {!large && (
        <h1 className="sr-only">{title}</h1>
      )}
    </>
  );
}
