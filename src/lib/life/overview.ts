import "server-only";
import type { Db } from "@/lib/db";
import { jstDateParts } from "@/lib/format";
import { planQuestions } from "./planner";
import { latestRecords, listCategories, listFields } from "./repo";

/** 情報の集まり具合（足りない情報・更新が必要な情報）。AIは使わない */
export async function lifeOverview(db: Db, now = new Date()) {
  const [fields, categories, latest] = await Promise.all([listFields(db), listCategories(db), latestRecords(db)]);
  const { date } = jstDateParts(now);
  const all = planQuestions({ fields, categories, latest, lastQuestions: new Map(), today: date, now, limit: 999 });
  const activeCats = new Set(categories.filter((c) => c.is_active).map((c) => c.id));
  const activeFields = fields.filter((f) => f.is_active && activeCats.has(f.category_id));
  return {
    fields,
    categories,
    latest,
    totalFields: activeFields.length,
    filledFields: activeFields.filter((f) => latest.has(f.id)).length,
    missing: all.filter((c) => c.why === "missing" && c.field.importance >= 3),
    stale: all.filter((c) => c.why === "stale"),
    periodDue: all.filter((c) => c.why === "period"),
  };
}
