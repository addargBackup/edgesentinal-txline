/** Read-only ops surface on one port: /healthz, /metrics, JSON API, and the
 *  static dashboard (public/index.html — inline SVG, zero build step). */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { TxlineClient } from "@txline-kit/client";
import type { Db } from "./db.js";
import type { Config } from "./config.js";
import type { Pipeline } from "./pipeline.js";

export function startServer(db: Db, pipeline: Pipeline, tx: TxlineClient, cfg: Config, port = Number(process.env.PORT ?? 8795)) {
  const app = Fastify({ logger: false });
  const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
  void app.register(fastifyStatic, { root: pub });

  app.get("/healthz", async () => ({
    ok: true,
    killSwitch: process.env.KILL_SWITCH === "1",
    stream: tx.health(),
    fixturesTracked: pipeline.fixtures.size,
  }));

  app.get("/metrics", async (_req, reply) => {
    const h = tx.health();
    const n = (q: string) => (db.prepare(q).get() as { n: number }).n;
    reply.type("text/plain");
    return [
      `edgesentinel_frames_total ${n("SELECT COUNT(*) AS n FROM frames")}`,
      `edgesentinel_decisions_total ${n("SELECT COUNT(*) AS n FROM decisions")}`,
      `edgesentinel_positions_open ${n("SELECT COUNT(*) AS n FROM positions WHERE closed_ts IS NULL")}`,
      `edgesentinel_shocks_total ${n("SELECT COUNT(*) AS n FROM shocks")}`,
      `edgesentinel_scores_last_event_ms ${h.scoresLastEventAt ?? 0}`,
      `edgesentinel_odds_last_event_ms ${h.oddsLastEventAt ?? 0}`,
      `edgesentinel_stream_reconnects ${h.reconnects}`,
    ].join("\n") + "\n";
  });

  app.get("/api/summary", async () => {
    const league = db.prepare(`
      SELECT strategy, COUNT(*) AS positions,
             SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
             ROUND(SUM(pnl), 2) AS pnl
      FROM positions WHERE closed_ts IS NOT NULL GROUP BY strategy ORDER BY pnl DESC`).all();
    const fixtures = db.prepare(
      "SELECT DISTINCT fixture_id AS fixtureId FROM series ORDER BY fixture_id",
    ).all();
    const shocks = db.prepare(
      "SELECT fixture_id AS fixtureId, kind, minute, ROUND(gap0,3) AS gap0, half_life_ms AS halfLifeMs, converged_ms AS convergedMs FROM shocks ORDER BY frame_ts DESC LIMIT 50",
    ).all();
    const ledger = db.prepare(`
      SELECT strategy, fixture_id AS fixtureId, side, ROUND(entry_prob,3) AS entry,
             ROUND(exit_prob,3) AS exit, ROUND(stake,1) AS stake, ROUND(pnl,2) AS pnl,
             settled, verified FROM positions ORDER BY id DESC LIMIT 100`).all();
    return { league, fixtures, shocks, ledger, config: { kellyK: cfg.kellyK, sniper: cfg.sniper } };
  });

  app.get<{ Params: { id: string } }>("/api/series/:id", async (req) => {
    const rows = db.prepare(
      "SELECT minute, model_home AS model, market_home AS market FROM series WHERE fixture_id = ? ORDER BY frame_ts",
    ).all(Number(req.params.id));
    const shocks = db.prepare(
      "SELECT minute, kind FROM shocks WHERE fixture_id = ? ORDER BY frame_ts",
    ).all(Number(req.params.id));
    return { series: rows, shocks };
  });

  void app.listen({ port, host: "0.0.0.0" });
  console.log(JSON.stringify({ msg: `dashboard on :${port}` }));
  return app;
}
