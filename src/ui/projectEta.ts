// P0.1 FR-3: derived project time estimate for in-flight rows.
// Informational only — remaining points ÷ current Points/Day (realized ship
// rate). No engine rule change.

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Whole days left at the current rate, or null when rate is ~0 / non-finite. */
export function projectEtaDays(remaining: number, pointsPerDay: number): number | null {
  if (!(pointsPerDay > 0) || !Number.isFinite(pointsPerDay) || !Number.isFinite(remaining)) {
    return null;
  }
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / pointsPerDay);
}

/** Player-facing ETA fragment: "~N days at current rate" or "stalled". */
export function formatProjectEta(remaining: number, pointsPerDay: number): string {
  const days = projectEtaDays(remaining, pointsPerDay);
  if (days === null) return "stalled";
  const unit = days === 1 ? "day" : "days";
  return `~${fmt(days)} ${unit} at current rate`;
}
