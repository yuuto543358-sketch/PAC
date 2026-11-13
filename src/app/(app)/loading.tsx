/** 画面を切り替えた直後に、すぐ表示する「読み込み中」の形（中身が届くまでの仮の表示） */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="読み込み中">
      <div className="pt-safe h-12" />
      <div className="mx-auto max-w-2xl space-y-6 px-4 pt-2">
        <div className="skeleton h-9 w-40" />
        <div className="grid grid-cols-2 gap-3">
          <div className="skeleton h-24 rounded-[18px]" />
          <div className="skeleton h-24 rounded-[18px]" />
        </div>
        <div className="space-y-2.5">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-[72px] rounded-[18px]" />
          <div className="skeleton h-[72px] rounded-[18px]" />
          <div className="skeleton h-[72px] rounded-[18px]" />
        </div>
      </div>
    </div>
  );
}
