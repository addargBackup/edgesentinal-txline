#!/usr/bin/env node
/** txline-replay — fetch historical fixtures into the corpus and replay them
 *  wire-compatibly. See package README for usage. */
import { defaultCorpusDir } from "./corpus.js";
import { fetchFixture } from "./fetch.js";
import { startReplayServer } from "./serve.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const command = process.argv[2];

async function main() {
  const fixtureId = Number(arg("fixture"));
  const corpusDir = arg("corpus") ?? defaultCorpusDir();

  if (command === "fetch") {
    if (!fixtureId) throw new Error("Usage: txline-replay fetch --fixture <id> [--network devnet] [--wallet <path>] [--corpus <dir>]");
    const network = (arg("network") ?? "devnet") as "devnet" | "mainnet";
    const counts = await fetchFixture({
      fixtureId,
      network,
      corpusDir,
      walletPath: arg("wallet") ?? process.env.ANCHOR_WALLET,
    });
    console.log(`fetched fixture ${fixtureId}: ${counts.scores} score frames, ${counts.odds} odds frames -> ${corpusDir}/${fixtureId}/`);
    return;
  }

  if (command === "serve") {
    if (!fixtureId) throw new Error("Usage: txline-replay serve --fixture <id> [--speed 30] [--port 8788] [--corpus <dir>]");
    const port = Number(arg("port") ?? 8788);
    const speed = Number(arg("speed") ?? 1);
    startReplayServer({ fixtureId, corpusDir, speed, port });
    console.log(`replaying fixture ${fixtureId} at ${speed}x on http://localhost:${port}/api`);
    console.log(`control: curl -X POST localhost:${port}/control -d '{"action":"speed","value":10}'`);
    return;
  }

  throw new Error(`Unknown command "${command ?? ""}". Commands: fetch, serve`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
