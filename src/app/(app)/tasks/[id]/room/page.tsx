import Link from "next/link";
import { SourceList } from "@/components/SourceList";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getTask } from "@/lib/repo/tasks";
import { getWorkflow, listDeliverables, listMembers, listRoomMessages, type RoomMessage } from "@/lib/workflow/repo";
import { nextSpeakerId } from "@/lib/workflow/engine";
import { getSettings } from "@/lib/repo/settings";
import {
  ACTIVE_WORKFLOW_PHASES,
  DELIVERABLE_FORMATS,
  DELIVERABLE_STATUS_LABEL,
  MEMBER_ROLE_LABEL,
  ROOM_MESSAGE_KIND_LABEL,
  WORKFLOW_PHASE_LABEL,
  modelName,
} from "@/lib/constants";
import { dayLabel, timeOnly, yenPrecise } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import { RoomClient, RoomScroll } from "./RoomClient";
import { StartTeamButton } from "../team-forms";

// チームの作業を待つ時間（秒）
export const maxDuration = 300;

const KIND_TONE: Record<string, string> = {
  plan: "bg-brand-soft text-brand",
  proposal: "bg-info-soft text-brand",
  opinion: "bg-surface-2 text-muted",
  findings: "bg-success-soft text-success",
  question: "bg-accent-soft text-accent",
  question_to_owner: "bg-accent text-white",
  deliverable: "bg-success text-white",
  review: "bg-accent-soft text-accent",
  decision: "bg-brand text-brand-fg",
  report: "bg-brand text-brand-fg",
  instruction: "bg-danger-soft text-danger",
};

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = await getDb();
  const task = await getTask(sql, id);
  if (!task) notFound();
  const [wf, members, messages, deliverables, settings] = await Promise.all([
    getWorkflow(sql, id),
    listMembers(sql, id),
    listRoomMessages(sql, id, 200),
    listDeliverables(sql, id),
    getSettings(sql),
  ]);
  const [pendingAcceptance] = await sql<{ id: string }[]>`
    select id from approvals where task_id = ${id} and action_type = 'accept_deliverable' and status in ('pending','on_hold')
    order by created_at desc limit 1`;
  const roleOf = new Map(members.map((m) => [m.employee_id, m.role]));
  const stoppedTask = ["on_hold", "rejected", "failed", "completed"].includes(task.status);
  const active = Boolean(wf && wf.autopilot && ACTIVE_WORKFLOW_PHASES.includes(wf.phase) && !stoppedTask);
  const speakerId = wf ? nextSpeakerId(wf, members) : null;
  const speaker = members.find((m) => m.employee_id === speakerId) ?? null;
  const dayLabels = messages.map((m) => dayLabel(m.created_at));
  const lastId = messages.at(-1)?.id ?? 0;

  const formatLabel = (f: string) => DELIVERABLE_FORMATS.find((x) => x.id === f)?.label ?? f;

  const renderMessage = (m: RoomMessage) => {
    if (m.author_type === "system") {
      const tone = m.meta.tone === "error" ? "text-danger" : m.meta.tone === "warn" ? "text-accent" : "text-muted";
      return (
        <div className="flex justify-center px-4">
          <p className={`max-w-[92%] rounded-[12px] bg-surface-3/70 px-3 py-1.5 text-center text-[12px] leading-snug ${tone}`}>{m.content}</p>
        </div>
      );
    }
    if (m.author_type === "owner") {
      return (
        <div className="flex justify-end">
          <div className="flex max-w-[82%] flex-col items-end">
            <span className="mb-1 pr-1 text-[11px] font-semibold text-muted">あなた（経営者）・指示</span>
            <div className="rounded-[20px] rounded-br-[6px] bg-brand px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-brand-fg shadow-card">
              {m.content}
            </div>
            <span className="mt-1 pr-1 text-[11px] text-faint">{timeOnly(m.created_at)}</span>
          </div>
        </div>
      );
    }
    const role = m.employee_id ? roleOf.get(m.employee_id) : undefined;
    const del = m.meta.deliverableVersion ? deliverables.find((d) => d.version === m.meta.deliverableVersion) : undefined;
    return (
      <div className="flex items-start gap-2">
        <Avatar color={m.avatar_color ?? "#64748b"} styleId={m.avatar_style ?? "short"} size={34} label={m.employee_name ?? "社員"} />
        <div className="flex max-w-[84%] min-w-0 flex-col items-start">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 pl-1">
            <span className="text-[12px] font-semibold" style={{ color: m.avatar_color ?? undefined }}>
              {m.employee_name}
            </span>
            {role && <span className="text-[11px] text-muted">{MEMBER_ROLE_LABEL[role]}</span>}
            <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${KIND_TONE[m.kind] ?? "bg-surface-2 text-muted"}`}>
              {ROOM_MESSAGE_KIND_LABEL[m.kind] ?? m.kind}
            </span>
          </div>
          <div
            className={`rounded-[20px] rounded-tl-[6px] bg-surface px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-card ring-1 ${
              m.kind === "question_to_owner" ? "ring-accent" : "ring-line/60"
            }`}
          >
            {m.content}
          </div>
          {m.meta.sources && m.meta.sources.length > 0 && <SourceList sources={m.meta.sources} className="mt-2 w-full max-w-sm" />}
          {del && (
            <Link
              href={`/tasks/${task.id}/deliverables/${del.version}`}
              className="press mt-2 flex w-full max-w-sm items-center gap-3 rounded-[16px] bg-surface p-3 shadow-card ring-1 ring-line/60"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-success text-white">
                <Icon name="document" size={22} stroke={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{del.title}</span>
                <span className="block text-[12px] text-muted">
                  第{del.version}版・{formatLabel(del.format)}・{DELIVERABLE_STATUS_LABEL[del.status] ?? del.status}
                </span>
              </span>
              <Icon name="chevronRight" size={16} stroke={2.4} className="text-faint" />
            </Link>
          )}
          <span className="mt-1 pl-1 text-[11px] text-faint">
            {timeOnly(m.created_at)}
            {typeof m.meta.costJpy === "number" && ` ・ API ${yenPrecise(m.meta.costJpy)}`}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-30 bg-[var(--bar)] shadow-[0_0.5px_0_var(--separator)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto grid h-14 max-w-2xl grid-cols-[auto_1fr_auto] items-center gap-1 px-2">
          <Link href={`/tasks/${task.id}`} className="press flex h-11 w-11 items-center justify-center text-brand" aria-label="業務の詳細へ戻る">
            <Icon name="chevronLeft" size={28} stroke={2.4} />
          </Link>
          <div className="min-w-0 text-center">
            <h1 className="truncate text-[15px] leading-tight font-semibold">{task.title}</h1>
            <p className="truncate text-[11px] text-muted">
              チームのグループチャット{wf ? `・${WORKFLOW_PHASE_LABEL[wf.phase]}${!wf.autopilot ? "（一時停止中）" : ""}` : ""}
            </p>
          </div>
          <div className="flex -space-x-2 pr-2">
            {members
              .filter((m) => m.role !== "ceo")
              .slice(0, 3)
              .map((m) => (
                <span key={m.employee_id} className="rounded-full ring-2 ring-[var(--surface)]">
                  <Avatar color={m.avatar_color} styleId={m.avatar_style} size={28} label={m.name} />
                </span>
              ))}
          </div>
        </div>
        {wf && (
          <div className="mx-auto max-w-2xl px-3 pb-2">
            <WorkflowStepper phase={wf.phase} resumePhase={wf.resume_phase} compact />
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 px-3 pt-4 pb-56">
        {!wf ? (
          <div className="card mx-auto max-w-sm p-5 text-center">
            <p className="text-[15px] font-semibold">この業務にはまだチームがありません</p>
            <p className="mt-1 text-[13px] text-muted">社長がチームを編成し、議論・成果物の作成・監査・報告まで自動で進めます。</p>
            <div className="mt-4">
              <StartTeamButton taskId={task.id} />
            </div>
          </div>
        ) : (
          <>
            {members.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5 pb-1">
                {members.map((m) => (
                  <span key={m.employee_id} className="inline-flex items-center gap-1.5 rounded-full bg-surface py-0.5 pr-2.5 pl-0.5 text-[12px] shadow-card ring-1 ring-line/60">
                    <Avatar color={m.avatar_color} styleId={m.avatar_style} size={22} label={m.name} />
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted">{MEMBER_ROLE_LABEL[m.role]}</span>
                  </span>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={m.id} className="space-y-3">
                {(i === 0 || dayLabels[i] !== dayLabels[i - 1]) && (
                  <div className="flex justify-center pt-1">
                    <span className="rounded-full bg-surface-3/80 px-3 py-0.5 text-[11px] font-medium text-muted">{dayLabels[i]}</span>
                  </div>
                )}
                {renderMessage(m)}
              </div>
            ))}
            {wf.phase === "waiting_human" && (
              <div className="card mx-auto max-w-md border-l-4 border-l-accent p-4">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-accent">
                  <Icon name="bell" size={18} stroke={2} />
                  {wf.waiting_reason === "acceptance"
                    ? "成果物の確認をお願いします"
                    : wf.waiting_reason === "question"
                      ? "チームから質問があります"
                      : "チームが一時停止しています"}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  {wf.waiting_reason === "acceptance"
                    ? "承認すると業務が完了します。直してほしい点がある場合は、承認画面で差し戻すか、下の欄で指示を送ってください。"
                    : wf.waiting_reason === "question"
                      ? "下の欄で答えを送ると、チームが作業を再開します。"
                      : "業務の予算を増やすか、下の欄で指示を送ると再開します。"}
                </p>
                {wf.waiting_reason === "acceptance" && pendingAcceptance && (
                  <Link href={`/approvals/${pendingAcceptance.id}`} className="btn-primary mt-3 w-full">
                    承認画面を開く
                  </Link>
                )}
              </div>
            )}
          </>
        )}
        <RoomScroll lastId={lastId} />
      </main>

      {wf && (
        <RoomClient
          taskId={task.id}
          active={active}
          lastMessageId={lastId}
          phase={wf.phase}
          autopilot={wf.autopilot}
          speaker={speaker ? { name: speaker.name, color: speaker.avatar_color, style: speaker.avatar_style } : null}
          canResume={!wf.autopilot || wf.phase === "stopped"}
          modelLabel={modelName(settings.model_standard)}
        />
      )}
    </div>
  );
}
