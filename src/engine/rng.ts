export interface Rng {
  next(): number;
  getState(): number;
}

/**
 * mulberry32 PRNG.
 *
 * The isRawState flag has no runtime effect: a fresh seed and a raw internal
 * state are handled identically. It exists to signal at call sites that a
 * saved internal state, not a fresh seed, is being passed.
 *
 * getState() returns the state after the last next(), so passing it back
 * with isRawState = true resumes the sequence where it left off.
 */
export function createRng(seed: number, isRawState = false): Rng {
  let s = seed >>> 0;
  const step = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next: step, getState: () => s };
}

/**
 * Stateless deterministic roll in [0, 1) keyed by (seed, day, key).
 *
 * Unlike createRng's stream, hashRoll consumes and mutates no state: the same
 * (seed, day, key) always yields the same value, and every distinct triple is
 * independent of every other. This lets challenge rolls be indexed by
 * challenge id (and, for per-human challenges, human instance id) rather than
 * by position in a shared draw sequence -- so adding or reordering content
 * cannot disturb the rolls of unrelated challenges, and per-instance rolls
 * stay stable across content edits.
 *
 * The key chars are folded into a 32-bit accumulator seeded from (seed ^ day)
 * with an FNV-1a-style imul mix, then run once through the mulberry32
 * finalizer to decorrelate adjacent keys/days.
 */
export function hashRoll(seed: number, day: number, key: string): number {
  let h = (seed ^ day) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0; // FNV-1a 32-bit prime
  }
  // mulberry32 finalizer, applied once
  h = (h + 0x6d2b79f5) >>> 0;
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
