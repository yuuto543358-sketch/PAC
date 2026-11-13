// 同じ内容の業務を何度も登録しないための「似ている度合い」の計算。

/** 比較用に文字列を整える（全角半角・大文字小文字・空白・記号の違いを無視） */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 200);
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  if (s.length < 2) {
    if (s) m.set(s, 1);
    return m;
  }
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 0〜1 の類似度（1 = 同じ）。2文字ずつの組み合わせの重なりで計算（Dice係数） */
export function similarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const [, c] of ga) total += c;
  for (const [, c] of gb) total += c;
  for (const [g, c] of ga) overlap += Math.min(c, gb.get(g) ?? 0);
  return (2 * overlap) / total;
}

export const DUPLICATE_THRESHOLD = 0.8;

export function findDuplicate<T extends { title: string }>(title: string, candidates: T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = similarity(title, c.title);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return bestScore >= DUPLICATE_THRESHOLD ? best : null;
}
