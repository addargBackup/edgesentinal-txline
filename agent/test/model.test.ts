import { describe, expect, it } from "vitest";
import {
  calibrateLambdas, kellyFraction, outcomeProbs, poissonPmf,
} from "../src/engine/model.js";

const fresh = { scoreHome: 0, scoreAway: 0, minutesLeft: 90, redsHome: 0, redsAway: 0 };

describe("poissonPmf", () => {
  it("matches hand-computed values", () => {
    expect(poissonPmf(0, 1)).toBeCloseTo(Math.exp(-1), 10);
    expect(poissonPmf(2, 1.5)).toBeCloseTo((Math.exp(-1.5) * 1.5 ** 2) / 2, 10);
    expect(poissonPmf(0, 0)).toBe(1); // point mass at λ=0
    expect(poissonPmf(3, 0)).toBe(0);
  });
});

describe("outcomeProbs", () => {
  it("symmetric λ=1 vs 1: draw = e^-2·I0(2) ≈ 0.3085 (hand-computed)", () => {
    const p = outcomeProbs(1, 1, fresh);
    expect(p.draw).toBeCloseTo(0.30851, 4);
    expect(p.home).toBeCloseTo(p.away, 10);
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 10);
  });

  it("λA=0: pAway=0, pDraw=e^-λH (home scores nothing)", () => {
    const p = outcomeProbs(1, 0, fresh);
    expect(p.away).toBeCloseTo(0, 10);
    expect(p.draw).toBeCloseTo(Math.exp(-1), 6);
    expect(p.home).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it("no time left: current score decides", () => {
    const p = outcomeProbs(1.5, 1.2, { ...fresh, scoreHome: 2, scoreAway: 0, minutesLeft: 0 });
    expect(p.home).toBeCloseTo(1, 10);
  });

  it("a goal moves the number the right way", () => {
    const before = outcomeProbs(1.4, 1.1, { ...fresh, minutesLeft: 45 });
    const after = outcomeProbs(1.4, 1.1, { ...fresh, minutesLeft: 45, scoreHome: 1 });
    expect(after.home).toBeGreaterThan(before.home + 0.15);
  });

  it("red card hurts the carded team", () => {
    const clean = outcomeProbs(1.4, 1.1, { ...fresh, minutesLeft: 60 });
    const carded = outcomeProbs(1.4, 1.1, { ...fresh, minutesLeft: 60, redsHome: 1 });
    expect(carded.home).toBeLessThan(clean.home);
    expect(carded.away).toBeGreaterThan(clean.away);
  });
});

describe("calibrateLambdas", () => {
  it("round-trips: probs(λ) -> calibrate -> λ recovered", () => {
    const truth = outcomeProbs(1.5, 1.2, fresh);
    const fit = calibrateLambdas(truth);
    expect(fit.lambdaHome).toBeCloseTo(1.5, 1);
    expect(fit.lambdaAway).toBeCloseTo(1.2, 1);
    const refit = outcomeProbs(fit.lambdaHome, fit.lambdaAway, fresh);
    expect(refit.home).toBeCloseTo(truth.home, 3);
    expect(refit.draw).toBeCloseTo(truth.draw, 3);
  });

  it("is deterministic", () => {
    const a = calibrateLambdas({ home: 0.5, draw: 0.27, away: 0.23 });
    const b = calibrateLambdas({ home: 0.5, draw: 0.27, away: 0.23 });
    expect(a).toEqual(b);
  });
});

describe("kellyFraction", () => {
  it("f = k(q−p)/(1−p), floored at 0", () => {
    expect(kellyFraction(0.6, 0.5, 0.25)).toBeCloseTo((0.25 * 0.1) / 0.5, 10);
    expect(kellyFraction(0.4, 0.5, 0.25)).toBe(0); // no negative-edge bets
    expect(kellyFraction(0.6, 1, 0.25)).toBe(0);   // degenerate price
  });
});
