/**
 * The order positions are served in. Replaces `FeedSequencer.swift`: with the answered
 * bitmap already in hand, a seeded random pick among the unanswered positions is simpler
 * than a permutation and gives the same guarantee, no repeats until every position is used.
 */
export type Random = () => number;

/** mulberry32: small, fast, and good enough to deal chess positions. */
export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    return Math.floor(Math.random() * 2 ** 32);
  }
}

export const RANDOM_DRAWS = 64;

/**
 * A uniformly random index in `0..count-1` that `accept` takes: up to 64 random draws, then
 * a linear scan from a random start, which only matters once almost everything is answered.
 */
export function pickIndex(
  count: number,
  accept: (index: number) => boolean,
  random: Random,
): number | null {
  if (count <= 0) return null;
  for (let draw = 0; draw < RANDOM_DRAWS; draw++) {
    const index = Math.floor(random() * count);
    if (accept(index)) return index;
  }
  const start = Math.floor(random() * count);
  for (let k = 0; k < count; k++) {
    const index = (start + k) % count;
    if (accept(index)) return index;
  }
  return null;
}
