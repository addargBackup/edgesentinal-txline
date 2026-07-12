/** End-to-end smoke: synthetic corpus -> replay server -> real TxlineClient.
 *  Run: pnpm tsx scripts/smoke-replay.ts */
import * as fs from "node:fs";
import * as path from "node:path";
import { createTxlineClient } from "../packages/client/src/index.js";
import { startReplayServer } from "../packages/replay/src/serve.js";

const FIXTURE = 999001;
const corpusDir = path.resolve("scripts/.smoke-corpus");
const dir = path.join(corpusDir, String(FIXTURE));
fs.mkdirSync(dir, { recursive: true });

const t0 = Date.now() - 60_000;
const scoreFrames = [
  { ts: t0, data: { FixtureId: FIXTURE, GameState: "H1", Action: "kickoff", Seq: 1, Ts: t0, Stats: { "1": 0, "2": 0 } } },
  { ts: t0 + 10_000, data: { FixtureId: FIXTURE, GameState: "H1", Action: "goal", Seq: 2, Ts: t0 + 10_000, Stats: { "1": 1, "2": 0 } } },
  { ts: t0 + 20_000, data: { FixtureId: FIXTURE, GameState: "F", Action: "game_finalised", Seq: 3, Ts: t0 + 20_000, Stats: { "1": 1, "2": 0 } } },
];
const oddsFrames = [
  { ts: t0 + 5_000, data: { FixtureId: FIXTURE, MessageId: "m1", Ts: t0 + 5_000, Bookmaker: "StablePrice", BookmakerId: 1, SuperOddsType: "1X2", InRunning: true, PriceNames: ["1", "X", "2"], Pct: ["50.000", "30.000", "20.000"] } },
];
fs.writeFileSync(path.join(dir, "scores.jsonl"), scoreFrames.map((f) => JSON.stringify(f)).join("\n") + "\n");
fs.writeFileSync(path.join(dir, "odds.jsonl"), oddsFrames.map((f) => JSON.stringify(f)).join("\n") + "\n");

const server = startReplayServer({ fixtureId: FIXTURE, corpusDir, speed: 1000, port: 8891 });

const tx = createTxlineClient({ network: "replay", baseUrl: "http://localhost:8891/api" });
const control = (action: string, value?: number) =>
  fetch("http://localhost:8891/control", { method: "POST", body: JSON.stringify({ action, value }) });

// Deterministic start: pause, rewind to before kickoff, connect, then resume.
await control("pause");
await control("seek", t0 - 1000);

const received: string[] = [];
const ac = new AbortController();
const timeout = setTimeout(() => ac.abort(), 8000);

const collector = (async () => {
  for await (const msg of tx.scoresStream({ signal: ac.signal })) {
    received.push(msg.data.Action);
    if (msg.data.Action === "game_finalised") break;
  }
})();

await new Promise((r) => setTimeout(r, 500)); // let the SSE connection establish
await control("resume");
await collector;
clearTimeout(timeout);
ac.abort(); // release the SSE connection so the server can close

const snapshot = await tx.scoresSnapshot(FIXTURE);
const odds = await tx.oddsSnapshot(FIXTURE);

console.log("stream actions:", received);
console.log("snapshot seq:", snapshot.Seq, "gameState:", snapshot.GameState);
console.log("odds markets:", odds.map((o) => o.SuperOddsType));

const ok =
  received.join(",") === "kickoff,goal,game_finalised" &&
  snapshot.Seq === 3 &&
  odds.length === 1 &&
  odds[0].SuperOddsType === "1X2";

server.close();
fs.rmSync(corpusDir, { recursive: true, force: true });

if (!ok) {
  console.error("SMOKE FAILED");
  process.exit(1);
}
console.log("SMOKE PASSED: client <-> replay server are wire-compatible");
