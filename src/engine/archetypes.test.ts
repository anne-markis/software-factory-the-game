import { describe, it, expect } from "vitest";
import { detectArchetypes } from "./archetypes";
import { initialState } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent, GameState } from "./types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

// A capturing log stub matching tick.ts's log signature (state, message).
function collect() {
  const messages: string[] = [];
  const log = (s: GameState, m: string) => {
    s.log.push({ day: s.day, message: m });
    messages.push(m);
  };
  return { messages, log };
}

describe("detectArchetypes", () => {
  it("fires limits-to-growth once when drag passes halfway to its cap", () => {
    // Shipped config: freeDebt 400, dragPerPoint 0.00015, maxDrag 0.4.
    // Threshold is 1 - maxDrag/2 = 0.8. techDebt 2000 -> excess 1600 -> drag
    // 0.24 -> multiplier 0.76 (< 0.8), so it fires; 0.24 rounds to 24%.
    const c = content();
    const s = initialState(c);
    s.stocks.techDebt = 2000;
    const { messages, log } = collect();

    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).toContain("limits-to-growth");
    const line = messages.find((m) => m.startsWith("Limits to growth"))!;
    expect(line).toBeDefined();
    expect(line).toContain("24%");

    // Once-only: a second detection on the same (still-dragging) state logs nothing new.
    const count = messages.length;
    detectArchetypes(s, c, log);
    expect(messages.length).toBe(count);
    expect(s.archetypesSeen.filter((a) => a === "limits-to-growth")).toHaveLength(1);
  });

  it("does not fire limits-to-growth before the halfway-to-cap threshold", () => {
    const c = content();
    const s = initialState(c);
    s.stocks.techDebt = 1000; // excess 600 -> drag 0.09 -> multiplier 0.91 (> 0.8)
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("limits-to-growth");
    expect(messages).toHaveLength(0);
  });

  it("fires shifting-the-burden once when 2+ debt-raisers are owned with no mitigation and debt past the band", () => {
    const c = content();
    const s = initialState(c);
    // Two debt-raising decisions (agent mul 1.2, copilot mul 1.05), no
    // debt-lowering decision, techDebt past freeDebt (400).
    s.decisions.push({ instanceId: "i-agent", defId: "agent" }, { instanceId: "i-copilot", defId: "copilot" });
    s.stocks.techDebt = 500;
    const { messages, log } = collect();

    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).toContain("shifting-the-burden");
    expect(messages.some((m) => m.startsWith("Shifting the burden"))).toBe(true);

    // Once-only.
    const count = messages.length;
    detectArchetypes(s, c, log);
    expect(messages.length).toBe(count);
    expect(s.archetypesSeen.filter((a) => a === "shifting-the-burden")).toHaveLength(1);
  });

  it("does not fire shifting-the-burden while any debt-lowering decision is owned", () => {
    const c = content();
    const s = initialState(c);
    // test-suite is a debt-lowerer (mul 0.5), so the burden is being paid down.
    s.decisions.push(
      { instanceId: "i-agent", defId: "agent" },
      { instanceId: "i-copilot", defId: "copilot" },
      { instanceId: "i-test", defId: "test-suite" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("does not fire shifting-the-burden while debt is still within the grace band", () => {
    const c = content();
    const s = initialState(c);
    s.decisions.push({ instanceId: "i-agent", defId: "agent" }, { instanceId: "i-copilot", defId: "copilot" });
    s.stocks.techDebt = 300; // below freeDebt 400
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("treats agent-harness and swarm-orchestrator as debt-lowerers (synergy-derived mitigators)", () => {
    // A build with agent + agent-swarm (two raisers) but harness owned should
    // NOT fire: the harness lowers debt structurally via the agent synergy,
    // even though it has no debt effect of its own.
    const c = content();
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-agent", defId: "agent" },
      { instanceId: "i-swarm", defId: "agent-swarm" },
      { instanceId: "i-harness", defId: "agent-harness" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });
});
