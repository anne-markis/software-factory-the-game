import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { loadShippedContent, shippedEras } from "./loadShippedContent";
import { effectiveRate } from "./modifiers";
import { effectiveCapacity } from "./capacity";
import { ktloBurnPerDay, productFinishRate } from "./ktlo";
import { workLedgerIssues } from "./work";
import type { GameState } from "./types";
import { isPermanentProject } from "./types";

const COMPANY_CLEAR = shippedEras().eras.find((era) => era.id === "company")!.entryAnyOf![0].minBudget! + 20;

describe("KTLO", () => {
  it("is on from Studio through Megacorp", () => {
    const studio = new Engine(loadShippedContent());
    const studioKtlo = studio.getContent().projects.find((p) => p.id === "ktlo");
    expect(studioKtlo && isPermanentProject(studioKtlo) && studioKtlo.basePerDay).toBe(0.2);
    expect(studioKtlo && isPermanentProject(studioKtlo) && studioKtlo.perDay).toBe(20);
    expect(studioKtlo && isPermanentProject(studioKtlo) && studioKtlo.hostingPerUser).toBe(0.12);
    expect(studio.getState().baseRates.ktlo).toBeCloseTo(0.2);
    expect(studio.availableProjects().some((p) => p.def.id === "gig-bugfix")).toBe(false);
    expect(studio.availableProjects().some((p) => p.def.id === "gig-landing-page")).toBe(true);

    const company = new Engine(loadShippedContent("company"));
    const ktlo = company.getContent().projects.find((p) => p.id === "ktlo");
    expect(ktlo && isPermanentProject(ktlo) && ktlo.basePerDay).toBe(0.2);
    expect(ktlo && isPermanentProject(ktlo) && ktlo.perDay).toBe(20);
    expect(company.getState().baseRates.ktlo).toBeCloseTo(0.2);
    expect(company.getState().projects.some((p) => p.defId === "ktlo")).toBe(false);
    expect(company.availableProjects().some((p) => p.def.id === "ktlo")).toBe(false);
    expect(() => company.startProject("ktlo")).toThrow(/always on/);

    const mega = loadShippedContent("megacorp");
    expect(mega.projects.some((p) => p.id === "ktlo")).toBe(true);
    expect(mega.retiredProjectIds ?? []).toEqual(["gig-landing-page"]);
    expect(mega.projects.some((p) => p.id === "gig-bugfix")).toBe(false);
  });

  it("reserves finish before contract work and leaves every seat for that work", () => {
    const e = new Engine(loadShippedContent("company"));
    const s = e.getState() as GameState;
    s.baseCapacity = 4;
    s.baseRates.finish = 3.2;
    s.stocks.backlog = 100;
    s.projects[0]!.remaining = 100;
    expect(productFinishRate(s, e.getContent())).toBeCloseTo(3.0);
    expect(effectiveCapacity(s, e.getContent())).toBe(4);

    e.tick();
    expect(s.finishFlow).toBeCloseTo(3.0);
    expect(s.stocks.inProgress).toBeCloseTo(4);
    expect(workLedgerIssues(s)).toEqual([]);
    expect(s.projects.some((p) => p.defId === "ktlo")).toBe(false);

    s.modifiers.push({ id: "m1", source: "on-call", target: "ktlo", op: "mul", value: 1.6 });
    expect(effectiveRate(s, "ktlo")).toBeCloseTo(0.32);
    expect(productFinishRate(s, e.getContent())).toBeCloseTo(2.88);

    s.modifiers.push({ id: "m2", source: "speed", target: "allRates", op: "mul", value: 2 });
    expect(effectiveRate(s, "finish")).toBeCloseTo(6.4);
    expect(effectiveRate(s, "ktlo")).toBeCloseTo(0.32);
  });

  it("keeps an in-flight Studio gig across the Company crossing", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    e.startProject("gig-landing-page");
    const before = e.getState().projects.find((p) => p.defId === "gig-landing-page")!.remaining;
    (e.getState() as GameState).stocks.budget = COMPANY_CLEAR;
    e.tick();
    expect(e.getState().eraId).toBe("company");
    expect(e.getState().baseRates.ktlo).toBeCloseTo(0.2);
    const live = e.getState().projects.find((p) => p.defId === "gig-landing-page");
    expect(live).toBeDefined();
    expect(live!.remaining).toBe(before);
    expect(e.availableProjects().some((p) => p.def.id === "gig-bugfix")).toBe(false);
    expect(e.availableProjects().some((p) => p.def.id === "gig-landing-page")).toBe(false);
    e.abandonProject("gig-landing-page");
    expect(e.getState().projects.some((p) => p.defId === "gig-landing-page")).toBe(false);
    expect(workLedgerIssues(e.getState())).toEqual([]);
  });

  it("adds hosting and active-card surcharges without replacing card payroll", () => {
    const e = new Engine(loadShippedContent());
    const content = e.getContent();
    const fresh = e.getState();
    expect(ktloBurnPerDay(fresh, content)).toBe(20);

    fresh.stocks.users = 100;
    expect(ktloBurnPerDay(fresh, content)).toBeCloseTo(32);

    e.applyDecision("agent");
    e.applyDecision("agent-harness");
    expect(ktloBurnPerDay(e.getState(), content)).toBeCloseTo(50);

    e.applyDecision("basic-dev");
    expect(ktloBurnPerDay(e.getState(), content)).toBeCloseTo(50);
    const hired = e.getState() as GameState;
    for (const inst of hired.decisions) {
      if (inst.defId === "basic-dev" && inst.activeOnDay !== undefined) inst.activeOnDay = hired.day;
    }
    expect(ktloBurnPerDay(hired, content)).toBeCloseTo(85);

    const before = hired.stocks.budget;
    e.tick();
    const split = hired.expensesByDay.at(-1)!;
    expect(split.human).toBe(438);
    expect(split.ktlo).toBeCloseTo(85);
    const burst = hired.incomeByDay.at(-1)!.burst;
    expect(hired.stocks.budget).toBeCloseTo(before - 85 - 438 - 8 - 5 + burst);
  });
});
