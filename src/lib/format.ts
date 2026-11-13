// 表示用の書式（円・日時など）。日本時間で表示します。

export function yen(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v !== 0 && Math.abs(v) < 10) {
    return `${v.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}円`;
  }
  return `${Math.round(v).toLocaleString("ja-JP")}円`;
}

export function yenPrecise(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `${v.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}円`;
}

const dtf = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const df = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short" });

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dtf.format(new Date(d));
}

export function longDate(d: Date = new Date()): string {
  return df.format(d);
}

export function relativeTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}日前`;
  return dateTime(d);
}

export function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}
