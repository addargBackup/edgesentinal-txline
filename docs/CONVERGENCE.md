# StablePrice shock-convergence study (generated)

How fast does TxLINE's de-margined consensus absorb a state shock? For
every goal/red card we log the instant model-vs-market gap and track it
until it converges (|gap| < ε = 0.02) or the horizon passes.

Shocks observed (|gap₀| > 0.01): **4**
Median half-life: **—s** · median time-to-convergence: **0s** (n=3)

| shock | minute | gap₀ | half-life (s) | converged (s) |
|---|---|---|---|---|
| goal_home | 30' | -0.011 | — | 0 |
| goal_away | 61' | -0.093 | — | >horizon |
| goal_home | 61' | 0.012 | — | 0 |
| goal_home | 66' | 0.012 | — | 0 |

The tradeable window for the sniper strategy is exactly this table.
