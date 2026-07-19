# EdgeSentinel

**An autonomous strategy-evaluation framework for in-play soccer markets on
[TxLINE](https://txline.txodds.com) feeds — with a measured answer to one
question: how fast does StablePrice consensus absorb a goal?**

**🔴 Live now:** [edgesentinel-agent.onrender.com](https://edgesentinel-agent.onrender.com) —
autonomous, unattended, trading paper positions against the real 2026 World
Cup Final on TxLINE's live devnet feed right now.

**📄 [Full technical documentation](docs/README.md)** — the Poisson/Skellam
model in full, all three strategies, shock convergence measurement,
tamper-evident commitments (with a real verified devnet transaction),
Merkle-proof settlement verification, the staleness incident, architecture,
and the judge runbook.

Not a bot with a green P&L screenshot. A framework that runs three strategies
on identical data, measures the market microstructure it's trading against,
commits every decision hash to Solana devnet at decision time (it cannot
retroactively edit its calls), verifies settlements against TxLINE Merkle
proofs, and **publishes honest results — including the negative ones.**

## The headline result (see docs/CONVERGENCE.md + docs/RESULTS.md, generated)
Measured at full odds density on a real recorded match, TxLINE's de-margined
consensus absorbs goals in **~0 seconds — the odds stream frequently reprices
before the scores stream records the goal.** The naive "beat the market to
the goal" edge does not exist at this feed quality; our sniper strategy's
tradeable window on a thinned feed turned out to be partly a sampling
artifact, and we say so. The steady-state divergence arm loses money against
the consensus exactly as theory predicts (control vs treatment by design).
A professional desk learns more from this than from a fake green curve.

## Architecture
One deployable process (`agent/`): TxLINE SSE ingest (vendored txline-kit) →
append-only SQLite event store → pure reducers (match state via StatusId
phases + EstimatedClock; market state via de-margined 1X2 Pct) → Poisson model
(docs/MODEL.md) → three strategy plugins → Kelly-sized paper book →
per-decision sha256 → devnet Memo commitments → Merkle-proof-verified
settlement (txoracle `validateStatV2 .view()`). Read-only dashboard + /healthz
+ /metrics on the same port. `REPLAY_BASE_URL` swaps the stream source;
**the backtest feeds the UNCHANGED pipeline from corpus files** — proven by a
golden-file test (same frames in → byte-identical decision log out).

Strategies (the arena):
| key | thesis | expectation |
|---|---|---|
| `baseline` | back the kickoff favorite, hold | the control arm |
| `divergence` | model vs consensus in calm play | ~zero/negative (stated up front) |
| `sniper` | trade the post-shock repricing window | whatever CONVERGENCE.md says the window is |

## Run it
```bash
pnpm install
pnpm test                     # 37 tests: model math (hand-computed), golden determinism
pnpm backtest                 # corpus-sample -> docs/RESULTS.md + docs/CONVERGENCE.md
pnpm agent                    # LIVE: devnet World Cup streams + dashboard :8795
KILL_SWITCH=1 pnpm agent      # circuit breaker demo (ingest continues, trading halts)
```
Config: `strategy.yaml` (thresholds, Kelly k, caps, staleness guard) — retune
without touching code. Commitments: `commitDecisions: true` + a funded devnet
wallet at `../.keys/devnet-wallet.json`.

## TxLINE endpoints used
`/auth/guest/start` + `/api/token/activate` (on-chain devnet free tier),
`/api/fixtures/snapshot`, `/api/scores/stream`, `/api/odds/stream`,
`/api/scores/stat-validation` (settlement proofs → txoracle CPI view),
`/api/scores/historical/{id}` + `/api/odds/updates/{d}/{h}/{5min}` (corpus).

## Status
- [x] Model + calibration unit-tested against hand-computed values
- [x] Golden-file determinism test green; 37/37 tests
- [x] Backtest on two real recorded matches → generated RESULTS/CONVERGENCE
- [x] Staleness guard (born from a real incident: a stale corpus quote
      produced a fictitious 0.96 gap — now untradeable by construction)
- [x] Dashboard verified live: deployed to Render (compiled with tsc, run
      under plain node — tsx's native esbuild dependency doesn't survive
      Render's runtime), tracking the real World Cup Final within seconds of
      deploy. A separate long-running local instance has traded live across
      the entire back half of the tournament (6 real fixtures, 26 shocks,
      real strategy P&L — see docs/README.md §10)
- [x] Memo commitments exercised end-to-end on devnet: real decision hashed
      and committed, signature verifiable on-chain (docs/README.md §6)
- [ ] docker-compose
# edgesentinal-txline
