/** Tamper-evident track record: sha256 of every decision -> devnet Memo tx at
 *  decision time. The agent provably cannot retroactively edit its calls.
 *  Fire-and-forget queue (concurrency 1) so trading never blocks on the chain. */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Db } from "./db.js";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export class Committer {
  private queue: Array<{ decisionId: number; hash: string }> = [];
  private running = false;
  private conn: Connection;
  private wallet: Keypair | null;

  constructor(private db: Db, rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com") {
    this.conn = new Connection(rpcUrl, "confirmed");
    this.wallet = loadWalletMaybe();
    if (!this.wallet) console.error("[commit] no wallet — commitments disabled");
  }

  enqueue(decisionId: number, hash: string): void {
    if (!this.wallet) return;
    this.queue.push({ decisionId, hash });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running || !this.wallet) return;
    this.running = true;
    while (this.queue.length > 0) {
      const { decisionId, hash } = this.queue.shift()!;
      try {
        const tx = new Transaction().add(
          new TransactionInstruction({
            programId: MEMO_PROGRAM,
            keys: [],
            data: Buffer.from(`edgesentinel:${hash}`, "utf8"),
          }),
        );
        const sig = await sendAndConfirmTransaction(this.conn, tx, [this.wallet], { commitment: "confirmed" });
        this.db.prepare("UPDATE decisions SET memo_sig = ? WHERE id = ?").run(sig, decisionId);
        console.log(JSON.stringify({ msg: "decision committed on-chain", decisionId, sig }));
      } catch (err) {
        console.error("[commit] failed:", String(err).slice(0, 150));
      }
    }
    this.running = false;
  }
}

function loadWalletMaybe(): Keypair | null {
  try {
    const p = process.env.ANCHOR_WALLET ?? path.resolve(process.cwd(), "..", ".keys", "devnet-wallet.json");
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  } catch {
    return null;
  }
}
