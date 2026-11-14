import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { dateTime, jstDateParts } from "@/lib/format";
import { getGoal, goalProgressList } from "@/lib/life/goals";
import { Page, PageHeader, Section } from "@/components/ui";
import { LifeChart } from "@/components/LifeChart";
import { GoalProgressForm, GoalStatusButtons } from "../../QolForms";
import { GoalBar } from "@/components/GoalBar";

export const metadata = { title: "目標" };

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { date } = jstDateParts(new Date());
  const sql = await getDb();
  const g = await getGoal(sql, id, date);
  if (!g) notFound();
  const progress = await goalProgressList(sql, g.id);
  const points = progress
    .filter((p) => p.value != null)
    .reverse()
    .map((p) => ({ label: `${new Date(p.recorded_at).getMonth() + 1}/${new Date(p.recorded_at).getDate()}`, value: Number(p.value) }));
  return (
    <>
      <PageHeader title={g.title} back="/life/goals" backLabel="目標" />
      <Page>
        <div className="card p-4">
          <p className={`text-[28px] font-bold ${g.behind ? "text-accent" : ""}`}>
            {g.pct != null ? `${g.pct}%` : g.status === "achieved" ? "達成🎉" : "記録で管理"}
          </p>
          <GoalBar pct={g.pct} timePct={g.timePct} />
          <p className="mt-2 text-[13px] text-muted">
            {g.start_value != null && `スタート ${g.start_value.toLocaleString("ja-JP")}${g.unit}`}
            {g.latest_value != null && `・いま ${g.latest_value.toLocaleString("ja-JP")}${g.unit}`}
            {g.target_value != null && `・目標 ${g.target_value.toLocaleString("ja-JP")}${g.unit}`}
            {g.due_date && `・期限 ${g.due_date}`}
          </p>
          {g.behind && <p className="mt-1 text-[13px] text-accent">期限までの時間に比べて、進みが少し遅れています。</p>}
          {g.why && <p className="mt-2 text-[14px]">なぜ：{g.why}</p>}
        </div>
        {points.length >= 2 && (
          <div className="card p-4">
            <LifeChart points={points} kind="line" unit={g.unit} title="進み具合の変化" />
          </div>
        )}
        {g.status === "active" && (
          <Section title="進み具合を記録する">
            <div className="card p-4">
              <GoalProgressForm id={g.id} unit={g.unit} />
            </div>
          </Section>
        )}
        <Section title="記録">
          <ul className="card divide-y divide-separator text-[14px]">
            {progress.map((p) => (
              <li key={p.id} className="px-4 py-2.5">
                <span className="font-semibold">{p.value != null ? `${Number(p.value).toLocaleString("ja-JP")}${g.unit}` : "メモ"}</span>
                {p.note && <span className="ml-2 text-muted">{p.note}</span>}
                <span className="block text-[11px] text-faint">{dateTime(p.recorded_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <GoalStatusButtons id={g.id} status={g.status} />
      </Page>
    </>
  );
}
