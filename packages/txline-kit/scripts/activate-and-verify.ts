/** Activate the devnet free tier + close VERIFIED.md items (c)(d)(e) with live data.
 *  Run: ANCHOR_WALLET=../.keys/devnet-wallet.json pnpm tsx scripts/activate-and-verify.ts */
import * as fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { createTxlineClient, WORLD_CUP_COMPETITION_ID } from "../packages/client/src/index.js";
import { discoverMarkets, isFinalised } from "../packages/constants/src/index.js";

const walletPath = process.env.ANCHOR_WALLET ?? "../.keys/devnet-wallet.json";
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
console.log("wallet:", wallet.publicKey.toBase58());

const tx = createTxlineClient({ network: "devnet", wallet });
await tx.auth.ensureActivated();
console.log("ACTIVATED ✅");

// (e) World Cup competitionId — look back over the last 13 days of fixtures.
const todayEpochDay = Math.floor(Date.now() / 86_400_000);
const fixtures = await tx.fixturesSnapshot(WORLD_CUP_COMPETITION_ID, todayEpochDay - 13);
console.log(`\n(e) competitionId=72 fixtures found: ${fixtures.length}`);
for (const f of fixtures.slice(0, 8)) {
  console.log(`  ${f.FixtureId} ${new Date(f.StartTime).toISOString()} ${f.Participant1} vs ${f.Participant2} [${f.Competition}]`);
}

// Pick a fixture inside the historical window (start 2wk..6h in the past).
const now = Date.now();
const finished = fixtures
  .filter((f) => f.StartTime < now - 6 * 3_600_000 && f.StartTime > now - 13.5 * 86_400_000)
  .sort((a, b) => b.StartTime - a.StartTime);
console.log(`\nfixtures in historical window: ${finished.length}`);
if (finished.length === 0) process.exit(0);

const pick = finished[0];
console.log(`inspecting: ${pick.FixtureId} ${pick.Participant1} vs ${pick.Participant2}`);

// (c) clock + finality semantics from historical updates.
const updates = await tx.scoresHistorical(pick.FixtureId);
console.log(`\n(c) historical updates: ${updates.length}`);
const withClock = updates.filter((u) => u.Clock && typeof u.Clock.seconds === "number");
console.log(`  updates with clock: ${withClock.length}`);
if (withClock.length) {
  const mid = withClock[Math.floor(withClock.length / 2)];
  console.log(`  sample clock:`, JSON.stringify(mid.Clock), "gameState:", mid.GameState);
}
const final = updates.filter((u) => isFinalised(u));
console.log(`  finalised records: ${final.length}`);
const last = final[final.length - 1] ?? updates[updates.length - 1];
console.log(`  last record: action=${last.Action} gameState=${last.GameState} seq=${last.Seq}`);
console.log(`  last record stats:`, JSON.stringify(last.Stats ?? {}).slice(0, 400));
console.log(`  last record keys:`, Object.keys(last).join(","));

// (d) odds market availability.
const odds = await tx.oddsSnapshot(pick.FixtureId);
console.log(`\n(d) odds snapshot records: ${odds.length}`);
const markets = discoverMarkets(odds);
for (const m of markets.slice(0, 15)) {
  console.log(`  ${m.superOddsType} period=${m.marketPeriod ?? "-"} params=${m.marketParameters ?? "-"} prices=[${m.priceNames.join(",")}]`);
}

// CRITICAL for ProofPlay soundness: what does statToProve look like, and how is
// finality encoded? Fetch proofs for total + H1 keys at the FINAL seq.
const proof = (await tx.statValidation({
  fixtureId: pick.FixtureId,
  seq: last.Seq,
  statKeys: [1, 2, 1001],
})) as import("../packages/client/src/types.js").ScoresStatValidationV2;
console.log(`\nstat-validation (seq=${last.Seq}, statKeys=1,2,1001):`);
console.log(`  statsToProve:`, JSON.stringify(proof.statsToProve));
console.log(`  summary:`, JSON.stringify({ ...proof.summary, eventStatsSubTreeRoot: "…" }));
console.log(`  proof sizes: subTree=${proof.subTreeProof.length} mainTree=${proof.mainTreeProof.length} statProofs=[${proof.statProofs.map((p) => p.length).join(",")}]`);
const approxBytes =
  33 * (proof.subTreeProof.length + proof.mainTreeProof.length + proof.statProofs.reduce((a, p) => a + p.length, 0)) +
  32 * (1 + proof.statsToProve.length) + 12 * proof.statsToProve.length + 40;
console.log(`  ~borsh payload bytes (excl. overhead): ${approxBytes}`);

// Try a mid-match seq too: can a non-final update be proven? (soundness question)
const midUpdate = updates.find((u) => u.GameState === "H2" && u.Seq > 0);
if (midUpdate) {
  try {
    const midProof = (await tx.statValidation({
      fixtureId: pick.FixtureId, seq: midUpdate.Seq, statKeys: [1],
    })) as import("../packages/client/src/types.js").ScoresStatValidationV2;
    console.log(`\nMID-MATCH proof (seq=${midUpdate.Seq}, gameState=H2) EXISTS:`, JSON.stringify(midProof.statsToProve));
    console.log("  -> settlement MUST guard against non-final proofs (check statToProve.period / value semantics)");
  } catch (e) {
    console.log(`\nMID-MATCH proof rejected: ${(e as Error).message.slice(0, 200)}`);
  }
}

console.log(`\nCORPUS CANDIDATE: fixture ${pick.FixtureId} (${pick.Participant1} vs ${pick.Participant2})`);
