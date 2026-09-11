/**
 * Pointer and wheel arithmetic for the feed, pure so it can be tested without a DOM. Port of
 * the classifier in `RootView.swift` from the vertical-bar design (iOS commit dc8699c).
 *
 * A drag is classified once, on its first significant movement, and that decision is frozen
 * for the life of the touch: a drag that starts beside the board sets the guess and can never
 * page, and a sloppy vertical swipe can never fall through to Stats.
 */
export type Stage = 'feed' | 'stats';
export type DragMode = 'undecided' | 'guess' | 'page' | 'stage' | 'ignored';

export interface Sample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/** Below this nothing is decided, which leaves taps to buttons and links. */
export const START_DISTANCE = 6;
export const DOMINANCE = 1.5;
export const HORIZONTAL_COMMIT = 24;
export const VERTICAL_COMMIT = 8;
/** Fraction of a page a drag must travel to change page; a flick needs its projection to reach `FLICK`. */
export const PAGE_COMMIT = 0.22;
export const STAGE_COMMIT = 0.25;
export const FLICK = 0.5;
/** How far ahead a release velocity is projected, in ms. */
export const PROJECTION_MS = 300;

const isHorizontal = (dx: number, dy: number) =>
  Math.abs(dx) > DOMINANCE * Math.abs(dy) && Math.abs(dx) >= HORIZONTAL_COMMIT;

export function classifyDrag(dx: number, dy: number, stage: Stage, startsGuess: boolean): DragMode {
  if (Math.hypot(dx, dy) < START_DISTANCE) return 'undecided';
  if (stage === 'stats') {
    if (isHorizontal(dx, dy)) return 'stage';
    // Staying undecided below the thresholds matters: the decision is frozen, so committing
    // early would freeze every touch on Stats into `ignored`.
    return Math.abs(dy) >= VERTICAL_COMMIT ? 'ignored' : 'undecided';
  }
  if (startsGuess) return 'guess';
  if (isHorizontal(dx, dy)) return 'stage';
  if (Math.abs(dy) >= VERTICAL_COMMIT) return 'page';
  return 'undecided';
}

/**
 * UIScrollView's rubber band, so the ends feel like a surface rather than a wall: the content
 * follows at 0.55× near the edge and never travels past `limit`. (The iOS port divided by
 * `limit * 0.55` instead of multiplying, which made the ends 1.8× faster than the finger.)
 */
export function resisted(distance: number, limit: number): number {
  if (limit <= 0) return 0;
  const damped = limit * (1 - 1 / ((Math.abs(distance) * 0.55) / limit + 1));
  return distance < 0 ? -damped : damped;
}

export function pageOffset(
  distance: number,
  visible: number,
  lastPage: number,
  height: number,
): number {
  const pastTop = visible === 0 && distance > 0;
  const pastEnd = visible === lastPage && distance < 0;
  return pastTop || pastEnd ? resisted(distance, height) : distance;
}

export function stageOffset(distance: number, stage: Stage, width: number): number {
  // Right from the feed is unassigned, and so is left from Stats.
  const past = (stage === 'feed' && distance > 0) || (stage === 'stats' && distance < 0);
  return past ? resisted(distance, width) : distance;
}

/** The page a released vertical drag settles on. `velocity` is px/ms, down positive. */
export function settlePage(
  travelled: number,
  velocity: number,
  visible: number,
  lastPage: number,
  height: number,
): number {
  const projected = travelled + velocity * PROJECTION_MS;
  let target = visible;
  if (travelled <= -height * PAGE_COMMIT || projected <= -height * FLICK) target += 1;
  else if (travelled >= height * PAGE_COMMIT || projected >= height * FLICK) target -= 1;
  return Math.min(Math.max(target, 0), lastPage);
}

export function settleStage(
  travelled: number,
  velocity: number,
  stage: Stage,
  width: number,
): Stage {
  const projected = travelled + velocity * PROJECTION_MS;
  if (stage === 'feed' && (travelled <= -width * STAGE_COMMIT || projected <= -width * FLICK)) {
    return 'stats';
  }
  if (stage === 'stats' && (travelled >= width * STAGE_COMMIT || projected >= width * FLICK)) {
    return 'feed';
  }
  return stage;
}

/** Release velocity in px/ms, over the last 100 ms of samples. */
export function velocityOf(samples: readonly Sample[]): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  if (!last) return { vx: 0, vy: 0 };
  const first = samples.find((s) => s.t >= last.t - 100) ?? last;
  const dt = last.t - first.t;
  if (dt < 8) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

/** Normalises a wheel delta to pixels. */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}

/**
 * One trackpad flick pages once. The accumulator re-arms only after `quietMs` of silence,
 * which swallows the long inertial tail a trackpad sends after the fingers lift.
 */
export class WheelPager {
  private armed = true;
  private total = 0;
  private last = -Infinity;

  constructor(
    private readonly threshold = 100,
    private readonly quietMs = 150,
  ) {}

  push(delta: number, now: number): -1 | 0 | 1 {
    if (now - this.last > this.quietMs) {
      this.armed = true;
      this.total = 0;
    }
    this.last = now;
    if (!this.armed) return 0;
    this.total += delta;
    if (Math.abs(this.total) < this.threshold) return 0;
    this.armed = false;
    return this.total > 0 ? 1 : -1;
  }
}
