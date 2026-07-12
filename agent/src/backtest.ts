/** Backtest = the UNCHANGED pipeline fed from corpus files instead of SSE.
 *  Emits per-strategy results + the convergence study, and writes
 *  docs/RESULTS.md + docs/CONVERGENCE.md with whatever the data says.
 *
 *    pnpm backtest [--fixture <id>] [--corpus <dir>] [--db <file>]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { openDb, type Db } from "./db.js";
import { loadConfig } from "./config.js";
import { Pipeline } from "./pipeline.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

interface Frame { ts: number; data: Record<string, unknown> }

function readCorpus(corpusDir: string, fixtureId: number): { scores: Frame[]; odds: Frame[] } {
  const dir = path.join(corpusDir, String(fixtureId));
  const read = (f: string): Frame[] =>
    fs.existsSync(path.join(dir, f))
      ? fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
  return { scores: read("scores.jsonl"), odds: read("odds.jsonl") };
}

export interface StrategyReport {
  strategy: string;
  positions: number;
  wins: number;
  hitRate: number | null;
  pnl: number;
  maxDrawdown: number;
}

export function runBacktest(fixtureIds: number[], corpusDir: string, dbFile = ":memory:"): {
  db: Db;
  reports: StrategyReport[];
  decisions: number;
} {
  const db = openDb(dbFile);
  const cfg = loadConfig();
  // persistFrames=true: corpus frames land in this run's (usually in-memory)
  // event store, so calibration queries and the dashboard replay work on it.
  const pipeline = new Pipeline(db, cfg, {
    log: (msg, extra) => console.log(JSON.stringify({ msg, ...extra })),
  }, true);

  for (const fixtureId of fixtureIds) {
    const { scores, odds } = readCorpus(corpusDir, fixtureId);
    if (scores.length === 0) {
      console.error(`no corpus for fixture ${fixtureId} in ${corpusDir}`);
      continue;
    }
    // Merge-sort by frame timestamp: exactly the arrival order live saw.
    const merged = [
      ...scores.map((f) => ({ ...f, source: "scores" as const })),
      ...odds.map((f) => ({ ...f, source: "odds" as const })),
    ].sort((a, b) => a.ts - b.ts);
    for (const f of merged) {
      if (f.source === "scores") pipeline.processScoreFrame(f.data as never);
      else pipeline.processOddsFrame(f.data as never);
    }
  }

  const reports: StrategyReport[] = pipeline.strategies.map((s) => {
    const rows = db.prepare(
      "SELECT pnl, closed_ts FROM positions WHERE strategy = ? AND closed_ts IS NOT NULL ORDER BY closed_ts",
    ).all(s.key) as Array<{ pnl: number }>;
    let cum = 0, peak = 0, maxDd = 0, wins = 0;
    for (const r of rows) {
      cum += r.pnl;
      peak = Math.max(peak, cum);
      maxDd = Math.max(maxDd, peak - cum);
      if (r.pnl > 0) wins++;
    }
    return {
      strategy: s.key, positions: rows.length, wins,
      hitRate: rows.length ? wins / rows.length : null,
      pnl: Number(cum.toFixed(2)), maxDrawdown: Number(maxDd.toFixed(2)),
    };
  });

  const decisions = (db.prepare("SELECT COUNT(*) AS n FROM decisions").get() as { n: number }).n;
  return { db, reports, decisions };
}

function writeReports(db: Db, reports: StrategyReport[], fixtureIds: number[], docsDir: string) {
  // ---- RESULTS.md -----------------------------------------------------------
  const lines = [
    "# Backtest results (generated — honest numbers, whatever they are)",
    "",
    `Fixtures: ${fixtureIds.join(", ")} · generated ${new Date().toISOString()}`,
    "",
    "| strategy | positions | hit rate | P&L (units) | max drawdown |",
    "|---|---|---|---|---|",
    ...reports.map((r) =>
      `| ${r.strategy} | ${r.positions} | ${r.hitRate === null ? "—" : (r.hitRate * 100).toFixed(0) + "%"} | ${r.pnl} | ${r.maxDrawdown} |`),
    "",
    "Interpretation guide: `baseline` is the control arm (kickoff favorite,",
    "held). `divergence` tests the model against a de-margined consensus in",
    "calm play — we EXPECT ~zero edge there and say so. `sniper` trades only",
    "the post-shock repricing window measured in CONVERGENCE.md.",
    "",
    "## Model calibration (model vs market, sampled each minute)",
    "",
    calibrationTable(db),
  ];
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "RESULTS.md"), lines.join("\n") + "\n");

  // ---- CONVERGENCE.md ---------------------------------------------------------
  const shocks = db.prepare(
    "SELECT kind, minute, gap0, half_life_ms, converged_ms FROM shocks WHERE ABS(gap0) > 0.01 ORDER BY frame_ts",
  ).all() as Array<{ kind: string; minute: number; gap0: number; half_life_ms: number | null; converged_ms: number | null }>;
  const med = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const halfLives = shocks.filter((s) => s.half_life_ms !== null).map((s) => s.half_life_ms! / 1000);
  const converges = shocks.filter((s) => s.converged_ms !== null).map((s) => s.converged_ms! / 1000);
  const conv = [
    "# StablePrice shock-convergence study (generated)",
    "",
    "How fast does TxLINE's de-margined consensus absorb a state shock? For",
    "every goal/red card we log the instant model-vs-market gap and track it",
    "until it converges (|gap| < ε = 0.02) or the horizon passes.",
    "",
    `Shocks observed (|gap₀| > 0.01): **${shocks.length}**`,
    `Median half-life: **${med(halfLives)?.toFixed(0) ?? "—"}s** · median time-to-convergence: **${med(converges)?.toFixed(0) ?? "—"}s** (n=${converges.length})`,
    "",
    "| shock | minute | gap₀ | half-life (s) | converged (s) |",
    "|---|---|---|---|---|",
    ...shocks.map((s) =>
      `| ${s.kind} | ${s.minute.toFixed(0)}' | ${s.gap0.toFixed(3)} | ${s.half_life_ms !== null ? (s.half_life_ms / 1000).toFixed(0) : "—"} | ${s.converged_ms !== null ? (s.converged_ms / 1000).toFixed(0) : ">horizon"} |`),
    "",
    "The tradeable window for the sniper strategy is exactly this table.",
  ];
  fs.writeFileSync(path.join(docsDir, "CONVERGENCE.md"), conv.join("\n") + "\n");
}

function calibrationTable(db: Db): string {
  // Bucket sampled model/market home-probs; realized = did home win that fixture.
  const rows = db.prepare(`
    SELECT s.fixture_id, s.model_home, s.market_home,
      (SELECT CASE WHEN json_extract(f.payload,'$.Stats."1"') > json_extract(f.payload,'$.Stats."2"') THEN 1 ELSE 0 END
       FROM frames f WHERE f.fixture_id = s.fixture_id AND f.source='scores'
         AND json_extract(f.payload,'$.Action')='game_finalised' LIMIT 1) AS home_won
    FROM series s WHERE s.model_home IS NOT NULL`).all() as
    Array<{ model_home: number; market_home: number; home_won: number | null }>;
  const usable = rows.filter((r) => r.home_won !== null);
  if (usable.length === 0) return "_no samples (run against a corpus with a finalised match)_";
  const buckets = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const out = ["| bucket | n | model avg | market avg | realized home-win |", "|---|---|---|---|---|"];
  for (let b = 0; b < buckets.length - 1; b++) {
    const inB = usable.filter((r) => r.model_home >= buckets[b] && r.model_home < buckets[b + 1]);
    if (inB.length === 0) continue;
    const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    out.push(`| ${buckets[b].toFixed(1)}–${buckets[b + 1] > 1 ? "1.0" : buckets[b + 1].toFixed(1)} | ${inB.length} | ${avg(inB.map((r) => r.model_home)).toFixed(3)} | ${avg(inB.map((r) => r.market_home)).toFixed(3)} | ${avg(inB.map((r) => r.home_won!)).toFixed(3)} |`);
  }
  out.push("", "_Realized column is per-sample (fixture outcome repeated across its samples); with few fixtures it validates direction, not magnitude — more corpus fixtures sharpen it._");
  return out.join("\n");
}

// ---- CLI ---------------------------------------------------------------------
const isMain = process.argv[1]?.endsWith("backtest.ts") || process.argv[1]?.endsWith("backtest.js");
if (isMain) {
  const corpusDir = arg("corpus") ?? (fs.existsSync(path.resolve("..", "corpus")) ? path.resolve("..", "corpus") : path.resolve("corpus-sample"));
  const fixtureIds = arg("fixture")
    ? [Number(arg("fixture"))]
    : fs.readdirSync(corpusDir).filter((d) => /^\d+$/.test(d)).map(Number);
  console.log(`backtest: fixtures [${fixtureIds.join(", ")}] from ${corpusDir}`);
  const { db, reports, decisions } = runBacktest(fixtureIds, corpusDir, arg("db") ?? ":memory:");
  console.table(reports);
  console.log(`decisions: ${decisions}`);
  writeReports(db, reports, fixtureIds, path.resolve("docs"));
  console.log("wrote docs/RESULTS.md + docs/CONVERGENCE.md");
}
