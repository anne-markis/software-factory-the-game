import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { loadShippedContent, shippedEras } from "./loadShippedContent";
import { effectiveRate } from "./modifiers";
import { effectiveCapacity } from "./capacity";
import { productFinishRate } from "./ktlo";
import { workLedgerIssues } from "./work";
import type { GameState } from "./types";
import { isPermanentProject } from "./types";

const COMPANY_CLEAR = shippedEras().eras.find((era) => era.id === "company")!.entryAnyOf![0].minBudget! + 20;

describe("KTLO", () => {
  it("is absent in Studio and on from Company, including Megacorp", () => {
    const studio = new Engine(loadShippedContent());
    expect(studio.getContent().projects.some(isPermanentProject)).toBe(false);
    expect(studio.getState().baseRates.ktlo).toBe(0);
    expect(studio.availableProjects().some((p) => p.def.id === "gig-bugfix")).toBe(true);

    const company = new Engine(loadShippedContent("company"));
    const ktlo = company.getContent().projects.find((p) => p.id === "ktlo");
    expect(ktlo && isPermanentProject(ktlo) && ktlo.basePerDay).toBe(0.5);
    expect(company.getState().baseRates.ktlo).toBeCloseTo(0.5);
    expect(company.getState().projects.some((p) => p.defId === "ktlo")).toBe(false);
    expect(company.availableProjects().some((p) => p.def.id === "ktlo")).toBe(false);
    expect(() => company.startProject("ktlo")).toThrow(/always on/);

    const mega = loadShippedContent("megacorp");
    expect(mega.projects.some((p) => p.id === "ktlo")).toBe(true);
    expect(mega.retiredProjectIds).toEqual(["gig-bugfix"]);
  });

  it("reserves finish before contract work and leaves every seat for that work", () => {
    const e = new Engine(loadShippedContent("company"));
    const s = e.getState() as GameState;
    s.baseCapacity = 4;
    s.baseRates.finish = 3.2;
    s.stocks.backlog = 100;
    s.projects[0]!.remaining = 100;
    expect(productFinishRate(s, e.getContent())).toBeCloseTo(2.7);
    expect(effectiveCapacity(s, e.getContent())).toBe(4);

    e.tick();
    expect(s.finishFlow).toBeCloseTo(2.7);
    expect(s.stocks.inProgress).toBeCloseTo(4);
    expect(workLedgerIssues(s)).toEqual([]);
    expect(s.projects.some((p) => p.defId === "ktlo")).toBe(false);

    s.modifiers.push({ id: "m1", source: "on-call", target: "ktlo", op: "mul", value: 1.6 });
    expect(effectiveRate(s, "ktlo")).toBeCloseTo(0.8);
    expect(productFinishRate(s, e.getContent())).toBeCloseTo(2.4);

    s.modifiers.push({ id: "m2", source: "speed", target: "allRates", op: "mul", value: 2 });
    expect(effectiveRate(s, "finish")).toBeCloseTo(6.4);
    expect(effectiveRate(s, "ktlo")).toBeCloseTo(0.8);
  });

  it("drops Bugfix sprint from offers at the crossing and leaves one already in flight", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    e.startProject("gig-bugfix");
    const before = e.getState().projects.find((p) => p.defId === "gig-bugfix")!.remaining;
    (e.getState() as GameState).stocks.budget = COMPANY_CLEAR;
    e.tick();
    expect(e.getState().eraId).toBe("company");
    expect(e.getState().baseRates.ktlo).toBeCloseTo(0.5);
    const live = e.getState().projects.find((p) => p.defId === "gig-bugfix");
    expect(live).toBeDefined();
    expect(live!.remaining).toBe(before);
    expect(e.availableProjects().some((p) => p.def.id === "gig-bugfix")).toBe(false);
    expect(e.availableProjects().some((p) => p.def.id === "gig-landing-page")).toBe(true);
    expect(() => e.startProject("gig-bugfix")).toThrow(/no longer offered/);
    e.abandonProject("gig-bugfix");
    expect(e.getState().projects.some((p) => p.defId === "gig-bugfix")).toBe(false);
    expect(workLedgerIssues(e.getState())).toEqual([]);
  });
});
