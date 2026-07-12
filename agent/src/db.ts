/** SQLite event store + ledger. The raw-frames table is the source of truth:
 *  every downstream state is a pure fold over it (event sourcing). */
import Database from "better-sqlite3";
import * as path from "node:path";

export function openDb(file = process.env.DB_FILE ?? path.resolve(process.cwd(), "edgesentinel.db")): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
CREATE TABLE IF NOT EXISTS frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,             -- scores | odds
  fixture_id INTEGER NOT NULL,
  frame_ts INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_frames_fix ON frames(fixture_id, frame_ts);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  frame_ts INTEGER NOT NULL,
  fixture_id INTEGER NOT NULL,
  strategy TEXT NOT NULL,
  action TEXT NOT NULL,             -- open | close | settle
  side TEXT,
  stake REAL,
  model_home REAL, model_draw REAL, model_away REAL,
  market_home REAL, market_draw REAL, market_away REAL,
  gap REAL,
  reason TEXT,
  hash TEXT NOT NULL,               -- sha256 of the canonical decision record
  memo_sig TEXT                     -- devnet Memo tx signature (when committed)
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  fixture_id INTEGER NOT NULL,
  side TEXT NOT NULL,               -- home | draw | away
  entry_prob REAL NOT NULL,
  stake REAL NOT NULL,
  opened_ts INTEGER NOT NULL,
  closed_ts INTEGER,
  exit_prob REAL,
  pnl REAL,
  settled INTEGER DEFAULT 0,
  verified INTEGER DEFAULT 0,       -- outcome checked against a TxLINE Merkle proof
  event_stat_root TEXT
);

CREATE TABLE IF NOT EXISTS series (
  fixture_id INTEGER NOT NULL,
  frame_ts INTEGER NOT NULL,
  minute REAL NOT NULL,
  model_home REAL,
  market_home REAL,
  PRIMARY KEY (fixture_id, frame_ts)
);

CREATE TABLE IF NOT EXISTS shocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  frame_ts INTEGER NOT NULL,
  minute REAL NOT NULL,
  market_before REAL,               -- market home-prob just before the shock
  model_after REAL,                 -- model home-prob immediately after
  gap0 REAL,
  half_life_ms INTEGER,
  converged_ms INTEGER,
  samples TEXT DEFAULT '[]'         -- [[dtMs, gap], ...] for plots
);
`);
  return db;
}
export type Db = Database.Database;
