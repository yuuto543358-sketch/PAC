"use client";

import { useEffect } from "react";

/** オフライン時に「接続できません」画面を出すための仕組み（Service Worker）を登録します。 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
