import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/repo/settings";
import { listCategories } from "@/lib/life/repo";
import { Page, PageHeader } from "@/components/ui";
import { LifeSettingsForm } from "../LifeForms";

export const metadata = { title: "ライフの設定" };

export default async function LifeSettingsPage() {
  const sql = await getDb();
  const [settings, categories] = await Promise.all([getSettings(sql), listCategories(sql)]);
  return (
    <>
      <PageHeader title="ライフの設定" back="/life" backLabel="ライフ" />
      <Page>
        <div className="card p-4">
          <LifeSettingsForm
            initial={{
              frequency: settings.life_question_frequency,
              perBatch: settings.life_questions_per_batch,
              autoTask: settings.life_auto_task,
              review: settings.life_review_enabled,
              prep: settings.life_prep_enabled,
              nudge: settings.life_nudge_enabled,
              research: settings.life_research_enabled,
            }}
            categories={categories}
          />
        </div>
        <p className="px-1 text-xs leading-relaxed text-muted">
          質問は、毎朝（午前7時半ごろ）の定期実行で作られ、アプリに届きます（CRON_SECRET の設定が必要）。使い始めの時期は、基本の情報が集まるまで毎日少しずつ質問します。質問づくりにAIは使わないので、費用はかかりません。
        </p>
      </Page>
    </>
  );
}
