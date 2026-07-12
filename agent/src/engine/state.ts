/** Pure reducers over TxLINE frames: match state (phases via StatusId — NOT
 *  GameState — and an EstimatedClock from phase-anchor frame timestamps, since
 *  Clock{} is never populated; see txline-kit VERIFIED.md) and market state
 *  (de-margined 1X2 Pct). All time is FRAME time — identical behavior live
 *  and in accelerated replay/backtest. */
import type { OddsPayload, ScoreUpdate } from "@txline-kit/client";
import { isFinalised, PHASE, pctToProbability } from "@txline-kit/constants";
import type { Probs } from "./model.js";

export interface Shock {
  kind: "goal_home" | "goal_away" | "red_home" | "red_away";
  frameTs: number;
  minute: number;
}

export interface MatchState {
  fixtureId: number;
  statusId: number | null;
  scoreHome: number;
  scoreAway: number;
  redsHome: number;
  redsAway: number;
  h1AnchorTs: number | null;
  h2AnchorTs: number | null;
  lastFrameTs: number;
  kickoff: boolean;
  finalised: boolean;
  finalSeq: number | null;
  stats: Record<string, number>;
}

export function initialMatch(fixtureId: number): MatchState {
  return {
    fixtureId, statusId: null, scoreHome: 0, scoreAway: 0, redsHome: 0, redsAway: 0,
    h1AnchorTs: null, h2AnchorTs: null, lastFrameTs: 0, kickoff: false,
    finalised: false, finalSeq: null, stats: {},
  };
}

export function estimateMinute(s: MatchState, frameTs: number): number {
  if (s.statusId === PHASE.HT) return 45;
  if (s.h2AnchorTs !== null) return Math.min(45 + (frameTs - s.h2AnchorTs) / 60_000, 100);
  if (s.h1AnchorTs !== null) return Math.min((frameTs - s.h1AnchorTs) / 60_000, 50);
  return 0;
}

/** Minutes of regulation play remaining (the model's horizon). */
export function minutesLeft(s: MatchState, frameTs: number): number {
  return Math.max(0, 90 - estimateMinute(s, frameTs));
}

export function reduceMatch(s: MatchState, u: ScoreUpdate): { state: MatchState; shocks: Shock[] } {
  const shocks: Shock[] = [];
  const next: MatchState = { ...s, lastFrameTs: u.Ts };

  const statusId = (u.StatusId as number) ?? s.statusId;
  if (statusId !== s.statusId && statusId != null) {
    next.statusId = statusId;
    if (statusId === PHASE.H1 && s.h1AnchorTs === null) {
      next.h1AnchorTs = u.Ts;
      next.kickoff = true;
    }
    if (statusId === PHASE.H2 && s.h2AnchorTs === null) next.h2AnchorTs = u.Ts;
  }

  if (u.Stats) {
    const minute = estimateMinute(next, u.Ts);
    const val = (k: number) => u.Stats![String(k)] ?? 0;
    if (val(1) > s.scoreHome) shocks.push({ kind: "goal_home", frameTs: u.Ts, minute });
    if (val(2) > s.scoreAway) shocks.push({ kind: "goal_away", frameTs: u.Ts, minute });
    if (val(5) > s.redsHome) shocks.push({ kind: "red_home", frameTs: u.Ts, minute });
    if (val(6) > s.redsAway) shocks.push({ kind: "red_away", frameTs: u.Ts, minute });
    next.scoreHome = val(1);
    next.scoreAway = val(2);
    next.redsHome = val(5);
    next.redsAway = val(6);
    next.stats = u.Stats;
  }

  if (!s.finalised && isFinalised(u)) {
    next.finalised = true;
    next.finalSeq = u.Seq;
  }
  return { state: next, shocks };
}

// ---------------------------------------------------------------------------
export interface MarketState {
  fixtureId: number;
  latest: (Probs & { frameTs: number }) | null;
  /** first N readings used for kickoff λ calibration (pre-match odds absent). */
  early: Probs[];
}

export function initialMarket(fixtureId: number): MarketState {
  return { fixtureId, latest: null, early: [] };
}

const is1x2 = (o: OddsPayload) => o.SuperOddsType === "1X2_PARTICIPANT_RESULT" && !o.MarketPeriod;

/** `collectEarly` must only be true once the match has kicked off: corpus
 *  backfills can contain stale pre-window quotes, and calibrating λ from them
 *  poisons the model for the whole match (found in audit — the staleness
 *  guard protected trades but not calibration). */
export function reduceMarket(s: MarketState, o: OddsPayload, collectEarly: boolean): MarketState {
  if (!is1x2(o) || !o.PriceNames || !o.Pct) return s;
  const idx = (n: string) => o.PriceNames!.indexOf(n);
  const home = pctToProbability(o.Pct[idx("part1")] ?? "NA");
  const draw = pctToProbability(o.Pct[idx("draw")] ?? "NA");
  const away = pctToProbability(o.Pct[idx("part2")] ?? "NA");
  if (home == null || away == null || draw == null) return s;
  const p = { home, draw, away, frameTs: o.Ts };
  return {
    ...s,
    latest: p,
    early: collectEarly && s.early.length < 5 ? [...s.early, { home, draw, away }] : s.early,
  };
}

/** Median of the first readings — the kickoff consensus for calibration. */
export function kickoffConsensus(s: MarketState): Probs | null {
  if (s.early.length < 3) return null;
  const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return {
    home: med(s.early.map((p) => p.home)),
    draw: med(s.early.map((p) => p.draw)),
    away: med(s.early.map((p) => p.away)),
  };
}
