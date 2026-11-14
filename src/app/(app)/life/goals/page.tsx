import Link from "next/link";
import { getDb } from "@/lib/db";
import { jstDateParts } from "@/lib/format";
import { listGoals } from "@/lib/life/goals";
import { Empty, Page, PageHeader, Section } from "@/components/ui";
import { NewGoalForm } from "../QolForms";
import { GoalBar } from "@/components/GoalBar";

export const metadata = { title: "目標" };

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ title?: string; why?: string }> }) {
  const sp = await searchParams;
  const { date } = jstDateParts(new Date());
  const sql = await getDb();
  const [active, done] = await Promise.all([listGoals(sql, date, ["active"]), listGoals(sql, date, ["achieved", "paused", "dropped"])]);
  return (
    <>
      <PageHeader title="目標" subtitle="担当：ライフ担当 森野 結（お金の目標は財務 堅田 守も確認）" back="/life" backLabel="ライフ" />
      <Page>
        <Section title="いまの目標">
          {active.length === 0 ? (
            <Empty icon="star">まだ目標はありません。下で登録すると、進み具合を一緒に見ていきます。</Empty>
          ) : (
            <ul className="space-y-2.5">
              {active.map((g) => (
                <li key={g.id}>
                  <Link href={`/life/goals/${g.id}`} className="card press block p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-[16px] font-semibold">{g.title}</p>
                      <p className={`shrink-0 text-[13px] font-semibold ${g.behind ? "text-accent" : "text-muted"}`}>
                        {g.pct != null ? `${g.pct}%` : "記録で管理"}
                        {g.behind && "・遅れ気味"}
                      </p>
                    </div>
                    <GoalBar pct={g.pct} timePct={g.timePct} />
                    <p className="mt-1.5 text-[12px] text-muted">
                      {g.latest_value != null && `いま ${g.latest_value.toLocaleString("ja-JP")}${g.unit}`}
                      {g.target_value != null && ` → 目標 ${g.target_value.toLocaleString("ja-JP")}${g.unit}`}
                      {g.due_date && `・期限 ${g.due_date}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {active.some((g) => g.timePct != null) && <p className="mt-2 px-1 text-[11px] text-faint">バーの縦線は「期限までの時間がどれだけ過ぎたか」です。</p>}
        </Section>
        <Section title="目標を登録する">
          <div className="card p-4">
            <NewGoalForm prefill={{ title: sp.title, why: sp.why }} />
          </div>
        </Section>
        {done.length > 0 && (
          <Section title="達成・お休み・やめた目標">
            <ul className="card divide-y divide-separator text-[14px]">
              {done.map((g) => (
                <li key={g.id}>
                  <Link href={`/life/goals/${g.id}`} className="flex justify-between px-4 py-3">
                    <span className="truncate">{g.title}</span>
                    <span className="shrink-0 text-muted">{g.status === "achieved" ? "達成🎉" : g.status === "paused" ? "お休み" : "やめた"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Page>
    </>
  );
}
