import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getEmployee } from "@/lib/repo/employees";
import { getConversation, latestConversation, listConversations, listMessages } from "@/lib/repo/conversations";
import { getSettings } from "@/lib/repo/settings";
import { isAiConfigured } from "@/lib/ai/client";
import { dateTime, yenPrecise } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { PageHeader } from "@/components/ui";
import { ChatComposer, ScrollToBottom } from "./ChatComposer";

// AIの返事を待つ時間（秒）。AI呼び出し自体は90秒で打ち切ります。
export const maxDuration = 120;

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string; new?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const sql = await getDb();
  const e = await getEmployee(sql, id);
  if (!e) notFound();

  let conv = null;
  if (sp.c) {
    const c = await getConversation(sql, sp.c);
    if (c && c.employee_id === id) conv = c;
  } else if (!sp.new) {
    conv = await latestConversation(sql, id);
  }
  const [messages, conversations, settings] = await Promise.all([
    conv ? listMessages(sql, conv.id, 100) : Promise.resolve([]),
    listConversations(sql, id),
    getSettings(sql),
  ]);
  const aiReady = isAiConfigured();

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader
        title={e.name}
        subtitle={`${e.role_title}・${conv ? conv.title || "会話" : "新しい会話"}`}
        back={`/employees/${e.id}`}
        action={
          <Link href={`/employees/${e.id}/chat?new=1`} className="btn-secondary min-h-9 px-3 text-sm">
            新しい会話
          </Link>
        }
      />
      {conversations.length > 1 && (
        <div className="mx-auto w-full max-w-2xl overflow-x-auto px-4 pt-3">
          <div className="flex gap-2 pb-1">
            {conversations.slice(0, 10).map((c) => (
              <Link
                key={c.id}
                href={`/employees/${e.id}/chat?c=${c.id}`}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${conv?.id === c.id ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line bg-surface text-muted"}`}
              >
                {(c.title || "会話").slice(0, 14)}
              </Link>
            ))}
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 px-4 pt-4 pb-64">
        {messages.length === 0 && (
          <div className="card flex gap-3 p-4">
            <Avatar color={e.avatar_color} styleId={e.avatar_style} size={40} label={e.name} />
            <div className="text-sm">
              <p className="font-semibold">{e.name}</p>
              <p className="mt-1 text-ink/85">
                {e.role_key === "president"
                  ? "お疲れさまです。社長の天城です。お任せいただきたい仕事があれば、遠慮なくお申し付けください。必要な社員に割り当てて進めます。"
                  : `${e.role_title}の${e.name}です。ご用件をどうぞ。`}
              </p>
              <p className="mt-2 text-xs text-muted">※ この挨拶は固定文です（AIは呼び出していません）。</p>
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%]">
                <div className="rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-[15px] whitespace-pre-wrap text-brand-fg">{m.content}</div>
                <div className="mt-1 text-right text-[11px] text-muted">{dateTime(m.created_at)}</div>
              </div>
            </div>
          ) : m.role === "assistant" ? (
            <div key={m.id} className="flex gap-2">
              <Avatar color={e.avatar_color} styleId={e.avatar_style} size={34} label={e.name} />
              <div className="max-w-[85%] min-w-0">
                <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5 text-[15px] whitespace-pre-wrap">{m.content}</div>
                <div className="mt-1 text-[11px] text-muted">
                  {dateTime(m.created_at)}
                  {typeof m.meta.costJpy === "number" && ` ・ API ${yenPrecise(m.meta.costJpy)}`}
                </div>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-center">
              {m.meta.href ? (
                <Link
                  href={m.meta.href}
                  className={`max-w-[92%] rounded-xl px-3 py-2 text-center text-[13px] font-medium active:opacity-70 ${m.meta.tone === "warn" ? "bg-accent-soft text-accent" : m.meta.tone === "error" ? "bg-danger-soft text-danger" : "bg-info-soft text-brand"}`}
                >
                  {m.content} ›
                </Link>
              ) : (
                <div className={`max-w-[92%] rounded-xl px-3 py-2 text-center text-[13px] font-medium ${m.meta.tone === "error" ? "bg-danger-soft text-danger" : m.meta.tone === "warn" ? "bg-accent-soft text-accent" : "bg-info-soft text-brand"}`}>
                  {m.content}
                </div>
              )}
            </div>
          ),
        )}
        <ScrollToBottom count={messages.length} />
      </main>

      <ChatComposer
        employeeId={e.id}
        conversationId={conv?.id ?? null}
        disabledReason={!aiReady ? "OpenAI の APIキー（OPENAI_API_KEY）が未設定のため、まだ会話できません。Vercel の環境変数に追加してください（README 参照）。" : settings.emergency_stop ? "緊急停止中のため会話できません（設定画面で解除できます）。" : null}
        advancedAllowed={settings.advanced_model_allowed}
      />
    </div>
  );
}
