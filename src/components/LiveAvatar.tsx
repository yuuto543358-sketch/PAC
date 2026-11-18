"use client";

import { Avatar } from "./Avatar";
import { useLiveRunning, useLiveStatus } from "@/lib/live-status";
import { EMPLOYEE_STATUS_LABEL } from "@/lib/constants";
import type { EmployeeStatus } from "@/lib/avatar-videos";

/** 状態（待機中・考え中・作業中）が変わると、その場で動画と状態の点が切り替わるアイコン */
export function LiveAvatar(props: Omit<Parameters<typeof Avatar>[0], "status"> & { employeeId: string; status: EmployeeStatus }) {
  const { employeeId, status, ...rest } = props;
  const live = useLiveStatus(employeeId, status);
  return <Avatar {...rest} status={live} />;
}

/** 状態の文字（「待機中」など）。その場で切り替わる */
export function LiveStatusLabel({ employeeId, status }: { employeeId: string; status: EmployeeStatus }) {
  const live = useLiveStatus(employeeId, status);
  return <span data-live-status={live}>{EMPLOYEE_STATUS_LABEL[live]}</span>;
}

/** 「いま：〇〇」／「いまは待機中です。」（メディア事業での仕事）。その場で切り替わる */
export function LiveRunningLine({ employeeId, running }: { employeeId: string; running: string | null }) {
  const now = useLiveRunning(employeeId, running);
  return now ? (
    <>
      いま：<b>{now}</b>
    </>
  ) : (
    <>いまは待機中です。</>
  );
}
