// Issue #67 / P0.1 US-6: perceptible change (stat flash) and hire-gamble reveal.
// Presentation-only — no engine/state changes. Flashes update .stat-value nodes
// in place so a CSS animation can finish without being torn down by the
// string-memo patch path (which rebuilds markup whenever a number moves).

import type { GameContent, GameState } from "../engine/types";
import { eraDisplayName } from "../engine/eras";
import { budgetRunwayDays, RUNWAY_WARN_DAYS } from "./runway";

// Local copies — avoid a render.ts ↔ gameFeel.ts import cycle (render
// delegates row HTML here for the shared flash path).
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Brief highlight length; under 1x tick (1000ms) so it reads as a pulse. */
export const STAT_FLASH_MS = 480;
/**
 * Per-label cooldown so 2x/5x ticks cannot restroke the same slot every frame
 * (seizure-grade / noise bar in the issue DoD).
 */
export const STAT_FLASH_COOLDOWN_MS = 600;
/**
 * Auto-dismiss for the gamble reveal. Long enough to notice while scrolled
 * into Alter the loop; sticky CSS keeps it in view (issue #67 UX).
 */
export const GAMBLE_REVEAL_MS = 5000;

export interface StatView {
  label: string;
  value: string;
  widthClass: string;
  /** Extra class on the value (e.g. budget-low). */
  valueClass?: string;
  /** When false, value changes never flash (Day clock). */
  material: boolean;
}

export function cockpitStatViews(state: Readonly<GameState>, content: GameContent): StatView[] {
  const runway = budgetRunwayDays(state, content);
  const low = runway !== null && runway <= RUNWAY_WARN_DAYS;
  const dayLabel = runway === 1 ? "1 day" : `${runway} days`;
  const budgetValue =
    runway === null ? `$${fmt(state.stocks.budget)}` : `$${fmt(state.stocks.budget)} (${dayLabel})`;
  return [
    { label: "Era", value: eraDisplayName(content.eras, state.eraId), widthClass: "v-era", material: true },
    { label: "Day", value: String(state.day), widthClass: "v-day", material: false },
    { label: "Backlog", value: fmt(state.stocks.backlog), widthClass: "v-flow", material: true },
    {
      label: "Budget",
      value: budgetValue,
      widthClass: "v-budget",
      valueClass: low ? "budget-low" : undefined,
      material: true,
    },
    { label: "Points/Day", value: fmt(state.pointsPerDay), widthClass: "v-rate", material: true },
  ];
}

export function deliveryStatViews(state: Readonly<GameState>): StatView[] {
  return [
    { label: "In Progress", value: fmt(state.stocks.inProgress), widthClass: "v-count", material: true },
    { label: "Done", value: fmt(state.stocks.done), widthClass: "v-count", material: true },
    { label: "Shipped", value: fmt(state.stocks.shipped), widthClass: "v-flow", material: true },
    { label: "Tech Debt", value: fmt(state.stocks.techDebt), widthClass: "v-debt", material: true },
    { label: "Reputation", value: fmt(state.stocks.reputation), widthClass: "v-rep", material: true },
    // Studio spine (issue #88): the users stock sits after Reputation. Stays
    // 0 until the Launch beta completes, then drives monetization.
    { label: "Users", value: fmt(state.stocks.users), widthClass: "v-users", material: true },
  ];
}

function statMarkup(s: StatView): string {
  const extra = s.valueClass ? ` ${s.valueClass}` : "";
  return `<span class="stat"><span class="stat-label">${esc(s.label)}</span> <span class="stat-value ${s.widthClass}${extra}">${esc(s.value)}</span></span>`;
}

/** Full-row HTML for first paint / structure mismatch (same shape as renderStats). */
export function statsRowHtml(stats: readonly StatView[], rowClass: "stats" | "delivery-stats"): string {
  return `<div class="${rowClass}">${stats.map(statMarkup).join("")}</div>`;
}

export interface FlashController {
  /** label → earliest time another flash may start */
  cooldownUntil: Map<string, number>;
  now: () => number;
}

export function createFlashController(now: () => number = () => performance.now()): FlashController {
  return { cooldownUntil: new Map(), now };
}

/**
 * Ensure `container` holds a row matching `stats`, updating value text in place
 * when only numbers change, and adding `.stat-flash` on material deltas.
 */
export function syncStatRow(
  container: HTMLElement,
  rowClass: "stats" | "delivery-stats",
  stats: readonly StatView[],
  flash: FlashController,
): void {
  let row = container.querySelector<HTMLElement>(`:scope > .${rowClass}`);
  if (!row || row.querySelectorAll(":scope > .stat").length !== stats.length) {
    container.innerHTML = statsRowHtml(stats, rowClass);
    row = container.querySelector<HTMLElement>(`:scope > .${rowClass}`)!;
  }

  const nodes = row.querySelectorAll<HTMLElement>(":scope > .stat");
  const t = flash.now();
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i]!;
    const el = nodes[i]!;
    const labelEl = el.querySelector(".stat-label");
    const valueEl = el.querySelector<HTMLElement>(".stat-value");
    if (!labelEl || !valueEl) continue;
    if (labelEl.textContent !== s.label) labelEl.textContent = s.label;

    const prev = valueEl.textContent ?? "";
    const next = s.value;
    const className = `stat-value ${s.widthClass}${s.valueClass ? ` ${s.valueClass}` : ""}`;
    // Preserve an in-flight flash class across value updates.
    const flashing = valueEl.classList.contains("stat-flash");
    valueEl.className = flashing ? `${className} stat-flash` : className;

    if (prev !== next) {
      valueEl.textContent = next;
      if (s.material) {
        const until = flash.cooldownUntil.get(s.label) ?? 0;
        if (t >= until && !flashing) {
          valueEl.classList.add("stat-flash");
          flash.cooldownUntil.set(s.label, t + STAT_FLASH_COOLDOWN_MS);
          const node = valueEl;
          const clear = (): void => {
            node.classList.remove("stat-flash");
            node.removeEventListener("animationend", clear);
          };
          node.addEventListener("animationend", clear);
        }
      }
    }
  }
}

export interface GambleReveal {
  decisionName: string;
  outcomeLabel: string;
}

export function renderGambleReveal(reveal: GambleReveal | null): string {
  if (!reveal) return "";
  return `<div class="gamble-reveal" role="status"><span class="gamble-reveal-name">${esc(reveal.decisionName)}</span>: <span class="gamble-reveal-outcome">${esc(reveal.outcomeLabel)}</span></div>`;
}
