import "server-only";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { createStepLogger } from "@/lib/log";
import { dispatchNotifications } from "./index";

/** 画面に結果を返したあとで、順番待ちの通知を送る */
export function kickNotifications() {
  after(async () => {
    try {
      await dispatchNotifications(await getDb());
    } catch (err) {
      createStepLogger("push-bg").fail("dispatch", err);
    }
  });
}
