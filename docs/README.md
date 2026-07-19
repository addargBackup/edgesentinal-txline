# EdgeSentinel — Technical Documentation

An autonomous strategy-evaluation framework for in-play soccer markets on
[TxLINE](https://txline.txodds.com) — three strategies competing on identical
data, a measured (not assumed) answer to how fast the market absorbs a shock,
tamper-evident on-chain decision commitments, and Merkle-proof-verified
settlement. Live at **[edgesentinel-agent.onrender.com](https://edgesentinel-agent.onrender.com)**.

1. [Powered by TxLINE](#1-powered-by-txline)
2. [Core idea — and why it's honest by construction](#2-core-idea--and-why-its-honest-by-construction)
3. [The model](#3-the-model) — Poisson/Skellam math, EstimatedClock, calibration
4. [The three strategies](#4-the-three-strategies--the-arena)
5. [Shock detection and convergence measurement](#5-shock-detection-and-convergence-measurement)
6. [Tamper-evident commitments and verified settlement](#6-tamper-evident-commitments-and-verified-settlement)
7. [Determinism, testing, and the staleness incident](#7-determinism-testing-and-the-staleness-incident)
8. [Architecture](#8-architecture)
9. [TxLINE endpoints used](#9-txline-endpoints-used) (+ why an SDK, + raw → SDK mapping)
10. [Live results (real, ongoing)](#10-live-results-real-ongoing)
11. [Run it / judge runbook](#11-run-it--judge-runbook)

See also: [FEEDBACK.md](../FEEDBACK.md) for our experience building a
quant/agent product on the TxLINE API, and [docs/MODEL.md](MODEL.md),
[docs/CONVERGENCE.md](CONVERGENCE.md), [docs/RESULTS.md](RESULTS.md) —
generated, not hand-written.

---

## 1. Powered by TxLINE

**TxLINE is not one data source among several — it is the entire input
surface.** EdgeSentinel has no other odds provider, no other score feed, and
no admin panel for typing in a result. Every number the model calibrates
against, every shock it detects, and every settlement it verifies is
downstream of a TxLINE call, and every one of those calls goes through one
vendored client ([`packages/txline-kit`](../packages/txline-kit)) — a single,
auditable choke point for all external data in the codebase.

| Stage | What happens | TxLINE call |
|---|---|---|
| **Ingest** | Live score and odds frames stream in continuously | `scoresStream()` / `oddsStream()` (SSE) |
| **Calibration** | λ_home, λ_away fitted at kickoff to the market's own opening consensus | median of the first 5 de-margined 1X2 `Pct` readings off `oddsStream()` |
| **Match state** | Score, red cards, and match phase | the `Stats` map (keys 1/2/5/6) and `StatusId` on `ScoreUpdate` frames |
| **Clock** | Minutes elapsed, since TxLINE never populates `Clock{}` | reconstructed from `StatusId` H1/H2 phase-transition frame timestamps |
| **Shock detection** | A goal or red card, and the instant model-vs-market gap at that moment | the same two streams, cross-referenced by frame timestamp |
| **Settlement** | Proof that a fixture's final score is genuinely final, not a mid-match snapshot | `statValidation()` → a Merkle proof, checked read-only against TxLINE's on-chain `txoracle` program via `validateStatV2(...).view()` |
| **Backtest / judge mode** | Byte-for-byte replay of a real recorded match through the unchanged pipeline | `scoresHistorical()` + odds bucket endpoints (fetched once) → `txline-replay` |

**The most consequential fact in that table is settlement.** EdgeSentinel
does not take TxLINE's live score at face value and mark a position settled.
It waits for the `game_finalised` record, fetches a Merkle proof of the exact
final stat values, and calls `txoracle::validateStatV2` **on-chain, as a
read-only simulation** — the same verification a settlement-critical
consumer like ProofPlay uses for real fund movement, applied here to a paper
ledger because *the discipline of proving it is the point*, not the money.
A position's `verified` flag only flips to `1` after that on-chain check
passes. We have a real example: fixture `18241006`, `divergence` strategy,
verified with a real `eventStatRoot` on devnet.

TxLINE data reaches the dashboard the same way it reaches the model: the
browser never talks to TxLINE. It calls the agent's own read-only `/api/*`
routes, which read from SQLite, which is populated exclusively by the
ingest pipeline. One path in, no side channels, nothing hand-edited.

---

## 2. Core idea — and why it's honest by construction

Every "trading bot" demo has the same failure mode: a green P&L number with
no way to know if it's signal, luck, or survivorship bias in what got shown.
EdgeSentinel is built to make that failure mode structurally hard:

- **Three strategies run on identical data, simultaneously**, so any one
  strategy's result is a comparison, not a lonely number.
- **One of the three is designed to lose.** `divergence` (steady-state
  model-vs-consensus trading) is the stated control arm — against a
  de-margined global consensus we expect roughly zero or negative edge, and
  the docs say so *before* citing the number.
- **Every decision is hashed and, when enabled, committed to Solana devnet
  at decision time** — a `sha256` of the canonical decision record, sent as
  a Memo transaction, before the outcome is known. The agent cannot
  retroactively edit a call after seeing how it turned out, because the hash
  is on a public, timestamped ledger the moment the decision is made.
- **Settlement is verified, not assumed** — see §1 and §6.
- **The headline finding is negative for the naive strategy it disproves.**
  Measured at real odds density, TxLINE's de-margined consensus absorbs a
  goal in close to zero seconds — the odds stream frequently reprices
  *before* the scores stream even records the goal. The "beat the market to
  the goal" edge that a naive in-play bettor assumes exists mostly doesn't,
  at this feed's quality. We built the convergence study specifically to
  measure this rather than assume it, and published the result even though
  it undercuts the more exciting-sounding pitch.

A professional quant desk learns more from an honest instrument than a
faked equity curve. That's the actual product here — not a bot, an
**instrument**.

## 3. The model

### Goal model
Independent Poisson goal counts per team, conditioned in-play on the current
score — the canonical Maher (1982) / Dixon & Coles (1997) family. Full-match
outcome probabilities come from a truncated double sum over `0..maxGoals`
(default 12; truncation error `< 1e-6` for `λ < 4`), implemented in
[`engine/model.ts`](../agent/src/engine/model.ts):

```
P(home) = Σ_x Σ_y  Poisson(x; λ_h) · Poisson(y; λ_a)   for x+scoreHome > y+scoreAway
```

`poissonPmf` is computed in log-space (`-λ + k·ln(λ) - ln(k!)`) to stay
numerically stable at the tails, with a deterministic point mass at `k=0`
when `λ→0` (a red-carded team's intensity can legitimately collapse near
zero — the naive `λ^k` formula breaks there).

### In-play evolution
Remaining intensity is **uniform arrival**, a stated simplification:
`λ_remaining = λ_fullmatch × (minutesLeft / 90)`. This is a deliberate v1
scope decision — Dixon & Robinson (1998) document real time-inhomogeneity
(goals aren't uniformly likely across 90 minutes), and a non-uniform ramp is
called out in `docs/MODEL.md` as a named, config-level refinement left out
on purpose rather than silently assumed away.

Red cards multiply **remaining** intensity for both sides: the carded team's
side by `redCardSelf` (default `0.70`), the opponent's by `redCardOpp`
(default `1.10`) — configurable in `strategy.yaml`, and honestly labeled as
convention rather than fitted.

### EstimatedClock — a real, documented TxLINE gotcha
TxLINE's `Clock{running, seconds}` field exists in the schema and was never
once populated across 1,116+ real score updates we captured. There is no
usable match clock in the feed. `engine/state.ts` reconstructs one instead,
from `StatusId` phase-transition **frame timestamps**:

```
estimateMinute =
  45                                     if StatusId == HALFTIME
  min(45 + (now − h2AnchorTs)/60_000, 100)   if second half has started
  min((now − h1AnchorTs)/60_000, 50)         if only first half has started
  0                                           otherwise
```

`h1AnchorTs`/`h2AnchorTs` are captured once, the instant `StatusId` first
transitions into `PHASE.H1` / `PHASE.H2`. Every downstream consumer — the
model's `minutesLeft`, the strategies' entry windows, the dashboard's chart
x-axis — reads this same estimate, so live play and 60×-accelerated backtest
replay produce **identical** decisions off identical frames, which is
exactly what the golden-file test in §7 verifies.

### Calibration at kickoff, not before
Pre-match odds do not exist on TxLINE's free World Cup tier — snapshots
return empty until kickoff, verified directly. So `(λ_home, λ_away)` are
fitted **at kickoff** to the market's own opening read: the **median** of
the first 5 de-margined 1X2 consensus readings (median, not mean, to resist
one noisy early tick), via a deterministic two-stage grid search —
`calibrateLambdas()` in `engine/model.ts`:

1. Coarse scan: `λ ∈ [0.2, 4.0]` in steps of `0.05`, minimizing squared
   error `(p_home − target_home)² + (p_draw − target_draw)² + (p_away − target_away)²`.
2. Refine scan: `±0.05` around the coarse optimum in steps of `0.005`.

No gradient descent, no randomness — a grid search is trivially
reproducible and its error surface is well-behaved for this problem size.
Observed fits are tight: SSE on the order of `1e-6`–`1e-8` in real
calibrations logged by the running agent (e.g. `lambdaHome:1.660,
lambdaAway:0.680, sse:3.10e-7` from an actual test run against fixture
`18209181`).

**Critical audit-found correctness rule**: calibration only collects
readings *after* kickoff has actually happened, gated the same way as
trading (§7) — corpus and live backfills can both contain stale pre-window
quotes, and calibrating a match's entire model off a stale quote silently
poisons every decision made for that fixture.

### Sizing
Binary-outcome fractional Kelly: `f = k·(q−p)/(1−p)`, floored at 0, `k=0.25`
by default (`strategy.yaml: kellyK`), plus a hard per-position cap
(`maxStakePerPosition: 50`) and per-fixture exposure cap
(`maxExposurePerFixture: 150`). Stakes are paper units — there is no real
money and no devnet token movement in the trading path itself (only the
*commitment* of the decision, and the *proof* of settlement, touch chain).

## 4. The three strategies — the arena

| key | thesis | expected result | why it exists |
|---|---|---|---|
| `baseline` | Back the kickoff favorite (whichever side the model favors at kickoff), hold to full time, one position per fixture. | The control arm — nobody can argue with "just back the favorite." | Every framework needs a floor to compare against. |
| `divergence` | In calm play (`minMinute..maxMinute`, no recent shock), open when `|model − market| ≥ entryGap` (default `0.06`); close on reversion (`< exitGap`, default `0.02`) or if the gap flips sign against the position. | **~zero or negative**, stated up front, against an efficient de-margined consensus. | The honest treatment-vs-control comparison — this is the strategy we predict will *not* work, and report on regardless. |
| `sniper` | **The flagship.** In steady state the consensus is smarter than our model — but for a short window after a shock (goal, red card), the model reprices in one tick while the consensus converges over a *measurable* interval. Enter if `|gap| ≥ entryGap` (default `0.05`) within `windowMinutes` (default 3) of a shock; exit on convergence (`|gap| ≤ convergedGap`, default `0.015`) or `timeoutMinutes` (default 10). | Whatever `docs/CONVERGENCE.md` actually measures — the strategy's tradeable window *is* the convergence table, not a guess. | Tests the one hypothesis worth testing: is there a real repricing lag, and if so, how wide is it. |

All three strategies are pure functions of `(t: tick snapshot, open: open
positions, cfg: strategy.yaml)` → `intents[]` — no I/O, no randomness, no
hidden state beyond what's passed in. `agent/src/strategies/index.ts`
composes them; `pipeline.ts` runs every registered strategy against every
tick, independently, so their books never interact.

Real accumulated results from the long-running live agent, across the
actual World Cup fixtures it has traded since deployment (not backtest —
live, paper, ongoing):

| strategy | positions | wins | P&L (paper units) |
|---|---|---|---|
| `divergence` | 5 | 3 | **+32.41** |
| `baseline` | 3 | 2 | −0.04 |
| `sniper` | 2 | 0 | −3.91 |

We are not hiding that `sniper` — the flagship hypothesis — is currently
down on a small live sample. That's the point: three strategies, one
scoreboard, no editing after the fact.

## 5. Shock detection and convergence measurement

A shock fires the instant `reduceMatch()` sees a `Stats` value increase for
goals (keys `1`/`2`) or red cards (keys `5`/`6`) between consecutive frames
— `engine/state.ts`. At that exact frame, the pipeline records `gap₀`: the
signed model-vs-market probability gap at the moment of the shock, **only if
the market quote is fresh** (§7) — if the last odds tick is older than
`stalenessHaltSec`, `gap₀` is recorded as `null`, not a fabricated number.

From `gap₀` the pipeline tracks the gap forward in time until it decays
below `convergence.epsilon` (default `0.02`) or `convergence.horizonMinutes`
(default 15) passes, logging `half_life_ms` (time to halve the initial gap)
and `converged_ms` (time to fall under epsilon) per shock. This is
independent measurement — it runs whether or not `sniper` actually traded
that shock, which is what makes `docs/CONVERGENCE.md` a real instrument
rather than a strategy's own after-the-fact justification.

A real measured result (`docs/CONVERGENCE.md`, generated from an actual
recorded match, reproducible via `pnpm backtest`):

| shock | minute | gap₀ | converged (s) |
|---|---|---|---|
| goal_home | 30' | −0.011 | 0 |
| goal_away | 61' | −0.093 | >horizon |
| goal_home | 61' | 0.012 | 0 |
| goal_home | 66' | 0.012 | 0 |

Three of four shocks converge essentially instantly (0 seconds — the
consensus had already repriced by the next tick); one takes longer than the
15-minute horizon. **This is the literal, measured answer to "how fast does
the market absorb a goal" for this feed** — not a marketing claim, a number
with a query behind it. The live agent has since logged 26 real shocks
across the whole tournament, 5 with a full measured convergence time,
visible on the live dashboard's "Shock convergence" panel.

## 6. Tamper-evident commitments and verified settlement

### Commitments
`Committer` (`agent/src/commit.ts`) maintains a fire-and-forget,
concurrency-1 queue: every trading decision (when `strategy.yaml:
commitDecisions` is `true`) gets its canonical record hashed (`sha256`) and
sent as a Solana devnet **Memo** transaction —
`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, data `edgesentinel:<hash>` —
at decision time, before the position closes or the fixture settles.
Trading itself never blocks on chain confirmation (the queue drains
independently); a failed commit is logged and retried on the next enqueue,
it never crashes the agent.

**We verified this end-to-end, live, for real**, using the standalone
`agent/src/tools/commit-once.ts` tool against a real decision from the
running agent's own ledger:

- Decision: `baseline` strategy, fixture `18175918`, opened `home`, stake
  `2.16`, reason `"kickoff favorite (control arm)"`.
- Canonical hash: `7152c64c48f0e56caa69c25820314d0683020da12518dabe72b141495fc56937`
- Devnet Memo transaction: `4SaqVPNgybban59CrwFcE7b3H4xugA2ognd9impA6buu5XrPmoYUVHKLn7JtdBbPbCirz8MscHiwawfXEpGmTpTT`

That signature is a real, checkable devnet transaction. The property this
buys: once that Memo lands, nobody — including us — can produce a different
decision record that hashes to the same value and claim it's what the agent
"really" decided. The commitment is the decision, timestamped, before the
outcome existed.

### Verified settlement
`verifySettlement()` (`agent/src/settle.ts`) runs the instant a fixture's
`game_finalised` record arrives. It fetches TxLINE's Merkle proof for the
final score (`statValidation({ fixtureId, seq: finalSeq, statKeys: [1, 2] })`),
builds an on-chain predicate — `(homeGoals − awayGoals) {>, =, <} 0` matching
the actual result — and calls `txoracle::validateStatV2(...).view()` as a
**read-only on-chain simulation** (no transaction fee, no state change,
`fixture_validation_view_only` pattern from TxODDS's own examples). Only if
that call returns `true` does a position's `verified` flag flip to `1`,
alongside the real `eventStatRoot` the proof resolved to.

Real example from the live ledger: position id `10`, fixture `18241006`,
`divergence` strategy, `verified = 1`. If TxLINE's proof had disagreed with
the score the pipeline observed live, this call would return `false` and
the ledger would stay explicitly *unverified* — not silently trusted.

## 7. Determinism, testing, and the staleness incident

### Golden-file determinism
`agent/test/golden.test.ts` replays a fixed set of real recorded frames
through the **exact same pipeline** used live, and asserts the resulting
decision log is **byte-identical** to a committed golden file. This is the
proof that "the backtest feeds the unchanged pipeline" isn't a claim — it's
a test that fails the moment live and replay code paths diverge even
slightly. 37/37 tests green, including hand-computed model math (Poisson
PMF values, Kelly fractions, calibration convergence) checked against
independently derived expected values, not just "doesn't throw."

### The staleness incident (real, audit-found)
Early in development, a corpus backfill produced quotes hours old with no
staleness signal from TxLINE itself. A live model probability compared
against an hours-stale market quote produces a **fictitious** gap — in one
real case, a spurious `0.96` divergence that would have looked like the
best trading opportunity of the match and was actually just stale data. The
fix, `stalenessHaltSec` (default 120s, `strategy.yaml`), makes a quote older
than that threshold **untradeable by construction** — not filtered after
the fact, structurally excluded before a strategy ever sees it:

```ts
const market = c.market.latest && frameTs - c.market.latest.frameTs <= staleMs
  ? c.market.latest
  : null;   // strategies literally cannot see a stale quote
```

The same freshness rule was subsequently found (self-audit) to be missing
from three other paths that touch market quotes, and fixed identically in
each:
1. **Calibration** — collecting kickoff-consensus readings from a stale
   pre-window quote poisons the whole match's model (§3).
2. **Convergence measurement** — sampling model-vs-market for the
   convergence study off a stale quote would fabricate impossible data
   points in `docs/CONVERGENCE.md` itself.
3. **Shock capture** — `gap₀` at the instant of a goal/red card is recorded
   as `null`, not a number, when the market quote at that instant is stale
   — an honest "we don't know," not a fabricated value.

### Kill switch
`KILL_SWITCH=1` halts trading (`onDecision` returns before any position
opens or closes) while ingest, measurement, and the dashboard keep running
— a real circuit breaker, not a config flag that just stops logging.

## 8. Architecture

```
TxLINE API (live or replay)
      │
      ▼
txline-kit (vendored SDK)
      │
      ▼
ingest: scoresStream() + oddsStream() (SSE, auto-reconnect)
      │
      ▼
pure reducers (engine/state.ts) ──▶ MatchState (StatusId phases, EstimatedClock,
      │                              score, red cards) + MarketState (de-margined 1X2)
      ▼
Poisson/Skellam model (engine/model.ts) ──▶ calibrated λ, outcome probs, Kelly sizing
      │
      ▼
three strategy plugins (strategies/*.ts) ──▶ open/close intents, independently
      │                                       against identical ticks
      ▼
append-only SQLite event store (frames, decisions, positions, shocks)
      │                    │
      │                    └──▶ Committer ──sha256──▶ Solana devnet Memo (commit.ts)
      │
      └──▶ on game_finalised: verifySettlement() ──▶ TxLINE Merkle proof
             ──▶ txoracle::validateStatV2().view() ──▶ verified flag + eventStatRoot

Fastify (server.ts): /healthz, /metrics, /api/summary, /api/series/:id,
                      + the static dashboard (public/index.html) — same port,
                      same process as the trading agent, read-only ops surface.
```

- **`packages/txline-kit`** — vendored SDK; the single choke point for all
  TxLINE access (auth, REST, SSE, Merkle-proof helpers, replay server).
- **`agent/src/engine/`** — pure, deterministic reducers and the Poisson
  model. Zero I/O in this directory by design — it's what the golden-file
  test holds fixed.
- **`agent/src/strategies/`** — the three plugins, each a pure function.
- **`agent/src/pipeline.ts`** — the tick loop: feeds every strategy every
  frame, enforces the staleness gate everywhere a quote is read, drives
  shock detection and convergence measurement.
- **`agent/src/commit.ts`** — the Memo commitment queue.
- **`agent/src/settle.ts`** — Merkle-proof settlement verification.
- **`agent/src/server.ts`** — the one process's read-only ops/dashboard
  surface (Fastify + `@fastify/static`).
- **`agent/src/backtest.ts`** — runs the unchanged pipeline against
  `corpus-sample/` and generates `docs/RESULTS.md` / `docs/CONVERGENCE.md`.
- **`agent/src/tools/`** — one-shot operational tools (`commit-once.ts`,
  `verify-live.ts`) used to exercise commitment/verification independent of
  the long-running agent process.

## 9. TxLINE endpoints used

| Endpoint | Used for |
|---|---|
| `POST /auth/guest/start` | Guest session |
| `POST /api/token/activate` | On-chain-verified API token activation (devnet free tier) |
| `GET /api/scores/stream` (SSE) | Live match state, shock detection, finality |
| `GET /api/odds/stream` (SSE) | Live de-margined 1X2, model-vs-market gap, calibration |
| `GET /api/scores/stat-validation` | Merkle proof of final stats → settlement verification |
| `GET /api/scores/historical/{id}` + odds bucket endpoints | Corpus for backtest / judge mode |
| `txoracle::validateStatV2` (on-chain, read-only `.view()`) | On-chain proof verification, no transaction cost |

### Why an SDK instead of calling these directly

We built [`txline-kit`](../packages/txline-kit) rather than hitting the raw
API from `agent/` directly because a quant instrument's entire credibility
rests on getting a handful of non-obvious feed behaviors exactly right,
every time, not once:

- **`Clock{}` is never populated.** Get this wrong and every minute
  estimate, every entry window, every calibration is silently wrong.
- **Pre-match odds don't exist** on the free tier. Code that doesn't know
  this will calibrate against an empty snapshot and fail confusingly instead
  of at a clear, documented decision point.
- **`/scores/historical` returns SSE-framed text**, not JSON, unlike every
  sibling endpoint — exactly the kind of inconsistency that breaks a
  backtest pipeline the first time someone actually runs it.
- **The Merkle-proof payload has to be shaped exactly right** for
  `validateStatV2`'s on-chain predicate grammar to accept it — a settlement
  verification path is the worst possible place to hand-roll this per
  project.
- **Auth is a multi-step flow** (guest JWT → activation → transparent
  renewal on 401) — one tested implementation instead of three
  slightly-different ones across our three tracks.

### Raw endpoints replaced by SDK calls

| Raw endpoint (what you'd call by hand) | SDK call (what we call instead) |
|---|---|
| `POST /auth/guest/start` + `POST /api/token/activate` (+ manual 401 retry) | `tx.auth.ensureActivated()` |
| `GET /api/scores/stream` (raw `EventSource`, manual reconnect) | `for await (const msg of tx.scoresStream())` |
| `GET /api/odds/stream` (raw `EventSource`, manual reconnect, manual de-margin bookkeeping) | `for await (const msg of tx.oddsStream())` |
| `GET /api/scores/stat-validation?fixtureId=&seq=&statKeys=` | `tx.statValidation({ fixtureId, seq, statKeys })` |
| Manual borsh/PDA work to call `txoracle::validateStatV2` | `buildStatValidationInput`, `dailyScoresRootsPda`, `loadTxoracleIdl`, `strategy.build/binary` from `@txline-kit/client/proofs` |
| `GET /api/scores/historical/{fixtureId}` (+ manual SSE-body parsing) | `tx.scoresHistorical(fixtureId)` |

Devnet program addresses: `txoracle` `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`,
Memo `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`.

## 10. Live results (real, ongoing)

The deployed agent ([edgesentinel-agent.onrender.com](https://edgesentinel-agent.onrender.com))
has been running continuously against live TxLINE World Cup streams. As of
this writing it has already logged real shocks from the actual 2026 World
Cup Final (fixture `18257739`) within seconds of coming online. A
longer-running local instance — same code, same pipeline — has traded
**live, continuously, across the entire back half of the tournament**,
producing the strategy table in §4 and 26 real logged shocks (5 with full
measured convergence) across 6 real fixtures, including both the Final and
the third-place playoff. None of this is backtested; it is the actual
autonomous agent, unattended, against real matches as they happened.

## 11. Run it / judge runbook

```bash
pnpm install
pnpm test                     # 37 tests: hand-computed model math, golden determinism
pnpm backtest                 # corpus-sample -> docs/RESULTS.md + docs/CONVERGENCE.md
pnpm agent                    # LIVE: devnet World Cup streams + dashboard on :8795
KILL_SWITCH=1 pnpm agent      # circuit-breaker demo: ingest continues, trading halts
```

Config lives entirely in `strategy.yaml` — thresholds, Kelly `k`, exposure
caps, the staleness guard, `commitDecisions` — retune without touching code.
Commitments and settlement verification need a funded devnet wallet at
`../.keys/devnet-wallet.json` (or `ANCHOR_WALLET`); everything else
(ingest, model, strategies, dashboard) runs with just `TXLINE_API_TOKEN`.
See the root [README.md](../README.md) for the live dashboard URL and full
status.
