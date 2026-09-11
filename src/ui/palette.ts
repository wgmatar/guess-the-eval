import type { Accuracy } from '../core/accuracy';

/** Every colour the page draws from script. The CSS custom properties mirror these. */
export const COLORS = {
  background: '#181613',
  boardLight: '#E9D8B4',
  boardDark: '#2E2C29',
  ivory: '#F9F6F0',
  guess: '#2F6FEB',
  actual: '#66666B',
  close: '#217A47',
  off: '#D0453B',
  exact: '#C8971A',
  exactLabel: '#1C1A17',
  white: '#FFFFFF',
} as const;

export type BubbleKind = 'guess' | 'actual' | Accuracy;

export function bubbleFill(kind: BubbleKind): string {
  return COLORS[kind];
}

/** Label colour that stays legible on each fill: dark on gold, white elsewhere. */
export function bubbleLabel(kind: BubbleKind): string {
  return kind === 'exact' ? COLORS.exactLabel : COLORS.white;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2 contrast ratio between two `#RRGGBB` colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
