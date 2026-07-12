/** The agent core: a deterministic fold over TxLINE frames.
 *  Live mode pumps frames from SSE; backtest pumps the same frames from the
 *  corpus — THIS FILE DOES NOT KNOW THE DIFFERENCE. All timing is frame time.
 */
import { createHash } from "node:crypto";
import type { OddsPayload, ScoreUpdate } from "@txline-kit/client";
import type { Db } from "./db.js";
import type { Config } from "./config.js";
import {
  calibrateLambdas, kellyFraction, outcomeProbs, type Probs,
} from "./engine/model.js";
import {
  estimateMinute, initialMarket, initialMatch, kickoffConsensus, minutesLeft,
  reduceMarket, reduceMatch, type MarketState, type MatchState, type Shock,
} from "./engine/state.js";
import {
  baselineFavorite, repricingSniper, steadyDivergence,
  type Intent, type OpenPositionView, type Side, type Strategy, type Tick,
} from "./strategies/index.js";

export interface PipelineEvents {
  onDecision?: (d: DecisionRecord) => void;
  onFinalised?: (fixtureId: number, finalSeq: number, state: MatchState) => void;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface DecisionRecord {
  frameTs: number;
  fixtureId: number;
  strategy: string;
  action: "open" | "close" | "settle";
  side: Side | null;
  stake: number | null;
  model: Probs | null;
  market: Probs | null;
  gap: number | null;
  reason: string;
  hash: string;
}

interface ShockTracker {
  rowId: number;
  shock: Shock;
  gap0: number;
  samples: Array<[number, number]>;
  halfLifeMs: number | null;
  convergedMs: number | null;
}

interface FixtureCtx {
  match: MatchState;
  market: MarketState;
  lambdas: { lambdaHome: number; lambdaAway: number } | null;
  recentShock: (Shock & { gapAtShock: number }) | null;
  trackers: ShockTracker[];
  halted: boolean;
  settled: boolean;
}

export class Pipeline {
  readonly strategies: Strategy[] = [baselineFavorite, steadyDivergence, repricingSniper];
  readonly fixtures = new Map<number, FixtureCtx>();

  constructor(
    readonly db: Db,
    readonly cfg: Config,
    readonly events: PipelineEvents = {},
    /** persist raw frames (live mode); backtests replaying from the frames
     *  table itself pass false to avoid re-inserting. */
    readonly persistFrames = true,
  ) {}

  private ctx(fixtureId: number): FixtureCtx {
    let c = this.fixtures.get(fixtureId);
    if (!c) {
      c = {
        match: initialMatch(fixtureId), market: initialMarket(fixtureId),
        lambdas: null, recentShock: null, trackers: [], halted: false, settled: false,
      };
      this.fixtures.set(fixtureId, c);
    }
    return c;
  }

