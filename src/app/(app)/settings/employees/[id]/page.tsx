import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getEmployee } from "@/lib/repo/employees";
import { Page, PageHeader } from "@/components/ui";
import { EmployeeEditForm } from "./EmployeeEditForm";

export default async function EmployeeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = await getDb();
  const e = await getEmployee(sql, id);
  if (!e) notFound();
  return (
    <>
      <PageHeader title="社員情報の編集" subtitle={e.name} back="/settings" backLabel="設定" />
      <Page>
        <EmployeeEditForm
          e={{
            id: e.id,
            name: e.name,
            name_kana: e.name_kana,
            role_title: e.role_title,
            personality: e.personality,
            speaking_style: e.speaking_style,
            expertise: e.expertise.join("\n"),
            strengths: e.strengths.join("\n"),
            weaknesses: e.weaknesses.join("\n"),
            judgment_criteria: e.judgment_criteria,
            avatar_color: e.avatar_color,
            avatar_style: e.avatar_style,
            status: e.status,
          }}
          department={e.department_name}
          roleKey={e.role_key}
        />
      </Page>
    </>
  );
}
