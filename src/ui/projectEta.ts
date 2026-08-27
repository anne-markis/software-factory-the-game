// Derived in-flight time estimate. Remaining ÷ the current WIP slice
// (factory Points/Day split equally across n live remainings). Informational
// only — no engine rule change. n=1 is remaining ÷ Points/Day.

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Factory Points/Day split across `inFlight` remainings. */
export function wipSliceRate(pointsPerDay: number, inFlight: number): number {
  const n = Math.max(1, inFlight);
  return pointsPerDay / n;
}

/** Whole days left at the current WIP slice, or null when rate is ~0 / non-finite. */
export function projectEtaDays(remaining: number, pointsPerDay: number, inFlight = 1): number | null {
  const slice = wipSliceRate(pointsPerDay, inFlight);
  if (!(slice > 0) || !Number.isFinite(slice) || !Number.isFinite(remaining)) {
    return null;
  }
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / slice);
}

/** Player-facing ETA fragment: "~N days at current rate" or "stalled". */
export function formatProjectEta(remaining: number, pointsPerDay: number, inFlight = 1): string {
  const days = projectEtaDays(remaining, pointsPerDay, inFlight);
  if (days === null) return "stalled";
  const unit = days === 1 ? "day" : "days";
  return `~${fmt(days)} ${unit} at current rate`;
}
