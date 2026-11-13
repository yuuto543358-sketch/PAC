import { logout } from "@/app/actions/auth";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/repo/settings";
import { Icon } from "@/components/Icon";
import { IconTile, List, ListRow, Page, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "メニュー" };

export default async function MorePage() {
  const sql = await getDb();
  const settings = await getSettings(sql);
  const soon = <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">準備中</span>;
  return (
    <>
      <PageHeader title="メニュー" />
      <Page>
        <div className="card flex items-center gap-4 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" width={56} height={56} className="rounded-[14px] shadow-card" />
          <div className="min-w-0">
            <div className="truncate text-[18px] font-bold">{settings.company_name}</div>
            <div className="truncate text-[13px] text-muted">{settings.philosophy}</div>
          </div>
        </div>

        <Section title="経営">
          <List>
            <ListRow href="/finance" leading={<IconTile name="wallet" color="#15803d" />} title="財務管理" subtitle="API予算・使用額・利用履歴・運用費" />
            <ListRow href="/business" leading={<IconTile name="briefcase" color="#c2410c" />} title="事業開発" subtitle="事業候補の管理" trailing={soon} />
            <ListRow href="/reports" leading={<IconTile name="report" color="#7c3aed" />} title="報告書" subtitle="日次・週次・月次・社員別" trailing={soon} />
          </List>
        </Section>

        <Section title="会社">
          <List>
            <ListRow href="/employees" leading={<IconTile name="users" color="#2563eb" />} title="社員" subtitle="プロフィール・評価・チャット" />
            <ListRow href="/tasks" leading={<IconTile name="tasks" color="#0f766e" />} title="業務管理" subtitle="すべての業務と履歴" />
            <ListRow href="/approvals" leading={<IconTile name="approve" color="#ea580c" />} title="承認センター" subtitle="外部への実行の承認" />
          </List>
        </Section>

        <Section title="アプリ">
          <List>
            <ListRow href="/settings" leading={<IconTile name="settings" color="#64748b" />} title="設定" subtitle="会社情報・予算・AIモデル・社員情報・セキュリティ" />
          </List>
        </Section>

        <form action={logout}>
          <button type="submit" className="card press flex w-full items-center justify-center gap-2 py-3.5 text-[16px] font-semibold text-danger">
            <Icon name="logout" size={20} stroke={2} />
            ログアウト
          </button>
        </form>
        <p className="text-center text-[12px] text-faint">PERSONAL AI COMPANY ・ Phase 1 ・ バージョン {process.env.NEXT_PUBLIC_BUILD_COMMIT}</p>
      </Page>
    </>
  );
}
