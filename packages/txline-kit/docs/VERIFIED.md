# VERIFIED.md — resolved API ambiguities (ground truth for all three projects)

Source of truth: `vendor/docs.yaml` (OpenAPI 1.5.2, fetched 2026-07-11),
`tx-on-chain` examples repo (github.com/txodds/tx-on-chain, cloned 2026-07-11),
devnet IDL `txoracle.json` v1.5.5, and live smoke tests against
`txline-dev.txodds.com`.

## (a) validate_stat semantics — RESOLVED (design-correcting!)
The earlier assumption "operator compares stat1 vs stat2" was WRONG. Actual IDL:

```
validate_stat(
  ts: i64,                              // must equal summary.updateStats.minTimestamp
  fixture_summary: ScoresBatchSummary,  // { fixture_id: i64, update_stats, events_sub_tree_root: [u8;32] }
  fixture_proof: Vec<ProofNode>,
  main_tree_proof: Vec<ProofNode>,
  predicate: TraderPredicate,           // { threshold: i32, comparison: GreaterThan|LessThan|EqualTo }
  stat_a: StatTerm,                     // { stat_to_prove: ScoreStat, event_stat_root: [u8;32], stat_proof }
  stat_b: Option<StatTerm>,
  op: Option<BinaryExpression>,         // Add | Subtract
) -> bool                               // accounts: { daily_scores_merkle_roots }
```
Semantics: `combined = stat_a.value (op stat_b.value)?`, then `combined <comparison> threshold`.
- 1X2 home win:  stat_a=T1 goals, stat_b=T2 goals, op=Subtract, GreaterThan 0
- 1X2 draw:      same, EqualTo 0;  away win: LessThan 0
- Total O/U 2.5: op=Add, GreaterThan 2 (over) / LessThan 3 (under)

validate_stat_v2(payload: StatValidationInput, strategy: NDimensionalStrategy):
- StatValidationInput { ts, fixture_summary, fixture_proof, main_tree_proof,
  event_stat_root: [u8;32], stats: Vec<StatLeaf{ stat, stat_proof }> }
- NDimensionalStrategy { geometric_targets: Vec<{stat_index:u8, prediction:i32}>,
  distance_predicate: Option<TraderPredicate>,
  discrete_predicates: Vec<StatPredicate> }
- StatPredicate = Single{index, predicate} | Binary{index_a, index_b, op, predicate}
- indexes refer to POSITIONS in the requested statKeys list, not key values.
- Geometric targets + distance predicate = "prediction closeness" primitive
  (e.g. closest-scoreline markets). Every requested stat must be covered.

Working call pattern (from subscription_scores_1stat.ts): map API proof hashes with
`Array.from(n.hash)` (API returns byte arrays), `new BN()` for i64 fields, rename
`summary.eventStatsSubTreeRoot` -> `eventsSubTreeRoot`, PDA
`[Buffer.from("daily_scores_roots"), new BN(epochDay).toBuffer("le", 2)]` where
`epochDay = floor(summary.updateStats.minTimestamp / 86_400_000)`. Read-only check via
`.methods.validateStatV2(payload, strategy).accounts({dailyScoresMerkleRoots}).view()`
with a 1_400_000 compute-unit budget preInstruction. CPI works the same from a program.

## LIVE-DATA FINDINGS (2026-07-11, fixture 18209181 France vs Morocco, finished 2-0)

### Score records are PascalCase and carry a full Stats map
Live records: `{FixtureId, GameState, StartTime, Action, Ts, Seq, StatusId, Score,
Stats, PlayerStats, Data, ...}` — PascalCase, NOT the camelCase in older doc prose.
`Stats` = map of composed statKey -> cumulative value for EVERY period prefix, e.g.
`{"1":2,"2":0,"7":5,"1007":3,"3007":2,...}`. Resolution engines just read Stats.

