import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { LIFE_CONFIDENCE_LABEL, LIFE_SOURCE_LABEL } from "@/lib/constants";
import { formatRecordValue, getField, listRecords, recordHistory } from "@/lib/life/repo";
import { Empty, Page, PageHeader, Section } from "@/components/ui";
import { LifeChart } from "@/components/LifeChart";
import { AddRecordForm, RecordActions } from "../../LifeForms";

export const metadata = { title: "生活情報" };

function periodLabel(r: { period_start: string | null; period_end: string | null }, period: string) {
  if (!r.period_end) return null;
  if (period === "month" && r.period_start) return `${Number(r.period_start.slice(5, 7))}月分`;
  if (period === "week") return `${r.period_end.slice(5).replace("-", "/")}までの1週間`;
  return null;
}

export default async function LifeFieldPage({ params }: { params: Promise<{ field: string }> }) {
  const { field: fieldId } = await params;
  const sql = await getDb();
  const field = await getField(sql, fieldId);
  if (!field) notFound();
  const records = await listRecords(sql, field.id, 100);
  const histories = await Promise.all(records.slice(0, 20).map((r) => recordHistory(sql, r.id)));
  const numeric = field.value_type === "number" ? records.filter((r) => r.value_num != null).slice(0, 24).reverse() : [];
  const points = numeric.map((r) => ({
    label: field.kind === "periodic" && r.period_start ? `${Number(r.period_start.slice(5, 7))}月` : `${new Date(r.confirmed_at).getMonth() + 1}/${new Date(r.confirmed_at).getDate()}`,
    value: Number(r.value_num),
  }));
  return (
    <>
      <PageHeader title={field.label} subtitle={field.unit ? `単位：${field.unit}` : undefined} back="/life/records" backLabel="生活情報" />
      <Page>
        {points.length >= 2 && (
          <div className="card p-4">
            <LifeChart points={points} kind={field.kind === "periodic" ? "bar" : "line"} unit={field.unit} title={`${field.label}の変化`} />
          </div>
        )}

        <Section title="新しく記録する">
          <div className="card p-4">
            <AddRecordForm field={field} />
          </div>
          <p className="mt-2 px-1 text-xs text-muted">{field.reason}</p>
        </Section>

        <Section title="これまでの記録（新しい順）">
          {records.length === 0 ? (
            <Empty icon="document">まだ記録はありません。</Empty>
          ) : (
            <ul className="card divide-y divide-separator">
              {records.map((r, i) => {
                const prev = records[i + 1];
                const changed = field.kind === "state" && prev && formatRecordValue(field, prev) !== formatRecordValue(field, r);
                const pl = periodLabel(r, field.period);
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-[15px] font-semibold break-words whitespace-pre-wrap">{formatRecordValue(field, r)}</span>
                      {pl && <span className="shrink-0 text-[12px] text-muted">{pl}</span>}
                    </div>
                    <p className="text-[12px] text-muted">
                      {LIFE_SOURCE_LABEL[r.source]}・{LIFE_CONFIDENCE_LABEL[r.confidence]}・確認 {dateTime(r.confirmed_at)}
                      {r.source === "ai_estimate" && <span className="ml-1 font-semibold text-accent">（推定です）</span>}
                    </p>
                    {changed && <p className="text-[12px] text-accent">変わりました：{formatRecordValue(field, prev)} → {formatRecordValue(field, r)}</p>}
                    {i < 20 && histories[i].length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
                        {histories[i].map((h) => (
                          <li key={h.id}>
                            {dateTime(h.changed_at)} に修正：{h.old_value_num != null ? Number(h.old_value_num).toLocaleString("ja-JP") : h.old_value_text} →{" "}
                            {h.new_value_num != null ? Number(h.new_value_num).toLocaleString("ja-JP") : h.new_value_text}
                            {h.reason && `（${h.reason}）`}
                          </li>
                        ))}
                      </ul>
                    )}
                    <RecordActions
                      id={r.id}
                      field={field}
                      current={r.value_num != null ? String(Number(r.value_num)) : r.value_text}
                      canConfirm={i === 0 && field.kind === "state"}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </Page>
    </>
  );
}
