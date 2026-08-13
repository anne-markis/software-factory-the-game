import { describe, it, expect } from "vitest";
import { detectMilestones } from "./milestones";
import { initialState } from "./engine";
import { parseStartConfig } from "./content";
import { startJson } from "./loadShippedContent";
import type { GameContent, GameState } from "./types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
}

// A capturing log stub matching tick.ts's log signature (state, message),
// mirroring archetypes.test.ts's collect() helper.
function collect() {
  const messages: string[] = [];
  const log = (s: GameState, m: string) => {
    s.log.push({ day: s.day, message: m });
    messages.push(m);
  };
  return { messages, log };
}

describe("detectMilestones", () => {
  it("fires a milestone once when reputation first reaches its threshold", () => {
    // Shipped start.json: milestones [{ trusted, 5 }, { established, 15 }].
    const c = content();
    const s = initialState(c);
    s.stocks.reputation = 5;
    const { messages, log } = collect();

    detectMilestones(s, c, log);
    expect(s.milestonesSeen).toEqual(["trusted"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(c.start.milestones.find((m) => m.id === "trusted")!.message);

    // Once-only: a second detection at the same reputation logs nothing new.
    detectMilestones(s, c, log);
    expect(messages).toHaveLength(1);
    expect(s.milestonesSeen).toEqual(["trusted"]);
  });

  it("does not fire before the threshold", () => {
    const c = content();
    const s = initialState(c);
    s.stocks.reputation = 4;
    const { messages, log } = collect();
    detectMilestones(s, c, log);
    expect(s.milestonesSeen).toEqual([]);
    expect(messages).toHaveLength(0);
  });

  it("fires multiple milestones already reached in a single detection pass", () => {
    const c = content();
    const s = initialState(c);
    s.stocks.reputation = 20; // past both trusted (5) and established (15)
    const { messages, log } = collect();
    detectMilestones(s, c, log);
    expect(s.milestonesSeen).toEqual(["trusted", "established"]);
    expect(messages).toHaveLength(2);
  });

  it("is sticky: a downward recross below an already-fired threshold does not un-fire it", () => {
    const c = content();
    const s = initialState(c);
    s.stocks.reputation = 5;
    const { messages, log } = collect();
    detectMilestones(s, c, log);
    expect(s.milestonesSeen).toEqual(["trusted"]);

    // Reputation drops back below the threshold (e.g. an incident hit).
    s.stocks.reputation = 0;
    detectMilestones(s, c, log);
    expect(s.milestonesSeen).toEqual(["trusted"]); // still recorded, not removed
    expect(messages).toHaveLength(1); // no re-fire

    // Crossing back up again does not re-fire the same milestone either.
    s.stocks.reputation = 5;
    detectMilestones(s, c, log);
    expect(s.milestonesSeen).toEqual(["trusted"]);
    expect(messages).toHaveLength(1);
  });

  it("does not fire any milestone at baseline reputation 0", () => {
    const c = content();
    const s = initialState(c);
    const { messages, log } = collect();
    detectMilestones(s, c, log);
    expect(s.milestonesSeen).toEqual([]);
    expect(messages).toHaveLength(0);
  });
});
