import Link from "next/link";
import { getDb } from "@/lib/db";
import { getBudget, getSettings } from "@/lib/repo/settings";
import { listEmployees } from "@/lib/repo/employees";
import { FIXED_COMPANY_PRINCIPLES } from "@/lib/ai/prompts";
import { isAiConfigured, isMockMode } from "@/lib/ai/client";
import { Avatar } from "@/components/Avatar";
import { ChevronRight, Page, PageHeader, Section } from "@/components/ui";
import { PushSetup } from "./PushSetup";
import { countPushSubscriptions, isPushConfigured, vapidPublicKey } from "@/lib/notify";
import { AutorunForm, BudgetForm, NotifyForm, CompanyForm, EmergencyForm, LogoutAllForm, ModelForm, OpsCostForm } from "./forms";

export const metadata = { title: "設定" };

export default async function SettingsPage() {
  const sql = await getDb();
  const [settings, budget, employees] = await Promise.all([getSettings(sql), getBudget(sql), listEmployees(sql)]);
  const cronConfigured = Boolean(process.env.CRON_SECRET);
  const pushConfigured = isPushConfigured();
  const deviceCount = await countPushSubscriptions(sql);
  return (
    <>
      <PageHeader title="設定" back="/more" backLabel="メニュー" />
      <Page>
        <Section title="緊急停止">
          <div className="card p-4">
            <EmergencyForm on={settings.emergency_stop} />
          </div>
        </Section>

        <Section title="会社情報">
          <div className="card p-4">
            <CompanyForm initial={{ company_name: settings.company_name, philosophy: settings.philosophy, custom_rules: settings.custom_rules }} />
          </div>
          <details className="card mt-2.5">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">会社の基本原則（変更不可）を見る ›</summary>
            <pre className="border-t border-line px-4 py-3 font-sans text-xs whitespace-pre-wrap text-muted">{FIXED_COMPANY_PRINCIPLES}</pre>
          </details>
        </Section>

        <Section title="社員情報">
          <ul className="card divide-y divide-separator">
            {employees.map((e) => (
              <li key={e.id}>
                <Link href={`/settings/employees/${e.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                  <Avatar color={e.avatar_color} styleId={e.avatar_style} size={36} label={e.name} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">{e.name}</div>
                    <div className="text-xs text-muted">{e.role_title}</div>
                  </div>
                  <ChevronRight />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1 text-xs text-muted">社員の権限や役割（社長・調査担当など）はAI社員自身では変更できません。</p>
        </Section>

        <Section title="API予算">
          <div id="budget" className="card scroll-mt-20 p-4">
            <BudgetForm initial={budget} />
          </div>
        </Section>

        <Section title="AIモデル">
          <div className="card p-4">
            <p className="mb-3 text-sm">
              OpenAI APIキー：
              {isMockMode() ? <span className="font-semibold text-danger">テスト用モック</span> : isAiConfigured() ? <span className="font-semibold text-success">設定済み</span> : <span className="font-semibold text-danger">未設定</span>}
              <span className="ml-1 text-xs text-muted">（キーはサーバーにだけ保存され、この画面には表示されません）</span>
            </p>
            <ModelForm
              initial={{
                model_standard: settings.model_standard,
                model_advanced: settings.model_advanced,
                advanced_model_allowed: settings.advanced_model_allowed,
                usd_jpy_rate: settings.usd_jpy_rate,
              }}
            />
          </div>
        </Section>

        <Section title="自動で動く仕事">
          <div id="autorun" className="card scroll-mt-20 space-y-3 p-4">
            <AutorunForm
              initial={{
                autorun_frequency: settings.autorun_frequency,
                web_research_enabled: settings.web_research_enabled,
                discovery_auto_start: settings.discovery_auto_start,
              }}
            />
          </div>
          <div className="mt-2 space-y-1.5 px-1 text-xs leading-relaxed text-muted">
            <p>毎日、夜中（午前3時ごろ）に自動で動きます。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <b className="text-ink">1日1回</b>：事業開発担当が仕事（事業の候補）を探す・社長が日報を書く。月曜は週報、毎月1日は月報も書く。
              </li>
              <li>
                <b className="text-ink">週1回</b>：月曜だけ、仕事を探して週報を書く。毎月1日は月報も書く。
              </li>
              <li>
                <b className="text-ink">停止</b>：自動では何もしません（「事業開発」「報告書」の画面のボタンで、いつでも手動で動かせます）。
              </li>
            </ul>
            <p>
              費用の目安：仕事探し1回 約3〜10円（Web検索を使うと高め）、報告書1回 約1円。どれも予算の上限を超えそうなときは自動で止まります。外部への送信・登録・購入は、必ずあなたの承認が必要です。
            </p>
            <p>
              自動で動かすには、Vercel の環境変数 <code>CRON_SECRET</code> の設定が必要です（README 参照）。{" "}
              {cronConfigured ? <span className="font-semibold text-success">設定済み</span> : <span className="font-semibold text-danger">未設定</span>}
            </p>
          </div>
        </Section>

        <Section title="運用料金">
          <div id="ops" className="card scroll-mt-20 p-4">
            <OpsCostForm initial={settings.hosting_cost_jpy_monthly} />
          </div>
        </Section>

        <Section title="通知（iPhone のプッシュ通知）">
          <div id="notify" className="card scroll-mt-20 space-y-4 p-4">
            <PushSetup configured={pushConfigured} publicKey={vapidPublicKey()} deviceCount={deviceCount} />
            <div className="border-t border-separator pt-4">
              <NotifyForm initial={{ notify_approvals: settings.notify_approvals, notify_budget: settings.notify_budget }} />
            </div>
          </div>
          <p className="mt-2 px-1 text-xs leading-relaxed text-muted">
            通知には短いお知らせだけが入ります（詳しい内容はアプリを開いて確認）。通知が届かなくても、ホーム画面の「重要なお知らせ」と承認タブの数字でも確認できます。
          </p>
        </Section>

        <Section title="セキュリティ">
          <div className="card space-y-3 p-4 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
              <li>ログインはパスワード方式です。パスワードはVercelの環境変数 APP_PASSWORD で変更できます。</li>
              <li>ログイン失敗が続くと15分間ロックされます。</li>
              <li>業務履歴・承認履歴・API利用記録・操作履歴は、データベースの仕組みで変更・削除できないよう保護されています。</li>
            </ul>
            <LogoutAllForm />
          </div>
        </Section>
      </Page>
    </>
  );
}
