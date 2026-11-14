import "server-only";
import type { Db } from "@/lib/db";
import { SNS_PLATFORM_LABEL } from "@/lib/constants";
import { isMockMode } from "@/lib/ai/client";
import { isPlatformConfigured, platformOf, postTo } from "./post";

type ApprovalLike = {
  action_type: string;
  content: string;
  destination: string;
  payload: Record<string, unknown> | null;
};
type Executor = (a: ApprovalLike) => Promise<{ summary: string }>;

/**
 * 承認済みの操作を、アプリが実行できるかを決める。
 * いまアプリが実行できるのは「SNSへの投稿」だけ（そのSNSの鍵が設定されているとき）。
 * - null: 実行の仕組みがない（経営者が自分で行う）
 * - { blocked }: 実行できるが、上限などで止める
 */
export async function defaultExecutorFor(
  db: Db,
  a: ApprovalLike,
): Promise<{ executor: Executor } | { blocked: string } | null> {
  if (a.action_type !== "sns_post") return null;
  const platform = platformOf(a);
  if (!platform || !isPlatformConfigured(platform)) return null;
  const [s] = await db<{ limit: number; used: number }[]>`
    select (select sns_monthly_post_limit from company_settings where id = 1) as limit,
      (select count(*)::int from approvals
        where action_type = 'sns_post' and status in ('executing','executed')
          and executed_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') as used`;
  if (s && s.used >= s.limit) {
    return { blocked: `今月のSNS投稿の上限（${s.limit}回）に達しています。設定で上限を変えられます` };
  }
  return {
    executor: async (x) => {
      // テスト用モードでは、本物のSNSには投稿しない
      if (isMockMode()) return { summary: `（テスト用）${SNS_PLATFORM_LABEL[platform]}に投稿したことにしました https://example.com/mock-post` };
      const r = await postTo(platform, x.content);
      return { summary: `${SNS_PLATFORM_LABEL[platform]}に投稿しました ${r.url}` };
    },
  };
}
