# The model

## Goal model
Independent Poisson goal counts per team (Maher, 1982, *Modelling association
football scores*; Dixon & Coles, 1997, JRSS-C, for the family's canonical
treatment). Full-match outcome probabilities by truncated double sum
(0–12 goals; truncation error < 1e-6 for λ < 4), conditioned in-play on the
current score.

## In-play evolution
- Remaining intensity λ_rem = λ · minutesLeft/90 — **uniform goal arrival**, a
  stated simplification (Dixon & Robinson, 1998, document time-inhomogeneity;
  a ramp is a config-level refinement, deliberately out of v1 scope).
- Minutes come from an EstimatedClock: TxLINE's `Clock{}` field is never
  populated (verified over 1,116 updates), so minutes are derived from
  `StatusId` phase-transition anchors (H1/H2 start) + frame timestamps.
- Red cards multiply remaining intensities (default: carded team ×0.70,
  opponent ×1.10 — convention, configurable, and honestly labeled as such).

## Calibration
Pre-match odds do not exist on this data tier (verified), so (λH, λA) are
fitted **at kickoff** to the median of the first 5 de-margined 1X2 consensus
readings by two-stage deterministic grid search (step 0.05 → 0.005) minimizing
squared error over (pH, pD, pA). Observed fits are tight (SSE ~1e-6–1e-8).

## Sizing
Binary-outcome fractional Kelly: f = k·(q−p)/(1−p), k = 0.25 by default,
floored at 0, with per-position and per-fixture caps. Stakes are paper units.

## Honesty constraints
- No LLM anywhere in the decision path; every function of state is pure and
  deterministic (golden-file test: same frames in → byte-identical decisions).
- The steady-state divergence strategy exists as a control arm: against a
  de-margined global consensus we EXPECT it to lose, and report what happens.
- Prices older than `stalenessHaltSec` (frame time) are not tradeable — stale
  quotes produce fictitious gaps.
