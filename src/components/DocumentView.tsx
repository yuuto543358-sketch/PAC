// 成果物の本文を読みやすく表示する（見出し・箇条書き・表に対応した簡易表示）。
// 安全のため、HTMLとしては解釈せず文字として表示します。

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function DocumentView({ content, format }: { content: string; format: string }) {
  if (format === "csv_table") {
    const rows = parseCsv(content);
    if (rows.length > 0) {
      const [head, ...body] = rows;
      return (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[14px]">
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th key={i} className="border-b-2 border-line px-2 py-2 font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, i) => (
                <tr key={i} className="border-b border-separator">
                  {r.map((c, j) => (
                    <td key={j} className="px-2 py-2 align-top">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
  const lines = content.split("\n");
  return (
    <div className="space-y-1.5 text-[15px] leading-relaxed">
      {lines.map((line, i) => {
        const t = line.trimEnd();
        if (/^###\s+/.test(t)) return <h4 key={i} className="pt-2 text-[16px] font-bold">{t.replace(/^###\s+/, "")}</h4>;
        if (/^##\s+/.test(t)) return <h3 key={i} className="pt-3 text-[18px] font-bold">{t.replace(/^##\s+/, "")}</h3>;
        if (/^#\s+/.test(t)) return <h2 key={i} className="pt-1 text-[21px] font-bold tracking-tight">{t.replace(/^#\s+/, "")}</h2>;
        if (/^\s*[-*・]\s+/.test(t))
          return (
            <p key={i} className="flex gap-2 pl-1">
              <span className="text-brand">•</span>
              <span>{t.replace(/^\s*[-*・]\s+/, "")}</span>
            </p>
          );
        if (/^\s*-?\s*\[( |x)\]\s+/i.test(t)) {
          const checked = /\[x\]/i.test(t);
          return (
            <p key={i} className="flex gap-2 pl-1">
              <span>{checked ? "☑" : "☐"}</span>
              <span>{t.replace(/^\s*-?\s*\[( |x)\]\s+/i, "")}</span>
            </p>
          );
        }
        if (/^\s*\d+[.)]\s+/.test(t))
          return (
            <p key={i} className="pl-1">
              {t}
            </p>
          );
        if (!t) return <div key={i} className="h-2" />;
        return (
          <p key={i} className="whitespace-pre-wrap">
            {t.replace(/\*\*(.+?)\*\*/g, "$1")}
          </p>
        );
      })}
    </div>
  );
}
