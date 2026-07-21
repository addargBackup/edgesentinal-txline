/** DEPLOYED DEMO MODE: loops a real recorded World Cup match through the
 *  unchanged live pipeline so the public dashboard is always populated,
 *  regardless of tournament schedule or when a judge visits.
 *    pnpm demo-loop   -> replay server + agent + dashboard, looping forever
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { startReplayServer } from "@txline-kit/replay";

const corpusDir = process.env.CORPUS_DIR ?? path.resolve(process.cwd(), "corpus-sample");
const FIXTURE = Number(process.env.DEMO_FIXTURE ?? fs.readdirSync(corpusDir).find((d) => /^\d+$/.test(d)));
const REPLAY_PORT = Number(process.env.REPLAY_PORT ?? 8798);
const SPEED = Number(process.env.DEMO_SPEED ?? 30);
const GRACE_MS = 45_000; // let a judge who lands right at full time see the final state

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }));

const control = async (action: string, value?: number) => {
  const res = await fetch(`http://localhost:${REPLAY_PORT}/control`, {
    method: "POST",
    body: JSON.stringify({ action, value }),
  });
  return res.json() as Promise<{ position: number; speed: number; paused: boolean; start: number; end: number }>;
};

// 1. Wire-compatible replay of the recorded match.
startReplayServer({ fixtureId: FIXTURE, corpusDir, speed: SPEED, port: REPLAY_PORT });

// Find the real kickoff frame (StatusId 2) so each loop skips straight past
// the days of pre-match coverage frames real corpora carry.
const frames = fs.readFileSync(path.join(corpusDir, String(FIXTURE), "scores.jsonl"), "utf8").split("\n").filter(Boolean);
let kickoffTs = JSON.parse(frames[0]).ts;
for (const l of frames) {
  const f = JSON.parse(l);
  if (f.data.StatusId === 2) { kickoffTs = f.ts; break; }
}

// 2. Point the agent at this local replay server, then boot it exactly like
//    live mode — same pipeline, same strategies, same dashboard.
process.env.REPLAY_BASE_URL = `http://localhost:${REPLAY_PORT}/api`;
const { main } = await import("./index.js");

await new Promise((r) => setTimeout(r, 500));
await control("seek", kickoffTs);
await control("resume");
log("demo loop: started", { fixtureId: FIXTURE, speed: SPEED });

await main();

// 3. Supervisor: when the replay reaches full time, wait GRACE_MS so a judge
//    mid-visit sees the settled result, then seek back to kickoff and go
//    again — forever. Same corpus, same pipeline, same decisions every lap;
//    that determinism is a feature, not a bug (see the golden-file test).
void (async function loop() {
  for (;;) {
    await new Promise((r) => setTimeout(r, 5_000));
    try {
      const status = await control("speed", SPEED); // cheap way to also read status
      if (status.position >= status.end) {
        log("demo loop: match complete, pausing before restart", { graceMs: GRACE_MS });
        await new Promise((r) => setTimeout(r, GRACE_MS));
        await control("seek", kickoffTs);
        await control("resume");
        log("demo loop: restarted");
      }
    } catch (err) {
      log("demo loop: supervisor error", { err: String(err).slice(0, 200) });
    }
  }
})();
