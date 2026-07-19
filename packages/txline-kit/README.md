# txline-kit

TypeScript SDK + data toolkit for the [TxLINE](https://txline.txodds.com) sports
data API (TxODDS): auth/activation, typed REST, SSE streams with auto-reconnect,
Merkle-proof helpers for the `txoracle` Solana program, and a wire-compatible
replay server for demos, backtests, and judging.

Packages (pnpm workspace):

| package | what |
|---|---|
| `@txline-kit/client` | `createTxlineClient` — auth, REST, SSE, proof helpers (`./proofs`) |
| `@txline-kit/constants` | stat-key algebra, game phases, event enums, odds math, market discovery |
| `@txline-kit/replay` | `txline-replay fetch/serve` — historical corpus + wire-compatible replay |

**New to the TxLINE API?** Read the [**TxLINE API Field Guide**](docs/VERIFIED.md)
first — the sharp edges (PascalCase records, phase in `StatusId`, `/historical`
returning SSE not JSON, pre-match odds not existing, the `period == 100`
settlement rule), mapped from live data so you don't hit them the hard way.

## Quickstart

```ts
import { createTxlineClient, WORLD_CUP_COMPETITION_ID } from "@txline-kit/client";
import { STAT, isFinalised } from "@txline-kit/constants";
import { Keypair } from "@solana/web3.js";
import fs from "node:fs";

const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8"))),
);

// devnet = free World Cup data at 0s delay. First call runs the on-chain
// subscribe + activation flow (needs a little devnet SOL), then credentials are
// cached in ~/.txline-kit/.
const tx = createTxlineClient({ network: "devnet", wallet });
await tx.auth.ensureActivated();

const fixtures = await tx.fixturesSnapshot(WORLD_CUP_COMPETITION_ID);

for await (const msg of tx.scoresStream()) {
  const u = msg.data;
  if (isFinalised(u)) {
    const proof = await tx.statValidation({
      fixtureId: u.fixtureId,
      seq: u.seq, // from a real record — never 0
      statKeys: [STAT.T1_GOALS, STAT.T2_GOALS],
    });
    // feed `proof` to buildStatValidationInput() and validateStatV2 on-chain
  }
}
```

### Replay mode (demos, backtests, judges)

```bash
# pull a finished match (start time 6h–2wk in the past) into ../corpus
pnpm txline-replay fetch --fixture 18179550

# replay it 30x wire-compatibly
pnpm txline-replay serve --fixture 18179550 --speed 30
```

```ts
// identical consumer code — only the constructor changes:
const tx = createTxlineClient({ network: "replay", baseUrl: "http://localhost:8788/api" });
```

Playback control: `curl -X POST localhost:8788/control -d '{"action":"speed","value":60}'`.

### On-chain validation helpers

```ts
import {
  buildStatValidationInput, strategy, dailyScoresRootsPda,
  epochDayFromTs, txoracleProgramId, loadTxoracleIdl,
} from "@txline-kit/client/proofs";

const v2 = await tx.statValidation({ fixtureId, seq, statKeys: [1, 2] });
const payload = buildStatValidationInput(v2);
// 1X2 home win: (goals1 - goals2) > 0 — indexes are POSITIONS in statKeys
const homeWin = strategy.build({ discrete: [strategy.binary(0, 1, "subtract", "greaterThan", 0)] });

const pda = dailyScoresRootsPda(
  txoracleProgramId("devnet"),
  epochDayFromTs(payload.ts.toNumber()),
);
// program.methods.validateStatV2(payload, homeWin).accounts({ dailyScoresMerkleRoots: pda }).view()
// (add a ComputeBudget preInstruction of ~1.4M units)
```

## Env escape hatches
- `TXLINE_JWT` / `TXLINE_API_TOKEN` — skip activation with existing credentials.
- `CORPUS_DIR` — where replay fixtures live (default `../corpus`).

## Rules encoded by this kit
- Both `Authorization: Bearer <jwt>` and `X-Api-Token` on every request; 401 →
  JWT renewed transparently (same host); 403 → `TxlineNetworkMismatchError`, never retried.
- Devnet and mainnet credentials/programs/IDLs never mix (single `network` value).
- Silent SSE outside live match windows is normal; reconnects resume via `Last-Event-ID`.
- Odds probabilities come from `Pct` (de-margined); market availability is
  discovered per fixture (`discoverMarkets`), never assumed.
