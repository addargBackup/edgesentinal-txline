# StablePrice shock-convergence study (generated)

How fast does TxLINE's de-margined consensus absorb a state shock? For
every goal/red card we log the instant model-vs-market gap and track it
until it converges (|gap| < ε = 0.02) or the horizon passes.

Shocks observed (|gap₀| > 0.01): **5**
Median half-life: **652s** · median time-to-convergence: **104s** (n=1)

| shock | minute | gap₀ | half-life (s) | converged (s) |
|---|---|---|---|---|
| goal_home | 30' | -0.026 | — | 104 |
| goal_away | 61' | -0.078 | — | >horizon |
| goal_home | 100' | 0.959 | 652 | >horizon |
| goal_away | 100' | -0.041 | — | >horizon |
| goal_home | 100' | 0.959 | — | >horizon |

The tradeable window for the sniper strategy is exactly this table.
