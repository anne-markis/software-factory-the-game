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
