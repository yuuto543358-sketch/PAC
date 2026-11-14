// 生活情報のグラフ（1項目の変化）。1本の線（いまの状態の変化）か、棒（月や週ごとの記録）で表す。
// 1つの系列だけなので凡例は置かず、見出しで何のグラフかを示す。下の記録の一覧が「表」の役割をする。

type Point = { label: string; value: number };

const W = 320;
const H = 150;
const PAD = { top: 18, right: 14, bottom: 22, left: 40 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function short(n: number) {
  if (n >= 10000) return `${Math.round(n / 1000) / 10}万`;
  return n.toLocaleString("ja-JP");
}

export function LifeChart({ points, kind, unit, title }: { points: Point[]; kind: "line" | "bar"; unit: string; title: string }) {
  if (points.length === 0) return null;
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const last = points[points.length - 1];
  const barW = Math.max(6, Math.min(26, iw / points.length - 6));
  const bx = (i: number) => PAD.left + (iw / points.length) * (i + 0.5);
  const labelEvery = Math.ceil(points.length / 6);
  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[12px] font-semibold text-muted">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${title}のグラフ。最新は${short(last.value)}${unit}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--separator)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={9} fill="var(--faint)">
              {short(t)}
            </text>
          </g>
        ))}
        {kind === "bar"
          ? points.map((p, i) => {
              const h = Math.max(1, (p.value / max) * ih);
              const top = PAD.top + ih - h;
              const r = Math.min(4, barW / 2, h);
              return (
                <path
                  key={i}
                  d={`M${bx(i) - barW / 2},${PAD.top + ih} V${top + r} Q${bx(i) - barW / 2},${top} ${bx(i) - barW / 2 + r},${top} H${bx(i) + barW / 2 - r} Q${bx(i) + barW / 2},${top} ${bx(i) + barW / 2},${top + r} V${PAD.top + ih} Z`}
                  fill="var(--brand)"
                >
                  <title>{`${p.label}：${short(p.value)}${unit}`}</title>
                </path>
              );
            })
          : (
            <>
              <polyline
                points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
                fill="none"
                stroke="var(--brand)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p.value)} r={4} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2}>
                  <title>{`${p.label}：${short(p.value)}${unit}`}</title>
                </circle>
              ))}
            </>
          )}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={i} x={kind === "bar" ? bx(i) : x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--faint)">
              {p.label}
            </text>
          ) : null,
        )}
        <text
          x={Math.min(W - PAD.right, (kind === "bar" ? bx(points.length - 1) : x(points.length - 1)) + 0)}
          y={Math.max(10, y(last.value) - 8)}
          textAnchor="end"
          fontSize={10}
          fontWeight={700}
          fill="var(--ink)"
        >
          {short(last.value)}
          {unit.startsWith("円") ? "円" : unit}
        </text>
      </svg>
    </figure>
  );
}
