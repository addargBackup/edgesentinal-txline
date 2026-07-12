/** Verified settlement: the ledger only marks a fixture's outcome as trusted
 *  after checking TxLINE's Merkle proof against the on-chain daily root via
 *  txoracle validateStatV2 (read-only .view() simulation — the
 *  fixture_validation_view_only pattern from TxODDS's own examples). */
import * as fs from "node:fs";
import * as path from "node:path";
import { Keypair } from "@solana/web3.js";
import type { TxlineClient, ScoresStatValidationV2 } from "@txline-kit/client";
import {
  buildStatValidationInput, dailyScoresRootsPda, epochDayFromTs,
  loadTxoracleIdl, strategy as oracleStrategy, txoracleProgramId,
} from "@txline-kit/client/proofs";
import type { Db } from "./db.js";

export async function verifySettlement(
  db: Db,
  api: TxlineClient,
  fixtureId: number,
  finalSeq: number,
  finalScore: { home: number; away: number },
): Promise<void> {
  try {
    const proof = (await api.statValidation({ fixtureId, seq: finalSeq, statKeys: [1, 2] })) as ScoresStatValidationV2;
    const payload = buildStatValidationInput(proof);
    // Prove the actual result: (goals1 - goals2) {>,=,<} 0.
    const cmp = finalScore.home > finalScore.away ? "greaterThan" : finalScore.home === finalScore.away ? "equalTo" : "lessThan";
    const strat = oracleStrategy.build({ discrete: [oracleStrategy.binary(0, 1, "subtract", cmp, 0)] });

    const anchor = await import("@coral-xyz/anchor");
    const web3 = await import("@solana/web3.js");
    const wallet = loadWallet();
    const provider = new anchor.AnchorProvider(
      new web3.Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed"),
      new anchor.Wallet(wallet),
      { commitment: "confirmed" },
    );
    const program = new anchor.Program(loadTxoracleIdl("devnet"), provider);
    const roots = dailyScoresRootsPda(txoracleProgramId("devnet"), epochDayFromTs(proof.summary.updateStats.minTimestamp));
    const budget = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const ok: boolean = await (program.methods as never as {
      validateStatV2: (p: unknown, s: unknown) => {
        accounts: (a: unknown) => { preInstructions: (ix: unknown[]) => { view: () => Promise<boolean> } };
      };
    })
      .validateStatV2(payload, strat)
      .accounts({ dailyScoresMerkleRoots: roots })
      .preInstructions([budget])
      .view();

    if (ok) {
      const root = Buffer.from(
        typeof proof.eventStatRoot === "string" ? Buffer.from(proof.eventStatRoot, "base64") : Uint8Array.from(proof.eventStatRoot),
      ).toString("hex");
      db.prepare("UPDATE positions SET verified = 1, event_stat_root = ? WHERE fixture_id = ? AND settled = 1")
        .run(root, fixtureId);
      console.log(JSON.stringify({ msg: "settlement VERIFIED against TxLINE Merkle proof", fixtureId, eventStatRoot: root.slice(0, 16) + "…" }));
    } else {
      console.error(JSON.stringify({ msg: "settlement verification REJECTED — ledger left unverified", fixtureId }));
    }
  } catch (err) {
    console.error(JSON.stringify({ msg: "settlement verification failed", fixtureId, err: String(err).slice(0, 200) }));
  }
}

function loadWallet(): Keypair {
  const p = process.env.ANCHOR_WALLET ?? path.resolve(process.cwd(), "..", ".keys", "devnet-wallet.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}
