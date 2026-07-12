/** Follow-ups: (1) mid-match proof period (soundness guard), (2) markets on an
 *  upcoming fixture, (3) StatusId phase values through a match. */
import * as fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { createTxlineClient, WORLD_CUP_COMPETITION_ID } from "../packages/client/src/index.js";
import { discoverMarkets } from "../packages/constants/src/index.js";

const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET ?? "../.keys/devnet-wallet.json", "utf8"))),
);
const tx = createTxlineClient({ network: "devnet", wallet });
await tx.auth.ensureActivated();

const FIXTURE = 18209181; // France vs Morocco (finished 2-0)
const updates = await tx.scoresHistorical(FIXTURE);

// (3) StatusId distribution through the match
const statusCounts = new Map<number, number>();
for (const u of updates) statusCounts.set(u.StatusId as number, (statusCounts.get(u.StatusId as number) ?? 0) + 1);
console.log("StatusId distribution:", JSON.stringify([...statusCounts.entries()].sort((a, b) => a[0] - b[0])));

// (1) mid-match proof: pick an H2 update (StatusId=4) where score was still 1-0
const mid = updates.find((u) => (u.StatusId as number) === 4 && u.Stats?.["1"] === 1 && u.Seq > 0);
console.log("mid-match update:", mid ? `seq=${mid.Seq} StatusId=${mid.StatusId} Stats1=${mid.Stats?.["1"]}` : "none found");
if (mid) {
  const proof = (await tx.statValidation({ fixtureId: FIXTURE, seq: mid.Seq, statKeys: [1, 2] })) as
    import("../packages/client/src/types.js").ScoresStatValidationV2;
  console.log("MID-MATCH statsToProve:", JSON.stringify(proof.statsToProve));
  console.log("=> settle() guard: require stat.period === 100 (final) — mid-match period above should NOT be 100");
}

// (2) markets on an upcoming fixture
const today = Math.floor(Date.now() / 86_400_000);
const fixtures = await tx.fixturesSnapshot(WORLD_CUP_COMPETITION_ID, today);
const upcoming = fixtures.filter((f) => f.StartTime > Date.now()).sort((a, b) => a.StartTime - b.StartTime);
console.log(`\nupcoming fixtures: ${upcoming.length}`);
for (const f of upcoming.slice(0, 5)) {
  console.log(`  ${f.FixtureId} ${new Date(f.StartTime).toISOString()} ${f.Participant1} vs ${f.Participant2}`);
}
if (upcoming.length) {
  const f = upcoming[0];
  const odds = await tx.oddsSnapshot(f.FixtureId);
  console.log(`\nodds records for ${f.Participant1} vs ${f.Participant2}: ${odds.length}`);
  const markets = discoverMarkets(odds);
  for (const m of markets.slice(0, 20)) {
    console.log(`  ${m.superOddsType} period=${m.marketPeriod ?? "-"} params=${m.marketParameters ?? "-"} prices=[${m.priceNames.join(",")}]`);
  }
  if (odds[0]) console.log("sample odds record:", JSON.stringify(odds[0]).slice(0, 500));
}
