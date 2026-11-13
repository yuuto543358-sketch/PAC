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

/** 日本時間の時刻に合わせたあいさつ */
export function greeting(d: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hour12: false }).format(d)) % 24;
  if (h >= 4 && h < 11) return "おはようございます";
  if (h >= 11 && h < 18) return "こんにちは";
  return "こんばんは";
}

/** 日付の区切り表示用（今日・昨日・M月D日） */
export function dayLabel(d: Date | string): string {
  const fmt = (x: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(x);
  const target = fmt(new Date(d));
  const today = fmt(new Date());
  const yesterday = fmt(new Date(Date.now() - 86400000));
  if (target === today) return "今日";
  if (target === yesterday) return "昨日";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" }).format(new Date(d));
}

export function timeOnly(d: Date | string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}
