# Backtest results (generated — honest numbers, whatever they are)

Fixtures: 18175918, 18209181 · generated 2026-07-12T17:51:47.221Z

| strategy | positions | hit rate | P&L (units) | max drawdown |
|---|---|---|---|---|
| baseline | 2 | 100% | 1.05 | 0 |
| divergence | 2 | 0% | -10.51 | 10.51 |
| sniper | 1 | 0% | 0 | 0 |

Interpretation guide: `baseline` is the control arm (kickoff favorite,
held). `divergence` tests the model against a de-margined consensus in
calm play — we EXPECT ~zero edge there and say so. `sniper` trades only
the post-shock repricing window measured in CONVERGENCE.md.

## Model calibration (model vs market, sampled each minute)

| bucket | n | model avg | market avg | realized home-win |
|---|---|---|---|---|
| 0.0–0.2 | 65 | 0.046 | 0.267 | 1.000 |
| 0.2–0.4 | 65 | 0.332 | 0.533 | 1.000 |
| 0.4–0.6 | 302 | 0.492 | 0.610 | 1.000 |
| 0.6–0.8 | 55 | 0.738 | 0.768 | 1.000 |
| 0.8–1.0 | 320 | 0.921 | 0.915 | 1.000 |

_Realized column is per-sample (fixture outcome repeated across its samples); with few fixtures it validates direction, not magnitude — more corpus fixtures sharpen it._
