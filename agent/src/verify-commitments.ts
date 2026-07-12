/** Auditor tool: prove the decision log was not rewritten after the fact.
 *  For every committed decision, (1) recompute sha256 over the canonical
 *  record and compare to the stored hash, (2) fetch the devnet Memo tx and
 *  confirm it contains exactly that hash, timestamped on-chain.
 *      pnpm verify-commitments
 */
import { createHash } from "node:crypto";
import { Connection } from "@solana/web3.js";
import { openDb } from "./db.js";

const db = openDb();
const conn = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");

const rows = db.prepare(`
  SELECT id, frame_ts, fixture_id, strategy, action, side, stake,
         model_home, model_draw, model_away, market_home, market_draw, market_away,
         gap, reason, hash, memo_sig
  FROM decisions ORDER BY id`).all() as Array<Record<string, unknown>>;

let recomputedOk = 0, chainOk = 0, committed = 0, mismatches = 0;

for (const r of rows) {
  // 1. Recompute the canonical hash exactly as pipeline.record() built it.
  const rec = {
    frameTs: r.frame_ts, fixtureId: r.fixture_id, strategy: r.strategy, action: r.action,
    side: r.side, stake: r.stake,
    model: r.model_home == null ? null : { home: r.model_home, draw: r.model_draw, away: r.model_away },
    market: r.market_home == null ? null : { home: r.market_home, draw: r.market_draw, away: r.market_away },
    gap: r.gap, reason: r.reason, hash: undefined,
  };
  const recomputed = createHash("sha256").update(JSON.stringify(rec)).digest("hex");
  const hashOk = recomputed === r.hash;
  if (hashOk) recomputedOk++;
  else {
    mismatches++;
    console.error(`✗ decision ${r.id}: LOG HASH MISMATCH (log edited after the fact?)`);
    continue;
  }

  // 2. If committed, confirm the Memo on devnet carries this exact hash.
  if (r.memo_sig) {
    committed++;
    const tx = await conn.getTransaction(String(r.memo_sig), { maxSupportedTransactionVersion: 0 });
    const logs = tx?.meta?.logMessages?.join("\n") ?? "";
    if (logs.includes(`edgesentinel:${r.hash}`)) {
      chainOk++;
      console.log(`✓ decision ${r.id} anchored on-chain (${String(r.memo_sig).slice(0, 16)}…, slot ${tx?.slot})`);
    } else {
      mismatches++;
      console.error(`✗ decision ${r.id}: memo tx does not carry the logged hash`);
    }
  }
}

console.log(`\n${rows.length} decisions · ${recomputedOk} hashes recomputed OK · ${committed} committed · ${chainOk} verified on-chain · ${mismatches} mismatches`);
process.exit(mismatches > 0 ? 1 : 0);
