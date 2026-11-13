// アプリ全体で使うアイコン（線画）。画像ファイルを使わず SVG で描くので、どの大きさでもくっきり表示されます。

const PATHS = {
  home: "M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z",
  users: "M16 19v-1.2c0-2-1.8-3.3-4-3.3s-4 1.3-4 3.3V19M12 11.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5M18.5 18.5v-.8c0-1.3-.8-2.4-2-2.9M16.4 5.3a3 3 0 0 1 0 5.9M5.5 18.5v-.8c0-1.3.8-2.4 2-2.9M7.6 5.3a3 3 0 0 0 0 5.9",
  tasks: "M9 6.5h11M9 12h11M9 17.5h11M4 6.5l1 1 2-2M4 12l1 1 2-2M4 17.5l1 1 2-2",
  approve: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 12.2l2.7 2.7L16 9.6",
  menu: "M4 7h16M4 12h16M4 17h16",
  chat: "M20 12c0 4-3.6 7-8 7-1.2 0-2.3-.2-3.3-.6L4 19.5l1.2-3.6C4.4 14.8 4 13.4 4 12c0-4 3.6-7 8-7s8 3 8 7",
  plus: "M12 5v14M5 12h14",
  chevronRight: "M9.5 6l6 6-6 6",
  chevronLeft: "M14.5 6l-6 6 6 6",
  wallet: "M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 7.5A1.5 1.5 0 0 0 5.5 9H20v6h-4a2 2 0 0 1 0-4h4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.1a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.6 9.3l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.1a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4",
  briefcase: "M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 12.5h16M10.5 12.5v1.5h3v-1.5",
  report: "M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5M14 3.5V8h4M9 12.5h6M9 16h6",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  sparkles: "M12 3.5l1.6 4.4L18 9.5l-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6zM18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7.5V12l3 2",
  alert: "M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.3",
  send: "M5 12 4 4.5l16 7.5-16 7.5zM5 12h7",
  filter: "M4 6h16M7 12h10M10 18h4",
  star: "M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z",
  shield: "M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z",
  power: "M12 4v7M7.2 6.8a7 7 0 1 0 9.6 0",
  logout: "M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h9",
  building: "M5 20.5V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5v15M15 9.5h3A1.5 1.5 0 0 1 19.5 11v9.5M3 20.5h18M8.5 8h3M8.5 11.5h3M8.5 15h3",
  document: "M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 1-.5M14 3.5V8h4",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  trend: "M4 17l5-5 4 4 7-8M15 8h5v5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  inbox: "M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13.5h4.5l1.5 2.5h4l1.5-2.5H20",
  history: "M4 12a8 8 0 1 0 2.4-5.7M4 4.5v3.5h3.5M12 8v4l2.5 2",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5.5M12 7.8v.3",
  lock: "M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13v10h-13zM12 14.5v2.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 22,
  stroke = 1.8,
  className,
  filled = false,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  /** 選択中の表示（塗りつぶし）にする */
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      fillOpacity={filled ? 0.16 : undefined}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
