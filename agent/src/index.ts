/** EdgeSentinel live agent. Fully autonomous once started:
 *    pnpm agent                       # devnet live streams
 *    REPLAY_BASE_URL=... pnpm agent   # judge mode against a replay server
 *  KILL_SWITCH=1 halts trading (ingest + measurement continue). */
import * as fs from "node:fs";
import * as path from "node:path";
import { Keypair } from "@solana/web3.js";
import { createTxlineClient, type TxlineClient } from "@txline-kit/client";
import { openDb } from "./db.js";
import { loadConfig } from "./config.js";
import { Pipeline } from "./pipeline.js";
import { Committer } from "./commit.js";
import { verifySettlement } from "./settle.js";
import { startServer } from "./server.js";

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }));

const db = openDb();
const cfg = loadConfig();

const replayBase = process.env.REPLAY_BASE_URL;
const wallet = loadWalletMaybe();
const tx: TxlineClient = replayBase
  ? createTxlineClient({ network: "replay", baseUrl: replayBase })
  : createTxlineClient({ network: "devnet", wallet });
/** proofs/fixtures ALWAYS from the real API (replay servers replay streams). */
const api: TxlineClient = replayBase ? createTxlineClient({ network: "devnet", wallet }) : tx;

const committer = cfg.commitDecisions ? new Committer(db) : null;

const pipeline = new Pipeline(db, cfg, {
  log,
  onDecision: (d) => {
    if (process.env.KILL_SWITCH === "1") return; // decisions still logged; commits halt
    const row = db.prepare("SELECT id FROM decisions WHERE hash = ? ORDER BY id DESC LIMIT 1").get(d.hash) as { id: number } | undefined;
    if (committer && row) committer.enqueue(row.id, d.hash);
  },
  onFinalised: (fixtureId, finalSeq, state) => {
    void verifySettlement(db, api, fixtureId, finalSeq, { home: state.scoreHome, away: state.scoreAway });
  },
});

// Supervised stream loops: crash -> log -> resume. Kit handles reconnects;
// this guards against anything above the transport.
async function supervise(name: string, loop: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await loop();
    } catch (err) {
      log(`${name} loop crashed; restarting in 5s`, { err: String(err).slice(0, 200) });
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function main() {
  await api.auth.ensureActivated();
  log(`EdgeSentinel up (${replayBase ? "REPLAY " + replayBase : "devnet live"})`, {
    killSwitch: process.env.KILL_SWITCH === "1", commit: cfg.commitDecisions,
  });
  startServer(db, pipeline, tx, cfg);
  void supervise("scores", async () => {
    for await (const msg of tx.scoresStream()) pipeline.processScoreFrame(msg.data);
  });
  void supervise("odds", async () => {
    for await (const msg of tx.oddsStream()) pipeline.processOddsFrame(msg.data);
  });
}

function loadWalletMaybe(): Keypair | undefined {
  try {
    const p = process.env.ANCHOR_WALLET ?? path.resolve(process.cwd(), "..", ".keys", "devnet-wallet.json");
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  } catch {
    return undefined;
  }
}

void main();
