import { getDb } from "@/lib/db";
import { listEmployees } from "@/lib/repo/employees";
import { getBudget } from "@/lib/repo/settings";
import { Page, PageHeader } from "@/components/ui";
import { NewTaskForm } from "./NewTaskForm";

export const metadata = { title: "業務を登録" };

export default async function NewTaskPage() {
  const sql = await getDb();
  const [employees, budget] = await Promise.all([listEmployees(sql), getBudget(sql)]);
  return (
    <>
      <PageHeader title="業務を登録" back="/tasks" />
      <Page>
        <NewTaskForm employees={employees.map((e) => ({ id: e.id, name: e.name, role: e.role_title }))} defaultBudget={budget.per_task_limit_jpy} />
        <p className="px-1 text-xs text-muted">
          社長とのチャットで依頼すると、社長が担当者を選んで業務を登録することもできます。登録だけではAIは呼び出されません（費用はかかりません）。
        </p>
      </Page>
    </>
  );
}
