import { Icon } from "@/components/Icon";

/** Web検索で参照したページの一覧（外部リンク。新しいタブで開く） */
export function SourceList({ sources, className = "" }: { sources: { url: string; title: string }[]; className?: string }) {
  if (!sources.length) return null;
  return (
    <div className={`rounded-[14px] bg-surface-2/70 px-3 py-2.5 ${className}`}>
      <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted">
        <Icon name="search" size={13} stroke={2.2} />
        Webで調べたページ（{sources.length}件）
      </p>
      <ul className="space-y-1">
        {sources.slice(0, 8).map((s) => {
          let host = "";
          try {
            host = new URL(s.url).hostname.replace(/^www\./, "");
          } catch {
            host = s.url;
          }
          return (
            <li key={s.url} className="min-w-0">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="block truncate text-[12px] text-brand underline-offset-2 hover:underline"
              >
                {s.title || host}
                {s.title && <span className="ml-1 text-faint">（{host}）</span>}
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[10px] text-faint">※ 外部のサイトです。内容が正しいとは限りません。</p>
    </div>
  );
}