  processScoreFrame(u: ScoreUpdate): void {
    if (!u?.FixtureId) return;
    if (this.persistFrames) {
      this.db.prepare("INSERT INTO frames (source, fixture_id, frame_ts, payload) VALUES ('scores', ?, ?, ?)")
        .run(u.FixtureId, u.Ts, JSON.stringify(u));
    }
    const c = this.ctx(u.FixtureId);
    const marketBefore = c.market.latest?.home ?? null;
    const { state, shocks } = reduceMatch(c.match, u);
    c.match = state;

    for (const shock of shocks) {
      const modelAfter = this.modelProbs(c, shock.frameTs)?.home ?? null;
      const gap0 = modelAfter !== null && marketBefore !== null ? modelAfter - marketBefore : 0;
      const row = this.db.prepare(
        `INSERT INTO shocks (fixture_id, kind, frame_ts, minute, market_before, model_after, gap0)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(u.FixtureId, shock.kind, shock.frameTs, shock.minute, marketBefore, modelAfter, gap0);
      c.trackers.push({ rowId: Number(row.lastInsertRowid), shock, gap0, samples: [], halfLifeMs: null, convergedMs: null });
      c.recentShock = { ...shock, gapAtShock: gap0 };
      this.events.log?.("shock", { fixtureId: u.FixtureId, ...shock, gap0: gap0.toFixed(4) });
    }

    this.tick(c, u.Ts);

    if (c.match.finalised && !c.settled) {
      c.settled = true;
      this.settleFixture(c);
      this.events.onFinalised?.(u.FixtureId, c.match.finalSeq!, c.match);
    }
  }

  processOddsFrame(o: OddsPayload): void {
    if (!o?.FixtureId) return;
    if (this.persistFrames) {
      this.db.prepare("INSERT INTO frames (source, fixture_id, frame_ts, payload) VALUES ('odds', ?, ?, ?)")
        .run(o.FixtureId, o.Ts, JSON.stringify(o));
    }
    const c = this.ctx(o.FixtureId);
    // λ calibration readings are only valid while the match state is still
    // ≈ initial: kicked off, first ~10 minutes, score 0-0. Anything later
    // (sparse corpora can start mid-match) would fit λ to an in-play price —
    // audit finding: that poisoned a whole fixture's model.
    const calibratable =
      c.match.kickoff &&
      c.match.scoreHome === 0 && c.match.scoreAway === 0 &&
      estimateMinute(c.match, o.Ts) <= 10;
    c.market = reduceMarket(c.market, o, calibratable);

    // Kickoff λ calibration from the first stable consensus (pre-match odds
    // do not exist on this tier — VERIFIED.md).
    if (!c.lambdas) {
      const consensus = kickoffConsensus(c.market);
      if (consensus) {
        const fit = calibrateLambdas(consensus, this.cfg.model);
        c.lambdas = fit;
        this.events.log?.("calibrated", {
          fixtureId: o.FixtureId, lambdaHome: fit.lambdaHome.toFixed(3),
          lambdaAway: fit.lambdaAway.toFixed(3), sse: fit.sse.toExponential(2),
        });
      }
    }

    this.trackConvergence(c, o.Ts);
    this.sampleSeries(c, o.Ts);
    this.tick(c, o.Ts);
  }

  /** Throttled model-vs-market series for the dashboard chart (frame time). */
  private lastSample = new Map<number, number>();
  private sampleSeries(c: FixtureCtx, frameTs: number): void {
    if (!c.match.kickoff || !c.market.latest) return;
    // Freshness gate (audit): pairing a live model with a stale quote
    // fabricates impossible rows in the calibration table.
    if (frameTs - c.market.latest.frameTs > this.cfg.stalenessHaltSec * 1000) return;
    const last = this.lastSample.get(c.match.fixtureId) ?? 0;
    if (frameTs - last < 15_000) return;
    this.lastSample.set(c.match.fixtureId, frameTs);
    const model = this.modelProbs(c, frameTs);
    this.db.prepare(
      "INSERT OR IGNORE INTO series (fixture_id, frame_ts, minute, model_home, market_home) VALUES (?,?,?,?,?)",
    ).run(c.match.fixtureId, frameTs, estimateMinute(c.match, frameTs), model?.home ?? null, c.market.latest.home);
  }

  // -------------------------------------------------------------------------
  private modelProbs(c: FixtureCtx, frameTs: number): Probs | null {
    if (!c.lambdas) return null;
    return outcomeProbs(c.lambdas.lambdaHome, c.lambdas.lambdaAway, {
      scoreHome: c.match.scoreHome, scoreAway: c.match.scoreAway,
      minutesLeft: minutesLeft(c.match, frameTs),
      redsHome: c.match.redsHome, redsAway: c.match.redsAway,
    }, this.cfg.model);
  }

  private trackConvergence(c: FixtureCtx, frameTs: number): void {
    if (c.trackers.length === 0 || !c.market.latest) return;
    // Same staleness rule as trading: never measure against an old quote.
    if (frameTs - c.market.latest.frameTs > this.cfg.stalenessHaltSec * 1000) return;
    const model = this.modelProbs(c, frameTs);
    if (!model) return;
    const horizon = this.cfg.convergence.horizonMinutes * 60_000;
    for (const t of c.trackers) {
      const dt = frameTs - t.shock.frameTs;
      if (dt < 0 || dt > horizon) continue;
      const gap = model.home - c.market.latest.home;
      t.samples.push([dt, Number(gap.toFixed(5))]);
      if (t.halfLifeMs === null && Math.abs(gap) <= Math.abs(t.gap0) / 2) t.halfLifeMs = dt;
      if (t.convergedMs === null && Math.abs(gap) <= this.cfg.convergence.epsilon) {
        t.convergedMs = dt;
        this.db.prepare("UPDATE shocks SET half_life_ms = ?, converged_ms = ?, samples = ? WHERE id = ?")
          .run(t.halfLifeMs, t.convergedMs, JSON.stringify(t.samples), t.rowId);
        this.events.log?.("shock converged", {
          fixtureId: c.match.fixtureId, kind: t.shock.kind,
          halfLifeS: t.halfLifeMs !== null ? (t.halfLifeMs / 1000).toFixed(0) : null,
          convergedS: (t.convergedMs / 1000).toFixed(0),
        });
      }
    }
    // flush expired trackers (unconverged within horizon)
    c.trackers = c.trackers.filter((t) => {
      const dt = frameTs - t.shock.frameTs;
      if (t.convergedMs !== null || dt > horizon) {
        if (t.convergedMs === null) {
          this.db.prepare("UPDATE shocks SET half_life_ms = ?, samples = ? WHERE id = ?")
            .run(t.halfLifeMs, JSON.stringify(t.samples), t.rowId);
        }
        return false;
      }
      return true;
    });
    // expire the tradeable shock window
    if (c.recentShock && frameTs - c.recentShock.frameTs > this.cfg.sniper.windowMinutes * 60_000 * 2) {
      c.recentShock = null;
    }
  }

  private tick(c: FixtureCtx, frameTs: number): void {
    if (c.halted || !c.match.kickoff) return;
    const model = this.modelProbs(c, frameTs);
    // STALENESS GUARD: never trade against a price that hasn't ticked recently
    // (frame time) — stale quotes produce fictitious gaps. Found the hard way:
    // a sparse odds corpus produced a 0.96 "gap" the agent gleefully traded.
    const staleMs = this.cfg.stalenessHaltSec * 1000;
    const market = c.market.latest && frameTs - c.market.latest.frameTs <= staleMs ? c.market.latest : null;
    const tickView: Tick = {
      fixtureId: c.match.fixtureId, frameTs,
      minute: estimateMinute(c.match, frameTs),
      minutesLeft: minutesLeft(c.match, frameTs),
      calibrated: c.lambdas !== null,
      model, market: market ? { home: market.home, draw: market.draw, away: market.away } : null,
      gapHome: model && market ? model.home - market.home : null,
      shocks: [], recentShock: c.recentShock, finalised: c.match.finalised,
    };
    for (const strat of this.strategies) {
      const open = this.openPositions(strat.key, c.match.fixtureId);
      for (const intent of strat.onTick(tickView, open, this.cfg)) {
        this.execute(strat.key, tickView, intent, open);
      }
    }
  }

  private openPositions(strategy: string, fixtureId: number): OpenPositionView[] {
    return (this.db.prepare(
      "SELECT id, side, entry_prob AS entryProb, stake, opened_ts AS openedTs FROM positions WHERE strategy = ? AND fixture_id = ? AND closed_ts IS NULL",
    ).all(strategy, fixtureId) as OpenPositionView[]);
  }

  private execute(strategy: string, t: Tick, intent: Intent, open: OpenPositionView[]): void {
    // Circuit breaker: KILL_SWITCH halts ALL trading (ingest, measurement and
    // the convergence study keep running — the tool never goes blind).
    if (process.env.KILL_SWITCH === "1") return;
    if (!t.market) return;
    const price = t.market[intent.side];
    if (intent.action === "open") {
      if (!t.model || price <= 0.02 || price >= 0.98) return;
      const f = kellyFraction(t.model[intent.side], price, this.cfg.kellyK);
      const exposure = open.reduce((a, p) => a + p.stake, 0);
      const stake = Math.min(f * this.cfg.bankroll, this.cfg.maxStakePerPosition, this.cfg.maxExposurePerFixture - exposure);
      if (stake < 1) return;
      this.db.prepare(
        "INSERT INTO positions (strategy, fixture_id, side, entry_prob, stake, opened_ts) VALUES (?,?,?,?,?,?)",
      ).run(strategy, t.fixtureId, intent.side, price, stake, t.frameTs);
      this.record(strategy, t, "open", intent.side, stake, intent.reason);
    } else {
      const p = open.find((x) => x.id === intent.positionId);
      if (!p) return;
      const pnl = (p.stake * (price - p.entryProb)) / p.entryProb;
      this.db.prepare("UPDATE positions SET closed_ts = ?, exit_prob = ?, pnl = ? WHERE id = ?")
        .run(t.frameTs, price, pnl, p.id);
      this.record(strategy, t, "close", intent.side, p.stake, `${intent.reason} | pnl ${pnl.toFixed(2)}`);
    }
  }

  /** Full-time: settle held positions at 0/1 from the final score. */
  private settleFixture(c: FixtureCtx): void {
    const { scoreHome, scoreAway, fixtureId, lastFrameTs } = c.match;
    const winner: Side = scoreHome > scoreAway ? "home" : scoreHome === scoreAway ? "draw" : "away";
    const rows = this.db.prepare(
      "SELECT id, strategy, side, entry_prob AS entryProb, stake FROM positions WHERE fixture_id = ? AND closed_ts IS NULL",
    ).all(fixtureId) as Array<{ id: number; strategy: string; side: Side; entryProb: number; stake: number }>;
    for (const p of rows) {
      const won = p.side === winner;
      const pnl = won ? (p.stake * (1 - p.entryProb)) / p.entryProb : -p.stake;
      this.db.prepare("UPDATE positions SET closed_ts = ?, exit_prob = ?, pnl = ?, settled = 1 WHERE id = ?")
        .run(lastFrameTs, won ? 1 : 0, pnl, p.id);
      const t: Tick = {
        fixtureId, frameTs: lastFrameTs, minute: 90, minutesLeft: 0, calibrated: true,
        model: null, market: null, gapHome: null, shocks: [], recentShock: null, finalised: true,
      };
      this.record(p.strategy, t, "settle", p.side, p.stake, `final ${scoreHome}-${scoreAway} | ${won ? "WON" : "lost"} | pnl ${pnl.toFixed(2)}`);
    }
  }

  private record(strategy: string, t: Tick, action: DecisionRecord["action"], side: Side, stake: number, reason: string): void {
    const rec: DecisionRecord = {
      frameTs: t.frameTs, fixtureId: t.fixtureId, strategy, action, side, stake: Number(stake.toFixed(2)),
      model: t.model, market: t.market, gap: t.gapHome, reason, hash: "",
    };
    rec.hash = createHash("sha256").update(JSON.stringify({ ...rec, hash: undefined })).digest("hex");
    this.db.prepare(
      `INSERT INTO decisions (frame_ts, fixture_id, strategy, action, side, stake,
        model_home, model_draw, model_away, market_home, market_draw, market_away, gap, reason, hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      rec.frameTs, rec.fixtureId, strategy, action, side, rec.stake,
      rec.model?.home ?? null, rec.model?.draw ?? null, rec.model?.away ?? null,
      rec.market?.home ?? null, rec.market?.draw ?? null, rec.market?.away ?? null,
      rec.gap, reason, rec.hash,
    );
    this.events.log?.(`decision ${action}`, { strategy, fixtureId: t.fixtureId, side, stake: rec.stake, reason });
    this.events.onDecision?.(rec);
  }
}
