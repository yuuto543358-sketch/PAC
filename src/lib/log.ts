// 処理の流れを Vercel のログ（Logs 画面）に出すための小さな道具。
// 秘密情報（パスワード・APIキー・接続文字列）は絶対に出さないこと。

export type StepLogger = {
  id: string;
  step: (name: string, extra?: Record<string, unknown>) => void;
  fail: (name: string, err: unknown, extra?: Record<string, unknown>) => void;
};

function errInfo(err: unknown) {
  if (err && typeof err === "object") {
    const e = err as { name?: string; code?: string; message?: string };
    return { error: e.name ?? "Error", code: e.code, message: (e.message ?? "").slice(0, 300) };
  }
  return { error: String(err).slice(0, 300) };
}

export function createStepLogger(scope: string): StepLogger {
  const id = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  const fmt = (extra?: Record<string, unknown>) => (extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "");
  return {
    id,
    step(name, extra) {
      console.log(`[pac][${scope}][${id}] ${name} +${Date.now() - t0}ms${fmt(extra)}`);
    },
    fail(name, err, extra) {
      console.error(`[pac][${scope}][${id}] FAILED ${name} +${Date.now() - t0}ms${fmt({ ...extra, ...errInfo(err) })}`);
    },
  };
}

export class TimeoutError extends Error {
  constructor(public readonly label: string, ms: number) {
    super(`${label} が ${Math.round(ms / 1000)} 秒以内に終わりませんでした`);
    this.name = "TimeoutError";
  }
}

/** 一定時間で終わらない処理をエラーにする（無限に待たないため） */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
