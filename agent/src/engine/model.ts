/** In-play Poisson goal model. PURE + DETERMINISTIC — no randomness, no I/O,
 *  no LLM. Derivation and citations in docs/MODEL.md (Maher 1982;
 *  Dixon & Coles 1997; time-inhomogeneity refinement: Dixon & Robinson 1998).
 *
 *  Assumptions (stated, deliberate):
 *   - Independent Poisson goal counts for each team over remaining time.
 *   - Uniform goal arrival: remaining intensity scales linearly with time left.
 *   - Red cards multiply intensities by configured constants.
 */

export interface Probs {
  home: number;
  draw: number;
  away: number;
}

export interface ModelConfig {
  /** goal truncation for the double sum (deterministic; error < 1e-6 for λ<4) */
  maxGoals: number;
  redCardSelf: number; // carded team intensity multiplier
  redCardOpp: number;  // opponent intensity multiplier
}

export const DEFAULT_MODEL_CFG: ModelConfig = { maxGoals: 12, redCardSelf: 0.7, redCardOpp: 1.1 };

/** Poisson pmf with a deterministic point-mass at λ→0. */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 1e-9) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

export interface MatchSituation {
  scoreHome: number;
  scoreAway: number;
  minutesLeft: number; // 0..90 (regulation model)
  redsHome: number;
  redsAway: number;
}

/** Full-match outcome probabilities given remaining-play intensities. */
export function outcomeProbs(
  lambdaHome: number,
  lambdaAway: number,
  sit: MatchSituation,
  cfg: ModelConfig = DEFAULT_MODEL_CFG,
): Probs {
  const frac = Math.max(0, Math.min(1, sit.minutesLeft / 90));
  let lh = lambdaHome * frac;
  let la = lambdaAway * frac;
  // Red cards scale the REMAINING intensity of both sides.
  for (let r = 0; r < sit.redsHome; r++) {
    lh *= cfg.redCardSelf;
    la *= cfg.redCardOpp;
  }
  for (let r = 0; r < sit.redsAway; r++) {
    la *= cfg.redCardSelf;
    lh *= cfg.redCardOpp;
  }

  const ph: number[] = [];
  const pa: number[] = [];
  for (let k = 0; k <= cfg.maxGoals; k++) {
    ph.push(poissonPmf(k, lh));
    pa.push(poissonPmf(k, la));
  }

  let home = 0, draw = 0, away = 0;
  for (let x = 0; x <= cfg.maxGoals; x++) {
    for (let y = 0; y <= cfg.maxGoals; y++) {
      const p = ph[x] * pa[y];
      const finalH = sit.scoreHome + x;
      const finalA = sit.scoreAway + y;
      if (finalH > finalA) home += p;
      else if (finalH === finalA) draw += p;
      else away += p;
    }
  }
  // Normalize the truncation remainder (< 1e-6 for sane λ) proportionally.
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

/** Calibrate (λH, λA) so the 0-0/90-min model matches a target consensus.
 *  Deterministic two-stage grid search minimizing squared error. */
export function calibrateLambdas(
  target: Probs,
  cfg: ModelConfig = DEFAULT_MODEL_CFG,
): { lambdaHome: number; lambdaAway: number; sse: number } {
  const fresh: MatchSituation = { scoreHome: 0, scoreAway: 0, minutesLeft: 90, redsHome: 0, redsAway: 0 };
  const sseFor = (lh: number, la: number) => {
    const p = outcomeProbs(lh, la, fresh, cfg);
    return (p.home - target.home) ** 2 + (p.draw - target.draw) ** 2 + (p.away - target.away) ** 2;
  };

  let best = { lambdaHome: 1.3, lambdaAway: 1.1, sse: Infinity };
  const scan = (loH: number, hiH: number, loA: number, hiA: number, step: number) => {
    for (let lh = loH; lh <= hiH + 1e-12; lh += step) {
      for (let la = loA; la <= hiA + 1e-12; la += step) {
        const sse = sseFor(lh, la);
        if (sse < best.sse) best = { lambdaHome: lh, lambdaAway: la, sse };
      }
    }
  };
  scan(0.2, 4.0, 0.2, 4.0, 0.05);                          // coarse
  const { lambdaHome: h, lambdaAway: a } = best;
  scan(Math.max(0.05, h - 0.05), h + 0.05, Math.max(0.05, a - 0.05), a + 0.05, 0.005); // refine
  return best;
}

/** Binary-outcome fractional Kelly stake for backing side at market prob p
 *  with model prob q, bankroll-fraction cap. f = k(q−p)/(1−p), clamped ≥ 0. */
export function kellyFraction(modelProb: number, marketProb: number, k: number): number {
  if (marketProb >= 1 || marketProb <= 0) return 0;
  return Math.max(0, (k * (modelProb - marketProb)) / (1 - marketProb));
}
