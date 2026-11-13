"use client";

import { Icon } from "@/components/Icon";
import { showToast } from "@/components/Toaster";

/** 成果物の出力（コピー・ファイルとして保存）。どちらも端末の中だけの操作で、外部には送信しません。 */
export function OutputButtons({ content, filename, mime }: { content: string; filename: string; mime: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        className="btn-tinted"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(content);
            showToast("コピーしました");
          } catch {
            showToast("コピーできませんでした", "error");
          }
        }}
      >
        <Icon name="document" size={18} stroke={2} />
        コピー
      </button>
      <button
        type="button"
        className="btn-secondary px-3"
        onClick={() => {
          const bom = mime === "text/csv" ? "﻿" : "";
          const blob = new Blob([bom + content], { type: `${mime};charset=utf-8` });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          showToast("ファイルとして保存しました");
        }}
      >
        <Icon name="inbox" size={18} stroke={2} />
        <span className="whitespace-nowrap">ファイルで保存</span>
      </button>
    </div>
  );
}
