/**
 * Geometry for one page, a pure function of the page size. Port of `PageLayout.swift` from
 * the vertical-bar design (iOS commit dc8699c), plus the web's typed-guess controls row.
 *
 * Nothing is measured at runtime: the pointer classifier needs the bar's position to decide
 * what a drag grabbed, and deriving it arithmetically keeps that decision off the DOM. It
 * also means the board sits at the same place on every page, so paging never nudges it.
 *
 *   title (3 reserved lines)
 *   board ──gap── bar        the bar is as tall as the board, Black on top
 *   [ eval box ][ Submit ]   spans the board and the bar
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PageLayout {
  readonly pageW: number;
  readonly pageH: number;
  readonly titleLineHeight: number;
  readonly title: Rect;
  readonly stats: Rect;
  readonly board: Rect;
  readonly bar: Rect;
  readonly barCenterX: number;
  readonly controls: Rect;
  readonly input: Rect;
  readonly submit: Rect;
}

export const SIZES = {
  margin: 18,
  top: 14,
  bottom: 14,
  barWidth: 24,
  bubbleW: 66,
  bubbleH: 30,
  hitW: 110,
  hitH: 52,
  titleLines: 3,
  titlePad: 16,
  controlsGap: 16,
  controlsH: 52,
  inputW: 140,
  inputGap: 10,
  statsW: 52,
  statsH: 32,
} as const;

/** Wide enough that a bubble centred on the bar never crosses the board's edge. */
export const BAR_GAP = Math.max(14, SIZES.bubbleW / 2 - SIZES.barWidth / 2);
/** Clearance right of the bar so the bubble never touches the page edge. */
export const TRAILING = SIZES.bubbleW / 2 - SIZES.barWidth / 2 + 8;

export function computeLayout(pageW: number, pageH: number, titleLineHeight = 18): PageLayout {
  const S = SIZES;
  const titleHeight = titleLineHeight * S.titleLines;
  const fixedHeight = S.top + titleHeight + S.titlePad + S.controlsGap + S.controlsH + S.bottom;
  const widthBudget = Math.max(0, pageW - 2 * S.margin - BAR_GAP - S.barWidth - TRAILING);
  const heightBudget = Math.max(0, pageH - fixedHeight);
  // A multiple of 8, so every square is a whole number of pixels and edges stay crisp.
  const boardSide = Math.floor(Math.min(widthBudget, heightBudget) / 8) * 8;
  const blockW = boardSide + BAR_GAP + S.barWidth;

  // Board and bar are centred as one block when the page has slack in either direction.
  const boardX = Math.round(S.margin + (widthBudget - boardSide) / 2);
  // Slack is split 40/60, so on a tall phone the board sits a little above centre, near the thumb.
  const offsetY = Math.max(0, Math.floor((pageH - fixedHeight - boardSide) * 0.4));
  const titleY = S.top + offsetY;
  const boardY = titleY + titleHeight + S.titlePad;
  const barX = boardX + boardSide + BAR_GAP;
  const controlsY = boardY + boardSide + S.controlsGap;

  const stats: Rect = {
    x: pageW - S.margin - S.statsW,
    y: S.top - 8,
    width: S.statsW,
    height: S.statsH,
  };
  const titleW = Math.max(0, Math.min(blockW, stats.x - 8 - boardX));
  const inputW = Math.min(S.inputW, Math.max(0, Math.floor(blockW * 0.5)));

  return {
    pageW,
    pageH,
    titleLineHeight,
    title: { x: boardX, y: titleY, width: titleW, height: titleHeight },
    stats,
    board: { x: boardX, y: boardY, width: boardSide, height: boardSide },
    bar: { x: barX, y: boardY, width: S.barWidth, height: boardSide },
    barCenterX: barX + S.barWidth / 2,
    controls: { x: boardX, y: controlsY, width: blockW, height: S.controlsH },
    input: { x: boardX, y: controlsY, width: inputW, height: S.controlsH },
    submit: {
      x: boardX + inputW + S.inputGap,
      y: controlsY,
      width: Math.max(0, blockW - inputW - S.inputGap),
      height: S.controlsH,
    },
  };
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/** Centre of a bubble sitting `top` of the way down the bar, in page coordinates. */
export function bubbleCenter(l: PageLayout, top: number): { x: number; y: number } {
  return { x: l.barCenterX, y: l.bar.y + l.bar.height * top };
}

/** The generous rect a drag must start in to grab the bubble without it jumping. */
export function bubbleHitRect(l: PageLayout, top: number): Rect {
  const c = bubbleCenter(l, top);
  return {
    x: c.x - SIZES.hitW / 2,
    y: c.y - SIZES.hitH / 2,
    width: SIZES.hitW,
    height: SIZES.hitH,
  };
}

/** The bar fraction a y coordinate corresponds to, clamped to the bar. */
export function topFractionForY(l: PageLayout, y: number): number {
  if (l.bar.height <= 0) return 0.5;
  return Math.min(Math.max((y - l.bar.y) / l.bar.height, 0), 1);
}

/**
 * The strip a guess drag may start in: right of the board, from a bubble above the bar to a
 * bubble below it. The board itself is left to paging.
 */
export function inGuessRegion(l: PageLayout, x: number, y: number): boolean {
  return (
    x >= l.board.x + l.board.width + 4 &&
    x <= l.pageW &&
    y >= l.bar.y - SIZES.bubbleH &&
    y <= l.bar.y + l.bar.height + SIZES.bubbleH
  );
}
