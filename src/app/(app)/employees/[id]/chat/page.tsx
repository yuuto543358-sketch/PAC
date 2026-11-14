import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getEmployee } from "@/lib/repo/employees";
import { getConversation, latestConversation, listConversations, listMessages, type ChatMessage } from "@/lib/repo/conversations";
import { getSettings } from "@/lib/repo/settings";
import { isAiConfigured } from "@/lib/ai/client";
import { modelName } from "@/lib/constants";
import { dayLabel, timeOnly, yenPrecise } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Icon, type IconName } from "@/components/Icon";
import { ChatComposer, ScrollToBottom } from "./ChatComposer";

// AIの返事を待つ時間（秒）。AI呼び出し自体は90秒で打ち切ります。
export const maxDuration = 300;

const SUGGESTIONS: Record<string, string[]> = {
  president: [
    "最近の暮らしで、改善できそうなことはありますか？",
    "低コストで始められる副業のアイデアを調べる業務をお願いします",
    "今の会社の状況を教えてください",
    "今週、優先してやるべきことは何ですか？",
  ],
  bizdev: ["少額で試せるデジタル商品のアイデアを3つ考えてください", "個人でも始めやすいビジネスの条件は？"],
  research: ["調べてほしいことがあります。何から決めればいいですか？", "信頼できる情報の見分け方を教えて"],
  creative: ["簡単な商品紹介文のたたき台を作ってください", "使いやすい資料の作り方を教えて"],
  secretary: ["今週のやることを整理してください", "毎朝確認したほうがいいことは？"],
  finance: ["今月のAPI費用の使い方は適切ですか？", "小さく始める事業で注意すべきリスクは？"],
  life: ["固定費で見直せそうなところはある？", "最近の暮らしで気になることを一緒に整理して", "いまの情報で分かることを教えて"],
};

