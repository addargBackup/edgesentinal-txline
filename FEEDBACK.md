# TxLINE API feedback (from building EdgeSentinel — quant/agent perspective)

## What we loved
1. **De-margined `Pct` on StablePrice** — an agent can treat the feed as honest
   probabilities directly; no vig-stripping stage, no bookmaker-mixture
   modeling. This is the single best API decision for algorithmic consumers.
2. **In-play odds density**: 1X2 updates every few seconds. Our headline
   research finding is a compliment: measured at full density, **StablePrice
   absorbs goals in ~0 seconds — the odds stream frequently reprices before
   the scores stream records the goal.** For a consensus product, that's
   remarkable. (It also honestly kills naive "react to the goal faster than
   the market" strategies — see docs/CONVERGENCE.md.)
3. Stats maps + `period==100` finality made deterministic settlement
   verification (Merkle proof → validateStatV2 `.view()`) straightforward.

## Friction
1. **`Clock{}` is in the schema but never populated.** In-play quant work
   needs a match clock; we reconstruct minutes from StatusId phase anchors,
   which wobbles around stoppage time. Please populate it or remove it.
2. **Historical odds backfill is awkward for agents**: the 5-minute bucket
   endpoints must be walked one by one across a match window, and score
   history includes days of pre-match coverage frames — a
   `/api/odds/historical/{fixtureId}` mirroring the scores endpoint would
   make backtesting a one-call affair.
3. A sparse/stale odds backfill produced quotes hours old with no staleness
   indicator; agents must guard on timestamps themselves. A `stale` flag or
   last-update watermark per market would help.
4. Same casing/SSE-body inconsistencies noted in our other tracks' feedback
   (PascalCase live records vs camelCase spec; SSE-framed historical body).

## Wishlist
- Competition-filtered SSE (`?competitionId=`) — agents ingest everything and
  filter client-side today.
- A documented "odds leads scores" ordering guarantee (or lack thereof):
  cross-stream event ordering is the thing an in-play agent most needs to
  reason about, and we had to measure it empirically.
