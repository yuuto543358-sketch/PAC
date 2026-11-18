import { getDb } from "@/lib/db";
import { listEmployees } from "@/lib/repo/employees";
import { EmployeeGrid } from "@/components/EmployeeGrid";
import { Page, PageHeader } from "@/components/ui";

export const metadata = { title: "社員一覧" };

export default async function EmployeesPage() {
  const sql = await getDb();
  const employees = await listEmployees(sql);
  return (
    <>
      <PageHeader title="社員" />
      <Page>
        <EmployeeGrid
          fit="below"
          employees={employees.map((e) => ({ ...e, detail: `担当 ${e.active_tasks}件` }))}
        />
        <p className="px-1 text-center text-xs text-muted">{employees.length}名が在籍しています。タップすると、性格・得意なこと・チャットが見られます</p>
      </Page>
    </>
  );
}