function NoticeCard({ m }: { m: ChatMessage }) {
  const kind = m.meta.kind ?? "";
  const icon: IconName =
    kind === "task_created" ? "tasks" : kind === "task_duplicate" ? "info" : kind === "approval_created" ? "approve" : "alert";
  const tone =
    m.meta.tone === "warn" ? "bg-accent-soft text-accent" : m.meta.tone === "error" ? "bg-danger-soft text-danger" : "bg-info-soft text-brand";
  const body = (
    <div className={`flex items-start gap-2.5 rounded-[16px] px-3.5 py-2.5 text-left text-[13px] leading-snug font-medium ${tone}`}>
      <Icon name={icon} size={18} stroke={2} className="mt-px shrink-0" />
      <span className="min-w-0 flex-1">{m.content}</span>
      {m.meta.href && <Icon name="chevronRight" size={16} stroke={2.4} className="mt-0.5 shrink-0 opacity-70" />}
    </div>
  );
  return (
    <div className="mx-auto max-w-[92%]">
      {m.meta.href ? (
        <Link href={m.meta.href} className="press block">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

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

  // 日付が変わるところに区切りを入れる
  const dayLabels = messages.map((m) => dayLabel(m.created_at));
  const showSeparator = dayLabels.map((d, i) => i === 0 || d !== dayLabels[i - 1]);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-30 bg-[var(--bar)] shadow-[0_0.5px_0_var(--separator)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto grid h-14 max-w-2xl grid-cols-[auto_1fr_auto] items-center gap-1 px-2">
          <Link href={`/employees/${e.id}`} className="press flex h-11 w-11 items-center justify-center text-brand" aria-label="戻る">
            <Icon name="chevronLeft" size={28} stroke={2.4} />
          </Link>
          <Link href={`/employees/${e.id}`} className="flex min-w-0 items-center justify-center gap-2">
            <Avatar color={e.avatar_color} styleId={e.avatar_style} size={34} status={e.status} label={e.name} />
            <div className="min-w-0 text-left">
              <h1 className="truncate text-[15px] leading-tight font-semibold">{e.name}</h1>
              <p className="truncate text-[11px] text-muted">{e.role_title}</p>
            </div>
          </Link>
          <Link
            href={`/employees/${e.id}/chat?new=1`}
            className="press flex h-11 items-center gap-1 rounded-full px-3 text-[14px] font-semibold text-brand"
            aria-label="新しい会話"
          >
            <Icon name="edit" size={20} stroke={2} />
            <span className="sr-only sm:not-sr-only">新しい会話</span>
          </Link>
        </div>
        {conversations.length > 1 && (
          <div className="mx-auto max-w-2xl overflow-x-auto px-3 pb-2">
            <div className="flex gap-1.5">
              {conversations.slice(0, 10).map((c) => (
                <Link
                  key={c.id}
                  href={`/employees/${e.id}/chat?c=${c.id}`}
                  className={`shrink-0 rounded-full px-3 py-1 text-[12px] ${conv?.id === c.id ? "bg-brand font-semibold text-brand-fg" : "bg-surface-3 text-muted"}`}
                >
                  {(c.title || "会話").slice(0, 14)}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-2.5 px-3 pt-4 pb-48">
        {messages.length === 0 && (
          <div className="fade-up flex flex-col items-center px-4 pt-6 pb-2 text-center">
            <Avatar color={e.avatar_color} styleId={e.avatar_style} size={84} label={e.name} />
            <p className="mt-3 text-[18px] font-bold">{e.name}</p>
            <p className="text-[13px] text-muted">{e.role_title}・{e.department_name}</p>
            <p className="mt-4 max-w-sm rounded-[18px] bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink/85 shadow-card ring-1 ring-line/60">
              {e.role_key === "president"
                ? "お疲れさまです。社長の天城です。お任せいただきたい仕事があれば、遠慮なくお申し付けください。必要な社員に割り当てて進めます。"
                : `${e.role_title}の${e.name}です。ご用件をどうぞ。`}
            </p>
            <p className="mt-2 text-[11px] text-faint">※ この挨拶は固定文です（AIは呼び出していません）</p>
          </div>
        )}
        {messages.map((m, i) => {
          const day = dayLabels[i];
          const sep = showSeparator[i];
          return (
            <div key={m.id} className="space-y-2.5">
              {sep && (
                <div className="flex justify-center pt-2">
                  <span className="rounded-full bg-surface-3/80 px-3 py-0.5 text-[11px] font-medium text-muted">{day}</span>
                </div>
              )}
              {m.role === "user" ? (
                <div className="flex justify-end">
                  <div className="flex max-w-[82%] flex-col items-end">
                    <div className="rounded-[20px] rounded-br-[6px] bg-brand px-3.5 py-2.5 text-[16px] leading-relaxed whitespace-pre-wrap text-brand-fg shadow-card">
                      {m.content}
                    </div>
                    <div className="mt-1 pr-1 text-[11px] text-faint">{timeOnly(m.created_at)}</div>
                  </div>
                </div>
              ) : m.role === "assistant" ? (
                <div className="flex items-end gap-2">
                  <Avatar color={e.avatar_color} styleId={e.avatar_style} size={30} label={e.name} />
                  <div className="flex max-w-[82%] min-w-0 flex-col items-start">
                    <div className="rounded-[20px] rounded-bl-[6px] bg-surface px-3.5 py-2.5 text-[16px] leading-relaxed whitespace-pre-wrap shadow-card ring-1 ring-line/60">
                      {m.content}
                    </div>
                    <div className="mt-1 pl-1 text-[11px] text-faint">
                      {timeOnly(m.created_at)}
                      {typeof m.meta.costJpy === "number" && ` ・ API ${yenPrecise(m.meta.costJpy)}`}
                    </div>
                  </div>
                </div>
              ) : (
                <NoticeCard m={m} />
              )}
            </div>
          );
        })}
        <ScrollToBottom count={messages.length} />
      </main>

      <ChatComposer
        employeeId={e.id}
        conversationId={conv?.id ?? null}
        employee={{ name: e.name, color: e.avatar_color, style: e.avatar_style }}
        suggestions={messages.length === 0 ? (SUGGESTIONS[e.role_key] ?? []) : []}
        disabledReason={
          !aiReady
            ? "OpenAI の APIキー（OPENAI_API_KEY）が未設定のため、まだ会話できません。Vercel の環境変数に追加してください（README 参照）。"
            : settings.emergency_stop
              ? "緊急停止中のため会話できません（設定画面で解除できます）。"
              : null
        }
        advancedAllowed={settings.advanced_model_allowed}
        modelLabel={modelName(settings.model_standard)}
        advancedModelLabel={modelName(settings.model_advanced)}
      />
    </div>
  );
}
