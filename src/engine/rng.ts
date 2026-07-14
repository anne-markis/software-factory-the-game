export interface Rng {
  next(): number;
  getState(): number;
}

// mulberry32. When isRawState is true, seed is treated as the exact
// internal state (used to resume from a save).
export function createRng(seed: number, isRawState = false): Rng {
  let s = seed >>> 0;
  const step = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (isRawState) {
    // state already reflects prior next() calls; nothing to do
  }
  return { next: step, getState: () => s };
}
