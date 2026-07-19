# @txline-kit/client

TypeScript client for the [TxLINE](https://txline.txodds.com) sports data
API: auth/activation, typed REST, self-healing SSE streams, and Merkle-proof
helpers for the `txoracle` Solana program. Part of
[txline-kit](https://github.com/addargBackup/txline-kit) — see the root
README for the full SDK and the specific bugs this package exists to prevent.

## Install
```bash
npm install @txline-kit/client
```

## Quickstart
```ts
import { createTxlineClient, WORLD_CUP_COMPETITION_ID } from "@txline-kit/client";
import { STAT, isFinalised } from "@txline-kit/constants";

const tx = createTxlineClient({ network: "devnet", wallet }); // free World Cup tier, 0s delay
await tx.auth.ensureActivated(); // guest JWT -> on-chain subscribe -> token activate, cached to disk

const fixtures = await tx.fixturesSnapshot(WORLD_CUP_COMPETITION_ID);

for await (const msg of tx.scoresStream()) {
  const u = msg.data;
  if (isFinalised(u)) {
    const proof = await tx.statValidation({
      fixtureId: u.FixtureId,
      seq: u.Seq, // from a real record — never 0
      statKeys: [STAT.T1_GOALS, STAT.T2_GOALS],
    });
    // feed `proof` to buildStatValidationInput() (see "./proofs") and
    // validateStatV2 on-chain
  }
}
```

## Replay mode (demos, backtests, judges)
```ts
const tx = createTxlineClient({ network: "replay", baseUrl: "http://localhost:8788/api" });
// identical API — see @txline-kit/replay for the server this points at
```

## What this fixes that raw `fetch`/`EventSource` won't
- Live records are PascalCase (`FixtureId`, `Seq`) — typed from real traffic, not just the OpenAPI examples.
- 401s renew transparently (single-flight); 403 throws a clear `TxlineNetworkMismatchError` instead of retrying forever.
- `/scores/historical/{id}` returns SSE-framed text on a 200 — auto-detected and parsed into a normal array.
- SSE reconnects with jittered backoff and `Last-Event-ID` resume; readers are cleaned up when you break out of a `for await` loop.
- Proof helpers (`toBytes32`, `toProofNodes`, PDA derivation, `validateStatV2` payload/strategy builders) match the *actual* `txoracle` IDL grammar.

## Author

Built by [addargBackup](https://github.com/addargBackup) · [@addarg7](https://x.com/addarg7)

MIT licensed.
