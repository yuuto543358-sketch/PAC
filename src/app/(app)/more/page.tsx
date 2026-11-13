import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { ChevronRight, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "メニュー" };

const ITEMS = [
  { href: "/finance", title: "財務管理", desc: "API予算・使用額・利用履歴・運用費", ready: true },
  { href: "/settings", title: "設定", desc: "会社情報・予算・AIモデル・社員情報・セキュリティ", ready: true },
  { href: "/business", title: "事業開発", desc: "事業候補の管理", ready: false },
  { href: "/reports", title: "報告書", desc: "日次・週次・月次・事業開発・社員別", ready: false },
];

export default function MorePage() {
  return (
    <>
      <PageHeader title="メニュー" />
      <Page>
        <ul className="card divide-y divide-line">
          {ITEMS.map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[15px] font-semibold">
                    {i.title}
                    {!i.ready && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">準備中</span>}
                  </div>
                  <div className="text-xs text-muted">{i.desc}</div>
                </div>
                <ChevronRight />
              </Link>
            </li>
          ))}
        </ul>
        <form action={logout}>
          <button type="submit" className="btn-secondary w-full text-danger">
            ログアウト
          </button>
        </form>
        <p className="text-center text-xs text-muted">PERSONAL AI COMPANY ・ Phase 1</p>
      </Page>
    </>
  );
}
