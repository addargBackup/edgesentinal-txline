/** Determinism proof: same corpus in -> byte-identical decision log out.
 *  Runs the UNCHANGED pipeline (no test-only code path) over the committed
 *  corpus sample twice and compares canonical decision logs; also pins the
 *  first run against the committed golden file so any behavior change is a
 *  conscious, reviewed diff. */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/backtest.js";

const corpusDir = path.resolve(__dirname, "..", "..", "corpus-sample");
const goldenFile = path.resolve(__dirname, "golden", "decisions.jsonl");
const FIXTURE = 18209181; // France vs Morocco (real recorded match)

function decisionLog(db: import("../src/db.js").Db): string {
  const rows = db.prepare(
    "SELECT frame_ts, fixture_id, strategy, action, side, stake, gap, reason, hash FROM decisions ORDER BY id",
  ).all();
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

describe("golden determinism", () => {
  it("two runs produce byte-identical decision logs", () => {
    const a = decisionLog(runBacktest([FIXTURE], corpusDir).db);
    const b = decisionLog(runBacktest([FIXTURE], corpusDir).db);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toBe(b);
  });

  it("matches the committed golden file (update deliberately if behavior changes)", () => {
    const log = decisionLog(runBacktest([FIXTURE], corpusDir).db);
    if (!fs.existsSync(goldenFile)) {
      fs.mkdirSync(path.dirname(goldenFile), { recursive: true });
      fs.writeFileSync(goldenFile, log + "\n");
      console.warn("golden file created — commit it");
    }
    expect(log + "\n").toBe(fs.readFileSync(goldenFile, "utf8"));
  });
});
