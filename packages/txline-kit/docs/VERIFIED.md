# TxLINE API Field Guide

The sharp edges of the [TxLINE](https://txline.txodds.com) sports-data API,
mapped so you don't have to learn them the hard way. Every item here was
confirmed against live devnet data and the on-chain `txoracle` IDL — not just
read off the schema. Where the raw API surprises you, the note ends with the
[`txline-kit`](https://github.com/addargBackup/txline-kit) helper that already
handles it.

> TL;DR of the gotchas: live records are **PascalCase**, match phase lives in
> **`StatusId`** (not `GameState`), `/scores/historical` returns **SSE text on a
> 200** (not JSON), pre-match **odds don't exist**, and on-chain settlement is
> only sound if you check **`stat.period == 100`**.

---

## Auth & activation

Two credentials ride on every data request: a short-lived guest **JWT** and a
long-lived **API token**.

1. `POST {host}/auth/guest/start` → `{ "token": "<jwt>" }` (no body needed). The
   JWT expires in ~30 days; on a `401`, renew from the **same host** and keep
   your API token.
2. Activation is on-chain: ensure the Token-2022 ATA for the TxL mint exists,
   call `subscribe(serviceLevelId, weeks)` (weeks must be a multiple of 4;
   PDAs `["pricing_matrix"]` and `["token_treasury_v2"]`), then
   `POST /api/token/activate` with body `{ txSig, walletSignature, leagues }`
   and a `Bearer <jwt>` header. `walletSignature` is a base64
   `nacl.sign.detached` over the string `` `${txSig}:${leagues.join(",")}:${jwt}` ``.
3. Free World Cup tier: `serviceLevel 1`, `weeks 4`, `leagues []`.

Every request needs **both** `Authorization: Bearer <jwt>` **and** `X-Api-Token`.
A `403` almost always means you crossed devnet/mainnet credentials.

→ `txline-kit`: `await tx.auth.ensureActivated()` runs the whole flow once and
caches credentials; 401s renew transparently, single-flight.

---

## Score records

**Field names are PascalCase on the wire.** Live records look like
`{ FixtureId, GameState, StartTime, Action, Ts, Seq, StatusId, Score, Stats,
PlayerStats, Data, ... }` — *not* the camelCase some doc prose implies. Code to
the schema casing and your parser silently returns `undefined`.

**Match phase is in `StatusId`, not `GameState`.** `GameState` can sit on
`"scheduled"` for an entire live match (it's a coverage/schedule field). The
real phase progression is `StatusId`:
`null → 1 (NS) → 2 (H1) → 3 (HT) → 4 (H2) → 5 (F) → 100 (game_finalised)`.
Finality is the single record with `Action = "game_finalised"` and
`StatusId = 100`.

**`Stats` is a flat map of composed stat-key → cumulative value**, for every
period prefix at once, e.g. `{"1":2,"2":0,"7":5,"1007":3,"3007":2,...}`.
A resolution engine just reads `Stats` — no event replay needed. Keys are
`period_prefix + base` (base 1-8 = goals/yellows/reds/corners per team; prefix
0 = total, 1000 = H1, 3000 = H2, etc., so `3007` = 2nd-half home corners).

**The `Clock` field exists in the schema but was not populated** across a full
finished match (0 of 1,116 updates). If you need a match minute, estimate it
from `StatusId` transitions (H1/H2 start anchors) plus record timestamps.

→ `txline-kit`: `@txline-kit/constants` gives `STAT`, `PERIOD`,
`statKey()`/`parseStatKey()`, and `isLive()`/`isFinalised()` that read the
right field.

---

## Odds records

**Pre-match odds do not exist on the free tier.** `oddsSnapshot` returns `[]`
both before kickoff and after full time. StablePrice coverage is **in-play
only** — and dense: a single match yielded 66k+ records across ~53 markets
(1X2, over/under goals across many lines, Asian handicaps), full-match and
per-half.

**Use `Pct`, not `Prices`, for probability.** Each record carries
`PriceNames[]`, `Prices[]`, and `Pct[]`. `Pct` is the **de-margined** implied
probability as a 3-dp string (`"52.632"`), or `"NA"` on quarter-handicap lines.
`Bookmaker` is `"TXLineStablePriceDemargined"`. `MarketParameters` looks like
`"line=2.5"`, `MarketPeriod` like `"half=1"`.

**Discover markets, don't assume them.** Market availability varies per fixture;
group records by `(SuperOddsType, MarketPeriod, MarketParameters)`.

→ `txline-kit`: `pctToProbability()` and `discoverMarkets()` in
`@txline-kit/constants`.

---

## Streams (SSE)

- `/api/scores/stream` and `/api/odds/stream`. Data messages carry
  `id = "timestamp:index"` and a single JSON record as `data`. Heartbeats are
  `event: heartbeat`.
- The `Last-Event-ID` header resumes a stream where it dropped — use it, or a
  reconnect loses events. Optional `?fixtureId=` filters server-side.
- A stream that's open but silent outside a live match window is **normal**, not
  an error.

→ `txline-kit`: `tx.scoresStream()` / `tx.oddsStream()` are async iterables with
jittered-backoff reconnect, `Last-Event-ID` resume, and reader cleanup on early
`break`.

---

## The one that isn't JSON

`GET /api/scores/historical/{fixtureId}` returns **SSE-framed text**
(`data: {...}\n\n` frames) on a `200`, unlike every sibling endpoint. A naïve
`JSON.parse` throws on a successful response. (It returns the full update
sequence, valid when the match start is between ~2 weeks and ~6 hours in the
past.)

→ `txline-kit`: the client auto-detects and parses this into a normal array.

---

## On-chain validation (`txoracle`)

The real `validate_stat` grammar — confirmed from the IDL, and *not* quite what
the prose suggests:

```
validate_stat(
  ts: i64,                              // must equal summary.updateStats.minTimestamp
  fixture_summary: ScoresBatchSummary,
  fixture_proof: Vec<ProofNode>,
  main_tree_proof: Vec<ProofNode>,
  predicate: TraderPredicate,           // { threshold: i32, comparison: GreaterThan | LessThan | EqualTo }
  stat_a: StatTerm,
  stat_b: Option<StatTerm>,
  op: Option<BinaryExpression>,         // Add | Subtract
) -> bool                               // account: daily_scores_merkle_roots
```

Semantics: `combined = stat_a.value (op stat_b.value)?`, then
`combined <comparison> threshold`. So:
- **1X2 home win** — `stat_a` = T1 goals, `stat_b` = T2 goals, `op = Subtract`, `GreaterThan 0` (draw = `EqualTo 0`, away = `LessThan 0`)
- **Total goals over 2.5** — `op = Add`, `GreaterThan 2`

`validate_stat_v2(payload, strategy)` takes an `NDimensionalStrategy` whose
predicate indexes refer to **positions in the requested `statKeys` list**, not
key values, and every requested stat must be covered.

**The soundness rule that isn't in the docs:** a proven stat carries
`period == 100` **only** in the `game_finalised` record. A mid-match proof
carries the live phase id instead (e.g. `period: 4` during H2). If your
settlement logic doesn't require `period == 100`, someone can settle a market
on a *halftime* score. This one check is the difference between a sound
settlement engine and a exploitable one.

**Proofs are small** — a two-stat final proof is ~500 bytes of borsh, so on-chain
settlement fits comfortably in one transaction. Read-only verification:
`program.methods.validateStatV2(payload, strategy)
.accounts({ dailyScoresMerkleRoots }).view()` with a ~1.4M compute-unit budget
pre-instruction. The daily-roots PDA is
`["daily_scores_roots", epochDay as u16 LE]` where
`epochDay = floor(summary.updateStats.minTimestamp / 86_400_000)`.

→ `txline-kit`: `@txline-kit/client/proofs` ships `toBytes32`, `toProofNodes`,
`buildStatValidationInput`, the `strategy` builders, and `dailyScoresRootsPda`.

---

## Endpoints worth knowing

Beyond the headline snapshot/stream/validation routes, these exist and are
useful:
- `/api/{scores,odds}/updates/{epochDay}/{hourOfDay}/{interval}` — time-bucketed
  history; `interval` is the 0-indexed **5-minute** slot within the hour (0-11).
  This is how you backfill in-play odds for a finished match.
- `/api/fixtures/validation`, `/api/fixtures/batch-validation` — fixture proofs.
- `/api/odds/validation` → `validate_odds` — yes, odds updates are Merkle-provable
  too, not just scores.

---

## Constants

| | devnet | mainnet |
|---|---|---|
| API base | `https://txline-dev.txodds.com/api` | `https://txline.txodds.com/api` |
| `txoracle` program | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` |
| free World Cup tier | level 1 — 0s delay | level 1 (60s) / level 12 (real-time) |

World Cup `competitionId = 72`. Never mix networks: JWT, API token, program id,
and IDL must all come from the same side.

---

*Compiled while building three apps on this feed. If TxLINE changes a behavior
here, [open an issue](https://github.com/addargBackup/txline-kit/issues) —
the kit's tests will usually catch it first.*
