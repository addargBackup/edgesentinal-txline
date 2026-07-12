# Backtest results (generated — honest numbers, whatever they are)

Fixtures: 18175918, 18209181 · generated 2026-07-12T12:26:10.526Z

| strategy | positions | hit rate | P&L (units) | max drawdown |
|---|---|---|---|---|
| baseline | 1 | 100% | 1.14 | 0 |
| divergence | 2 | 0% | -17.54 | 17.54 |
| sniper | 1 | 0% | 0 | 0 |

Interpretation guide: `baseline` is the control arm (kickoff favorite,
held). `divergence` tests the model against a de-margined consensus in
calm play — we EXPECT ~zero edge there and say so. `sniper` trades only
the post-shock repricing window measured in CONVERGENCE.md.

## Model calibration (model vs market, sampled each minute)

| bucket | n | model avg | market avg | realized home-win |
|---|---|---|---|---|
| 0.0–0.2 | 142 | 0.020 | 0.139 | 1.000 |
| 0.2–0.4 | 56 | 0.332 | 0.526 | 1.000 |
| 0.4–0.6 | 309 | 0.496 | 0.608 | 1.000 |
| 0.6–0.8 | 67 | 0.727 | 0.754 | 1.000 |
| 0.8–1.0 | 454 | 0.938 | 0.766 | 1.000 |

_Realized column is per-sample (fixture outcome repeated across its samples); with few fixtures it validates direction, not magnitude — more corpus fixtures sharpen it._
