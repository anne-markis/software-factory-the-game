import type { DecisionInstance } from "./types";

/** True when a purchased instance has arrived (no delay, or delay elapsed). */
export function instanceIsActive(inst: Pick<DecisionInstance, "activeOnDay">, day: number): boolean {
  return inst.activeOnDay === undefined || inst.activeOnDay <= day;
}