### Phase lives in StatusId, NOT GameState
`GameState` stayed "scheduled" all match (it's a coverage/schedule field).
Observed StatusId sequence: null(pre) -> 1(NS) -> 2(H1) -> 3(HT) -> 4(H2) -> 5(F)
-> 100(game_finalised, exactly one record, Action="game_finalised").
Track phases via StatusId with the PHASE constants; finality via isFinalised().

### CRITICAL SOUNDNESS RULE: stat.period == 100 marks finality
statsToProve from the FINAL seq: `{"key":1,"value":2,"period":100}` (period=100
even for H1 keys like 1001). From a MID-MATCH seq (H2, score 1-0):
`{"key":1,"value":1,"period":4}` — period = phase id of the proven record.
=> An on-chain settle instruction MUST require stat.period == 100; that makes
mid-match proofs unusable for settlement. Also: `key` is the FULL composed statKey
(request 1001 -> key 1001), so match keys exactly against the market spec.

### Proofs are tiny — single-tx settlement is viable
Final-seq proof for statKeys=1,2,1001: subTree=1 node, mainTree=1 node,
statProofs=[4,2,2] nodes; ~534 bytes of borsh payload. Note the proof summary's
updateStats covers a batch (updateCount=1 here); ts arg = its minTimestamp.

### (c) Clock: NOT populated
0 of 1116 updates had Clock set. Estimate match time from StatusId transitions
(H1 start / HT / H2 start anchors) + event record Ts (+ Data.Minutes when present).

### (d) Odds: rich IN-PLAY only; snapshots empty pre-match and post-match
oddsSnapshot returned 0 records both for a finished match and an upcoming one
(19h before kickoff). But the 5-minute bucket endpoints during the match window
yielded 66,337 StablePrice records: 53 distinct markets — 1X2_PARTICIPANT_RESULT
(full + half=1), OVERUNDER_PARTICIPANT_GOALS (lines 0.5..4+, full + half=1),
ASIANHANDICAP_PARTICIPANT_GOALS (many lines). PriceNames: [part1,draw,part2] /
[over,under]. Bookmaker="TXLineStablePriceDemargined". `Prices` = decimal odds
x1000 (e.g. 1518 = 1.518); `Pct` = de-margined percentages, "NA" on AH quarter
lines. MarketParameters like "line=2.5"; MarketPeriod like "half=1".

### (e) CONFIRMED: World Cup competitionId = 72
38 fixtures returned incl. France vs Morocco, Argentina fixtures, etc.
Upcoming (as of 2026-07-11): 18213979 Norway vs England (Jul 11 21:00 UTC),
18222446 Argentina vs Switzerland, 18237038 France vs Spain.

### /api/scores/historical returns SSE-FORMATTED TEXT, not JSON
Body is "data: {...}\n\n" frames. The kit's fetchJson auto-detects and parses
this (parseJsonOrSseBody). Log in FEEDBACK.md.

## (b) period-prefix 0 meaning — PARTIAL
ScoreStat = { key, value, period } — period is a SEPARATE field on the stat, and
period prefixes (1000/2000/...) encode into the requested statKey. ETTotal (7000)
existing separately implies prefix-0 "Total" = regulation. CONFIRM against a
finished ET match once activated. Until then: settle 1X2 on prefix-0 keys and
document "90-minute result" convention.

## (c) clock data — MOSTLY RESOLVED (verify live)
The Scores schema includes `SoccerFixtureClock { running: bool, seconds: i32 }`
(field `clock`), and SoccerData events carry `Minutes: i32`. So a real clock likely
EXISTS — EdgeSentinel may not need phase-interpolation. Verify populated values on
live/historical data after activation.

## (d) market availability — PENDING ACTIVATION
Odds payload confirmed: { FixtureId, MessageId, Ts, Bookmaker, BookmakerId,
SuperOddsType, GameState, InRunning, MarketParameters, MarketPeriod,
PriceNames[], Prices[] (int32), Pct[] ("52.632" strings, 3dp, de-margined, or "NA") }.
Market discovery = group by (SuperOddsType, MarketPeriod, MarketParameters).
Prices int scaling unverified — use Pct for probabilities (it's authoritative and
de-margined). Enumerate actual World Cup markets after activation.

## (e) World Cup competitionId — PROBABLE: 72
subscription_free_tier.ts queries `/fixtures/snapshot?competitionId=72&startEpochDay=20624`
(epochDay 20624 ≈ 2026-06-16, World Cup window). Treat 72 as the World Cup id;
confirm from a snapshot after activation.

## Auth flow — RESOLVED + smoke-tested
- `POST {host}/auth/guest/start` → `{ "token": "<jwt>" }` (LIVE-VERIFIED on devnet,
  no body needed). JWT expires in 30 days; renew on 401 (same host), keep API token.
- Activation: ensure Token-2022 ATA for TxL mint exists → `subscribe(serviceLevelId: number,
  weeks: number)` accounts { user, pricingMatrix PDA ["pricing_matrix"], tokenMint,
  userTokenAccount, tokenTreasuryVault (ATA of treasury PDA), tokenTreasuryPda
  ["token_treasury_v2"], TOKEN_2022, ASSOCIATED_TOKEN, SystemProgram } → confirmed txSig
  → sign `${txSig}:${leagues.join(",")}:${jwt}` with nacl.sign.detached, base64 →
  `POST /api/token/activate` body `{ txSig, walletSignature, leagues }` header Bearer jwt
  → response `{ token }` (or raw token) = API token.
- Free tier: serviceLevel 1, weeks 4 (must be multiple of 4), leagues [].
- Pricing matrix on-chain account lists rows { rowId, pricePerWeekToken,
  samplingIntervalSec, leagueBundleId, marketBundleId }.

## Streams — RESOLVED from spec
- `/api/scores/stream`, `/api/odds/stream`; data messages: `id` = `timestamp:index`,
  `data` = one Scores/OddsPayload JSON. Heartbeats: `event: heartbeat`, data like {"Ts": ...}.
- `Last-Event-ID` header resumes a stream. Optional `?fixtureId=` filters server-side.
- Time-bucket endpoints: interval = 0-indexed 5-MINUTE slot within the hour (0-11).
- `/api/scores/historical/{fixtureId}`: full update sequence, valid when start time
  is between 2 weeks and 6 hours in the past.

## Extra endpoints not in the marketing docs
`/api/fixtures/updates/{epochDay}/{hourOfDay}`, `/api/fixtures/validation`,
`/api/fixtures/batch-validation`, `/api/odds/updates/{fixtureId}`, `/api/odds/validation`
(odds proofs → validate_odds instruction — odds receipts are possible, not just scores).

## Network constants
- devnet: api `https://txline-dev.txodds.com/api`, auth `.../auth/guest/start`,
  program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`,
  TxL mint `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`, free level 1 (0s delay).
- mainnet: api `https://txline.txodds.com/api`,
  program `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`,
  TxL mint `Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL`, free levels 1 (60s) / 12 (real-time).
- Wallet: `.keys/devnet-wallet.json` → 3B9AdYMQuUBRynyuMkCmcVn7yfkqWZutWgPjb5oTWiyV
  (devnet airdrop pending/rate-limited).
