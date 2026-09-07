export type CashFlowReportOrientation = "landscape" | "portrait";
export type ReportCardSize = { id: string; height: number; span: number; preferRight?: boolean };
export type ReportCardPlacement = ReportCardSize & { column: number; y: number; width: number };

/** Place each measured card into the lowest available run of columns. Charts are
 * first-class cards, so a long list cannot force every chart below its last row. */
export function packCashFlowReportCards(cards: ReportCardSize[], columns: number, columnWidth: number, gap: number) {
  const heights = Array<number>(columns).fill(0);
  const placements: ReportCardPlacement[] = [];
  for (const card of cards) {
    if (card.span < 1 || card.span > columns || card.height <= 0) throw new Error("Invalid cash flow report card dimensions");
    let chosenColumn = 0;
    let chosenY = Infinity;
    let bestScore = Infinity;
    for (let column = 0; column <= columns - card.span; column++) {
      const y = Math.max(...heights.slice(column, column + card.span));
      const wasted = heights.slice(column, column + card.span).reduce((sum, height) => sum + y - height, 0);
      const score = y + wasted * 0.3;
      if (score < bestScore || (score === bestScore && card.preferRight)) {
        chosenColumn = column; chosenY = y; bestScore = score;
      }
    }
    placements.push({ ...card, column: chosenColumn, y: chosenY, width: columnWidth * card.span + gap * (card.span - 1) });
    for (let column = chosenColumn; column < chosenColumn + card.span; column++) heights[column] = chosenY + card.height + gap;
  }
  return { placements, height: Math.max(...heights) - gap };
}

/** Keep every row and split only between rows. The caller measures real text,
 * including wrapping and per-card headings, before committing each partition. */
export function splitCashFlowReportRows<T>(rows: T[], maximumHeight: number, measure: (rows: T[]) => number): T[][] {
  if (!rows.length) return [[]];
  const chunks: T[][] = [];
  let current: T[] = [];
  for (const row of rows) {
    if (current.length && measure([...current, row]) > maximumHeight) { chunks.push(current); current = []; }
    current.push(row);
  }
  if (current.length) chunks.push(current);
  // Balance a short final continuation against its preceding card.
  for (let index = chunks.length - 1; index > 0; index--) {
    const previous = chunks[index - 1];
    const next = chunks[index];
    while (previous.length > 1) {
      const moved = previous[previous.length - 1];
      const nextHeight = measure([moved, ...next]);
      if (nextHeight > maximumHeight || measure(previous.slice(0, -1)) < nextHeight) break;
      previous.pop(); next.unshift(moved);
    }
  }
  return chunks;
}

export function cashFlowReportLayoutScore(width: number, height: number, orientation: CashFlowReportOrientation) {
  const ratio = width / height;
  const target = orientation === "landscape" ? 1.65 : 0.72;
  const wrongOrientation = orientation === "landscape" ? ratio < 1.2 : ratio > 0.85;
  return width * height * (1 + Math.abs(Math.log(ratio / target)) * 0.7 + (wrongOrientation ? 5 : 0));
}
