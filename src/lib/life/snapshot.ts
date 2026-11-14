import "server-only";
import type { Db } from "@/lib/db";
import { LIFE_SOURCE_LABEL } from "@/lib/constants";
import { formatRecordValue, latestRecords, listCategories, listFields } from "./repo";

/** ライフ担当との会話で使う、生活情報の短いまとめ（「AIに渡さない」「使わない」カテゴリは含めない） */
export async function buildLifeSnapshot(db: Db): Promise<string> {
  const [fields, categories, latest] = await Promise.all([listFields(db), listCategories(db), latestRecords(db)]);
  const ok = new Map(categories.filter((c) => c.is_active && c.ai_allowed).map((c) => [c.id, c.name]));
  const lines: string[] = [];
  for (const f of fields) {
    const r = latest.get(f.id);
    if (!r || !ok.has(f.category_id)) continue;
    const date = r.period_end ?? new Date(r.confirmed_at).toISOString().slice(0, 10);
    const tag = r.source === "owner" ? "" : `（${LIFE_SOURCE_LABEL[r.source]}）`;
    lines.push(`- ${ok.get(f.category_id)}／${f.label}: ${formatRecordValue(f, r).slice(0, 200)}${tag}（${date}時点）`);
    if (lines.length >= 40) break;
  }
  return lines.length ? lines.join("\n") : "（まだ生活情報はありません）";
}
