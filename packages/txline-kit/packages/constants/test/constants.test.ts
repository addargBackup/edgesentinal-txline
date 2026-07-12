import { describe, expect, it } from "vitest";
import {
  STAT, PERIOD, statKey, parseStatKey, PHASE, isLive, isTerminal, isVoidable,
  isFinalised, normalizePhase, impliedProbability, pctToProbability,
  discoverMarkets, latestProbabilities,
} from "../src/index.js";

describe("stat keys", () => {
  it("composes period-prefixed keys", () => {
    expect(statKey(STAT.T1_GOALS)).toBe(1);
    expect(statKey(STAT.T2_CORNERS, PERIOD.H2)).toBe(3008);
    expect(statKey(STAT.T1_CORNERS, PERIOD.H2)).toBe(3007);
    expect(statKey(STAT.T2_CORNERS, PERIOD.ET_TOTAL)).toBe(7008);
  });
  it("round-trips parseStatKey", () => {
    for (const base of Object.values(STAT)) {
      for (const period of Object.values(PERIOD)) {
        expect(parseStatKey(statKey(base, period))).toEqual({ base, period });
      }
    }
  });
  it("rejects unknown bases/periods", () => {
    expect(() => statKey(9)).toThrow();
    expect(() => parseStatKey(1009)).toThrow();
    expect(() => parseStatKey(8001)).toThrow();
  });
});

describe("phases", () => {
  it("classifies live/terminal/voidable", () => {
    expect(isLive(PHASE.H1)).toBe(true);
    expect(isLive("H2")).toBe(true);
    expect(isLive(PHASE.NS)).toBe(false);
    expect(isTerminal("F")).toBe(true);
    expect(isTerminal(PHASE.FPE)).toBe(true);
    expect(isVoidable(PHASE.A)).toBe(true);
    expect(isVoidable("P")).toBe(true);
    expect(isVoidable(PHASE.F)).toBe(false);
  });
  it("normalizes names and ids", () => {
    expect(normalizePhase("ht")).toBe(PHASE.HT);
    expect(normalizePhase(12)).toBe(PHASE.PE);
    expect(normalizePhase(99)).toBeUndefined();
  });
  it("detects finalisation", () => {
    expect(isFinalised({ action: "game_finalised" })).toBe(true);
    expect(isFinalised({ action: "goal" })).toBe(false);
  });
});

describe("odds math", () => {
  it("implied probability", () => {
    expect(impliedProbability(2)).toBeCloseTo(0.5);
    expect(() => impliedProbability(1)).toThrow();
  });
  it("Pct strings", () => {
    expect(pctToProbability("52.632")).toBeCloseTo(0.52632);
    expect(pctToProbability("NA")).toBeNull();
  });
});

describe("market discovery", () => {
  const records = [
    { FixtureId: 1, Ts: 10, SuperOddsType: "1X2", PriceNames: ["1", "X", "2"], Pct: ["50.000", "25.000", "25.000"] },
    { FixtureId: 1, Ts: 20, SuperOddsType: "1X2", PriceNames: ["1", "X", "2"], Pct: ["60.000", "20.000", "20.000"] },
    { FixtureId: 1, Ts: 15, SuperOddsType: "OU", MarketParameters: "2.5", PriceNames: ["Over", "Under"], Pct: ["45.000", "55.000"] },
  ];
  it("groups by market identity", () => {
    const markets = discoverMarkets(records);
    expect(markets).toHaveLength(2);
    expect(markets.map((m) => m.superOddsType)).toEqual(["1X2", "OU"]);
  });
  it("returns latest probabilities per market", () => {
    const probs = latestProbabilities(records, { superOddsType: "1X2" });
    expect(probs).toEqual({ "1": 0.6, X: 0.2, "2": 0.2 });
  });
});
