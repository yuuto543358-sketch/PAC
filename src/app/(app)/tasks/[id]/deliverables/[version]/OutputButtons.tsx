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

/** note 記事（貼り付け用）を、note の入力欄ごとに分ける */
export function splitNoteArticle(content: string) {
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const price = content.match(/^値段[:：]\s*(.+)$/m)?.[1]?.trim() ?? "";
  const section = (name: string) => {
    const re = new RegExp(`^##\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m");
    return content.match(re)?.[1]?.trim() ?? "";
  };
  return { title, price, free: section("無料"), paid: section("有料"), tags: section("ハッシュタグ") };
}

/** note に貼り付けるためのボタン（タイトル・無料部分・有料部分・ハッシュタグを別々にコピー） */
export function NoteCopyButtons({ content }: { content: string }) {
  const parts = splitNoteArticle(content);
  const items = [
    { label: "タイトル", text: parts.title },
    { label: "無料部分", text: parts.free },
    { label: "有料部分", text: parts.paid },
    { label: "ハッシュタグ", text: parts.tags },
  ].filter((i) => i.text);
  if (items.length === 0) return null;
  return (
    <div className="space-y-2 rounded-[16px] bg-surface-2/70 p-3">
      <p className="text-[13px] font-semibold">note に貼る</p>
      <div className="grid grid-cols-2 gap-2">
        {items.map((i) => (
          <button
            key={i.label}
            type="button"
            className="btn-secondary px-2 text-[14px]"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(i.text);
                showToast(`${i.label}をコピーしました`);
              } catch {
                showToast("コピーできませんでした", "error");
              }
            }}
          >
            {i.label}をコピー
          </button>
        ))}
      </div>
      <a href="https://note.com/notes/new" target="_blank" rel="noopener noreferrer" className="btn-tinted w-full">
        note を開く（新しい記事）
      </a>
      <p className="text-xs text-muted">
        {parts.price && `値段：${parts.price}。`}noteで「有料エリア」の線を入れ、その下に有料部分を貼ってください。公開ボタンはあなたが押します。
      </p>
    </div>
  );
}

/** 「## 見出し」ごとに分ける（出品パッケージなど） */
export function splitSections(content: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  const re = /^##\s+(.+)$/gm;
  const marks = [...content.matchAll(re)];
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? content.length) : content.length;
    const body = content.slice(start, end).trim();
    if (body) out.push({ heading: m[1].trim(), body });
  });
  return out;
}

/** 出品パッケージ：見出しごとに「コピー」ボタン（そのまま売る場所に貼れる） */
export function SectionCopyButtons({ content }: { content: string }) {
  const sections = splitSections(content);
  if (sections.length === 0) return null;
  return (
    <div className="space-y-2 rounded-[16px] bg-surface-2/70 p-3">
      <p className="text-[13px] font-semibold">売る場所に貼る（見出しごとにコピー）</p>
      <div className="grid grid-cols-2 gap-2">
        {sections.map((s) => (
          <button
            key={s.heading}
            type="button"
            className="btn-secondary truncate px-2 text-[13px]"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(s.body);
                showToast(`「${s.heading}」をコピーしました`);
              } catch {
                showToast("コピーできませんでした", "error");
              }
            }}
          >
            {s.heading}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">「出品の手順」のとおりに進めて、出品したら事業の画面で「出品しました」を押してください。</p>
    </div>
  );
}
