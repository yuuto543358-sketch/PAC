import { logout } from "@/app/actions/auth";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/repo/settings";
import { Icon } from "@/components/Icon";
import { IconTile, List, ListRow, Page, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "メニュー" };

export default async function MorePage() {
  const sql = await getDb();
  const settings = await getSettings(sql);
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

        <Section title="暮らし（いちばん大事な仕事）">
          <List>
            <ListRow href="/life" leading={<IconTile name="sparkles" color="#0f766e" />} title="ライフ" subtitle="今日の暮らし・質問・分析・改善提案" />
            <ListRow href="/life/habits" leading={<IconTile name="check" color="#16a34a" />} title="小さな習慣" subtitle="続けたいことにチェック" />
            <ListRow href="/life/events" leading={<IconTile name="clock" color="#c2410c" />} title="これから起きること" subtitle="車検・更新・税金・誕生日など" />
            <ListRow href="/life/goals" leading={<IconTile name="star" color="#7c3aed" />} title="目標" subtitle="進み具合とふりかえり" />
          </List>
        </Section>

        <Section title="経営">
          <List>
            <ListRow href="/finance" leading={<IconTile name="wallet" color="#15803d" />} title="財務管理" subtitle="もうけ・お金の記録・AIの利用料" />
            <ListRow href="/business" leading={<IconTile name="briefcase" color="#c2410c" />} title="事業開発" subtitle="AIが見つけた事業の候補" />
            <ListRow href="/sns" leading={<IconTile name="send" color="#0ea5e9" />} title="SNS運用" subtitle="AIが投稿案を作り、承認すると投稿" />
            <ListRow href="/reports" leading={<IconTile name="report" color="#7c3aed" />} title="報告書" subtitle="日報・週報・業務の完了報告" />
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
        <p className="text-center text-[12px] text-faint">PERSONAL AI COMPANY ・ Phase 4 ・ バージョン {process.env.NEXT_PUBLIC_BUILD_COMMIT}</p>
      </Page>
    </>
  );
}
