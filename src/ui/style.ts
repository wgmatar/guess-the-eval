import type { CSSProperties } from 'react';
import type { Rect } from '../core/layout';

export const rectStyle = (r: Rect): CSSProperties => ({
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
});

/** Page and stage transition lengths, matching the CSS custom properties. */
export function durations(reducedMotion: boolean) {
  return reducedMotion
    ? { page: 180, reveal: 220, stage: 180 }
    : { page: 360, reveal: 440, stage: 340 };
}
