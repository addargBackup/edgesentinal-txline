/** `txline-replay fetch` — pull a finished fixture's full update history from the
 *  TxLINE historical endpoints into the corpus. Window: match start between
 *  ~2 weeks and ~6 hours in the past (fetch early, not on the last day!). */
import * as path from "node:path";
import { createTxlineClient, type NetworkName, type OddsPayload, type ScoreUpdate } from "@txline-kit/client";
import { epochDayFromTs } from "@txline-kit/client/proofs";
import { corpusDirFor, writeFrames, type CorpusFrame } from "./corpus.js";

export interface FetchOptions {
  fixtureId: number;
  network?: Exclude<NetworkName, "replay">;
  corpusDir: string;
  walletPath?: string;
}

export async function fetchFixture(opts: FetchOptions): Promise<{ scores: number; odds: number }> {
  const network = opts.network ?? "devnet";
  let wallet;
  if (opts.walletPath) {
    const { Keypair } = await import("@solana/web3.js");
    const fs = await import("node:fs");
    wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(opts.walletPath, "utf8"))));
  }
  const client = createTxlineClient({ network, wallet });
  await client.auth.ensureActivated();

  // Scores: single call returns the full ordered update sequence.
  const scores = await client.scoresHistorical(opts.fixtureId);
  const scoreFrames: CorpusFrame<ScoreUpdate>[] = scores.map((u) => ({ ts: u.Ts, data: u }));

  // Odds: walk the 5-minute bucket endpoints across the match window
  // (from 90 min before the first score update to 30 min after the last).
  let oddsFrames: CorpusFrame<OddsPayload>[] = [];
  if (scoreFrames.length > 0) {
    const startTs = scoreFrames[0].ts - 90 * 60_000;
    const endTs = scoreFrames[scoreFrames.length - 1].ts + 30 * 60_000;
    const seen = new Set<string>();
    for (let ts = startTs; ts <= endTs; ts += 5 * 60_000) {
      const epochDay = epochDayFromTs(ts);
      const msIntoDay = ts - epochDay * 86_400_000;
      const hourOfDay = Math.floor(msIntoDay / 3_600_000);
      const interval = Math.floor((msIntoDay % 3_600_000) / 300_000); // 0-11
      try {
        const batch = await client.oddsUpdatesBucket(epochDay, hourOfDay, interval, opts.fixtureId);
        for (const o of batch) {
          if (o.FixtureId !== opts.fixtureId) continue;
          const key = `${o.MessageId ?? `${o.Ts}:${o.SuperOddsType}:${o.MarketParameters ?? ""}`}`;
          if (seen.has(key)) continue;
          seen.add(key);
          oddsFrames.push({ ts: o.Ts, data: o });
        }
      } catch (err) {
        // Empty/expired buckets are fine; keep walking.
      }
    }
  }

  const dir = corpusDirFor(opts.fixtureId, opts.corpusDir);
  writeFrames(path.join(dir, "scores.jsonl"), scoreFrames);
  writeFrames(path.join(dir, "odds.jsonl"), oddsFrames);
  return { scores: scoreFrames.length, odds: oddsFrames.length };
}
