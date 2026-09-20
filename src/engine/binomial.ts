import type { Rng } from "./rng";

/**
 * Independent per-unit hits: each whole point of `stock` succeeds with
 * probability `p`, and a leftover fraction succeeds with probability `p * frac`.
 * Expected hits equal `stock * p` (clamped when p is 0 or 1). Used by
 * burstFromStock so a small stock still produces occasional sales instead of
 * an all-or-nothing company-wide roll.
 */
export function sampleIndependentHits(rng: Rng, stock: number, p: number): number {
  if (stock <= 0 || p <= 0) return 0;
  const whole = Math.floor(stock);
  const frac = stock - whole;
  if (p >= 1) {
    return whole + (frac > 0 && rng.next() < frac ? 1 : 0);
  }
  let hits = 0;
  for (let i = 0; i < whole; i++) {
    if (rng.next() < p) hits += 1;
  }
  if (frac > 0 && rng.next() < p * frac) hits += 1;
  return hits;
}
