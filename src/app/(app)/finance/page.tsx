import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSpendSummary } from "@/lib/budget";
import { getBudget, getSettings } from "@/lib/repo/settings";
import { dailyUsageThisMonth, listUsage, usageByEmployeeThisMonth, usageByTaskThisMonth } from "@/lib/repo/usage";
import { dateTime, yen, yenPrecise } from "@/lib/format";
import { businessMoneyList, ledgerTotals, monthlyMoney } from "@/lib/repo/ledger";
import { BUSINESS_STATUS_LABEL, type BusinessStatus } from "@/lib/constants";
import { Meter, Page, PageHeader, Section, Stat } from "@/components/ui";
import { Icon } from "@/components/Icon";

export const metadata = { title: "財務管理" };

const STATUS_LABEL: Record<string, string> = { reserved: "処理中", completed: "確定", failed: "失敗(0円)", unknown: "不明(見積額)" };

export default async function FinancePage() {
  const sql = await getDb();
  const [settings, budget, spend, byEmp, byTask, daily, history, totals, months, perBusiness] = await Promise.all([
    getSettings(sql),
    getBudget(sql),
    getSpendSummary(sql),
    usageByEmployeeThisMonth(sql),
    usageByTaskThisMonth(sql),
    dailyUsageThisMonth(sql),
    listUsage(sql, 50),
    ledgerTotals(sql),
    monthlyMoney(sql, 6),
    businessMoneyList(sql),
  ]);
  const hardLimit = Math.min(budget.monthly_limit_jpy, budget.emergency_stop_jpy);
  const remaining = Math.max(0, hardLimit - spend.monthJpy);
  const maxEmp = Math.max(0.0001, ...byEmp.map((e) => e.jpy));
  const maxDay = Math.max(0.0001, ...daily.map((d) => d.jpy));
  const ops = settings.hosting_cost_jpy_monthly;
  const costs = totals.month.expense + spend.monthJpy + ops;
  const profit = totals.month.income - costs;

  return (
    <>
      <PageHeader title="財務管理" subtitle="今月（日本時間）の集計" back="/more" backLabel="メニュー" />
      <Page>
        <Section title="今月のもうけ">
          <div className="card p-4 text-[15px]">
            <div className="flex justify-between">
              <span className="text-muted">入ったお金（収益）</span>
              <span className="font-semibold text-success">{yen(totals.month.income)}</span>
            </div>
            <div className="mt-1.5 flex justify-between">
              <span className="text-muted">出たお金（記録した費用）</span>
              <span>{yen(totals.month.expense)}</span>
            </div>
            <div className="mt-1.5 flex justify-between">
              <span className="text-muted">AIの利用料（自動）</span>
              <span>{yen(spend.monthJpy)}</span>
            </div>
            <div className="mt-1.5 flex justify-between">
              <span className="text-muted">運用料金（手入力）</span>
              <span>{yen(ops)}</span>
            </div>
            <div className="mt-2.5 flex justify-between border-t border-line pt-2.5 text-[17px] font-bold">
              <span>もうけ（利益）</span>
              <span className={profit < 0 ? "text-danger" : "text-success"}>{yen(profit)}</span>
            </div>
          </div>
          <Link href="/finance/ledger" className="btn-primary mt-2.5 w-full">
            <Icon name="plus" size={18} stroke={2.4} />
            入ったお金・出たお金を記録する
          </Link>
        </Section>

        <Section title="月ごとのお金（直近6か月）">
          <div className="card overflow-x-auto p-1">
            <table className="w-full text-right text-[13px] tabular">
              <thead className="text-[11px] text-muted">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">月</th>
                  <th className="px-2 py-2 font-semibold">収益</th>
                  <th className="px-2 py-2 font-semibold">費用</th>
                  <th className="px-2 py-2 font-semibold">AI</th>
                  <th className="px-2 py-2 font-semibold">もうけ</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const p = m.income - m.expense - m.api - ops;
                  return (
                    <tr key={m.month} className="border-t border-separator">
                      <td className="px-2 py-2 text-left">{m.month.slice(5).replace(/^0/, "")}月</td>
                      <td className="px-2 py-2">{yen(m.income)}</td>
                      <td className="px-2 py-2">{yen(m.expense)}</td>
                      <td className="px-2 py-2">{yen(m.api)}</td>
                      <td className={`px-2 py-2 font-semibold ${p < 0 ? "text-danger" : "text-success"}`}>{yen(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 px-1 text-xs text-muted">「もうけ」は、運用料金（いまの設定 {yen(ops)}/月）も引いた金額です。</p>
        </Section>

        <Section title="事業ごとのお金（これまでの合計）">
          {perBusiness.length === 0 ? (
            <p className="card px-4 py-4 text-sm text-muted">まだありません。お金を記録するときに「どの事業のお金？」を選ぶと、ここに出ます。</p>
          ) : (
            <ul className="card divide-y divide-separator text-sm">
              {perBusiness.map((b) => (
                <li key={b.id}>
                  <Link href={`/business/${b.id}`} className="block px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium text-brand">{b.name}</span>
                      <span className={`shrink-0 font-bold ${b.profit < 0 ? "text-danger" : "text-success"}`}>{yen(b.profit)}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {BUSINESS_STATUS_LABEL[b.status as BusinessStatus] ?? b.status}・収益 {yen(b.income)}・費用 {yen(b.expense)}・AI {yenPrecise(b.api)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="AI API 利用料">
          <div className="card p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted">今月の使用額</span>
              <span className="text-xs text-muted">停止まで残り {yen(remaining)}</span>
            </div>
            <div className="mt-1 mb-3 text-3xl font-bold">{yen(spend.monthJpy)}</div>
            <Meter value={spend.monthJpy} max={budget.monthly_limit_jpy} marks={[{ at: budget.monthly_target_jpy, label: "目標" }, { at: budget.emergency_stop_jpy, label: "緊急停止" }]} />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-surface-2 py-2">
                <dt className="text-muted">月間上限</dt>
                <dd className="mt-0.5 font-bold text-ink">{yen(budget.monthly_limit_jpy)}</dd>
              </div>
              <div className="rounded-lg bg-surface-2 py-2">
                <dt className="text-muted">通常目標</dt>
                <dd className="mt-0.5 font-bold text-ink">{yen(budget.monthly_target_jpy)}</dd>
              </div>
              <div className="rounded-lg bg-surface-2 py-2">
                <dt className="text-muted">緊急停止</dt>
                <dd className="mt-0.5 font-bold text-ink">{yen(budget.emergency_stop_jpy)}</dd>
              </div>
            </dl>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <Stat label="今日の使用額" value={yen(spend.todayJpy)} sub={`1日の上限 ${yen(budget.daily_limit_jpy)}`} />
            <Stat label="今日のAI呼び出し" value={`${spend.callsToday}回`} sub={`上限 ${budget.max_calls_per_day}回`} />
          </div>
          <p className="mt-2 px-1 text-xs text-muted">
            料金は「実際の使用量 × 公式料金 × 為替レート（{settings.usd_jpy_rate}円/ドル）」で計算しています。使用量が分からない呼び出しは、安全のため見積額（多めの金額）で数えます。上限に達すると新しいAI処理は自動で止まります。
            <Link href="/settings#budget" className="ml-1 text-brand underline">
              予算を変更
            </Link>
          </p>
        </Section>

        <Section title="日別の使用額（今月）">
          {daily.length === 0 ? (
            <p className="card px-4 py-4 text-sm text-muted">今月はまだ利用がありません。</p>
          ) : (
            <ul className="card space-y-1.5 p-4 text-xs">
              {daily.map((d) => (
                <li key={d.day} className="flex items-center gap-2">
                  <span className="w-11 shrink-0 text-muted">{d.day}</span>
                  <span className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (d.jpy / maxDay) * 70)}%` }} />
                  <span className="ml-auto shrink-0 font-medium">{yenPrecise(d.jpy)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="社員別の使用額（今月）">
          {byEmp.length === 0 ? (
            <p className="card px-4 py-4 text-sm text-muted">今月はまだ利用がありません。</p>
          ) : (
            <ul className="card space-y-3 p-4 text-sm">
              {byEmp.map((e) => (
                <li key={e.employee_id ?? "none"}>
                  <div className="flex justify-between">
                    <span>{e.name ?? "（社員以外）"}</span>
                    <span className="font-medium">
                      {yenPrecise(e.jpy)} <span className="text-xs text-muted">／{e.calls}回</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${(e.jpy / maxEmp) * 100}%`, background: e.avatar_color ?? "var(--brand)" }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="業務別の使用額（今月）">
          {byTask.length === 0 ? (
            <p className="card px-4 py-4 text-sm text-muted">今月はまだ利用がありません。</p>
          ) : (
            <ul className="card divide-y divide-separator text-sm">
              {byTask.map((t) => (
                <li key={t.task_id ?? "none"} className="flex justify-between gap-3 px-4 py-2.5">
                  {t.task_id ? (
                    <Link href={`/tasks/${t.task_id}`} className="truncate text-brand">
                      {t.title}
                    </Link>
                  ) : (
                    <span className="truncate text-muted">業務に紐づかない利用（会話など）</span>
                  )}
                  <span className="shrink-0 font-medium">{yenPrecise(t.jpy)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="運用料金（サーバー・データベース等）">
          <div className="card p-4 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted">今月の運用料金（手入力）</span>
              <span className="text-xl font-bold">{yen(ops)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              Vercel・Supabase を無料プランで使う場合は0円です。有料プランにした場合は
              <Link href="/settings#ops" className="mx-1 text-brand underline">
                設定
              </Link>
              で金額を入力してください。API利用料とは別に表示しています。
            </p>
          </div>
        </Section>

        <Section title="利用履歴（最新50件）">
          {history.length === 0 ? (
            <p className="card px-4 py-4 text-sm text-muted">まだ利用履歴はありません。</p>
          ) : (
            <ul className="card divide-y divide-separator text-sm">
              {history.map((u) => (
                <li key={u.id} className="px-4 py-2.5">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">
                      {u.employee_name ?? "—"} ・ <span className="text-muted">{u.model}</span>
                    </span>
                    <span className="shrink-0 font-medium">{yenPrecise(u.cost_jpy ?? u.estimated_cost_jpy)}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {dateTime(u.created_at)} ・ {STATUS_LABEL[u.status]}
                    {u.input_tokens != null && ` ・ 入力${u.input_tokens}／出力${u.output_tokens}トークン`}
                    {u.error && ` ・ ${u.error.slice(0, 60)}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Page>
    </>
  );
}
