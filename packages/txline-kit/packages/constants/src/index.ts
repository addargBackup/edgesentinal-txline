/**
 * @txline-kit/constants — soccer feed encodings, stat-key algebra, odds math.
 * Encodings sourced from https://txline.txodds.com/documentation/scores/soccer-feed
 * and the txoracle IDL. See ../../docs/VERIFIED.md for provenance.
 */

// ---------------------------------------------------------------------------
// Stat keys (settlement vocabulary — team-level only)
// ---------------------------------------------------------------------------

export const STAT = {
  T1_GOALS: 1,
  T2_GOALS: 2,
  T1_YELLOW: 3,
  T2_YELLOW: 4,
  T1_RED: 5,
  T2_RED: 6,
  T1_CORNERS: 7,
  T2_CORNERS: 8,
} as const;
export type StatBase = (typeof STAT)[keyof typeof STAT];

export const PERIOD = {
  TOTAL: 0,
  H1: 1000,
  HT: 2000,
  H2: 3000,
  ET1: 4000,
  ET2: 5000,
  PE: 6000,
  ET_TOTAL: 7000,
} as const;
export type PeriodPrefix = (typeof PERIOD)[keyof typeof PERIOD];

const STAT_BASES = new Set<number>(Object.values(STAT));
const PERIOD_PREFIXES = new Set<number>(Object.values(PERIOD));

/** Compose a stat key: statKey(STAT.T1_CORNERS, PERIOD.H2) === 3007 */
export function statKey(base: number, period: number = PERIOD.TOTAL): number {
  if (!STAT_BASES.has(base)) throw new RangeError(`Unknown stat base: ${base}`);
  if (!PERIOD_PREFIXES.has(period)) throw new RangeError(`Unknown period prefix: ${period}`);
  return period + base;
}

/** Decompose a stat key: parseStatKey(3007) === { base: 7, period: 3000 } */
export function parseStatKey(key: number): { base: number; period: number } {
  const period = Math.floor(key / 1000) * 1000;
  const base = key - period;
  if (!STAT_BASES.has(base)) throw new RangeError(`Unknown stat base in key: ${key}`);
  if (!PERIOD_PREFIXES.has(period)) throw new RangeError(`Unknown period prefix in key: ${key}`);
  return { base, period };
}

// ---------------------------------------------------------------------------
// Game phases
// ---------------------------------------------------------------------------

export const PHASE = {
  NS: 1, H1: 2, HT: 3, H2: 4, F: 5, WET: 6, ET1: 7, HTET: 8, ET2: 9,
  FET: 10, WPE: 11, PE: 12, FPE: 13, I: 14, A: 15, C: 16, TXCC: 17,
  TXCS: 18, P: 19,
} as const;
export type PhaseName = keyof typeof PHASE;
export type PhaseId = (typeof PHASE)[PhaseName];

export const PHASE_NAME: Record<number, PhaseName> = Object.fromEntries(
  Object.entries(PHASE).map(([k, v]) => [v, k as PhaseName]),
);

/** Accepts a phase id (4) or name ("H2"); returns the id or undefined. */
export function normalizePhase(input: number | string): number | undefined {
  if (typeof input === "number") return PHASE_NAME[input] ? input : undefined;
  const up = input.toUpperCase() as PhaseName;
  return (PHASE as Record<string, number>)[up];
}

const LIVE = new Set<number>([PHASE.H1, PHASE.HT, PHASE.H2, PHASE.WET, PHASE.ET1, PHASE.HTET, PHASE.ET2, PHASE.WPE, PHASE.PE]);
const TERMINAL = new Set<number>([PHASE.F, PHASE.FET, PHASE.FPE, PHASE.I, PHASE.A, PHASE.C, PHASE.P]);
const VOIDABLE = new Set<number>([PHASE.I, PHASE.A, PHASE.C, PHASE.P]);

export function isLive(phase: number | string): boolean {
  const p = normalizePhase(phase);
  return p !== undefined && LIVE.has(p);
}
export function isTerminal(phase: number | string): boolean {
  const p = normalizePhase(phase);
  return p !== undefined && TERMINAL.has(p);
}
/** Interrupted / Abandoned / Cancelled / Postponed — markets should void+refund. */
export function isVoidable(phase: number | string): boolean {
  const p = normalizePhase(phase);
  return p !== undefined && VOIDABLE.has(p);
}

/** Final, immutable record for a fixture (per soccer-feed docs). Live records
 *  are PascalCase (`Action`); older docs show camelCase — accept both. */
export function isFinalised(update: { Action?: string; action?: string }): boolean {
  return (update?.Action ?? update?.action) === "game_finalised";
}

// ---------------------------------------------------------------------------
// Soccer event enums (SoccerData fields per OpenAPI spec)
// ---------------------------------------------------------------------------

export const ShotType = ["OnTarget", "OffTarget", "Woodwork", "Blocked"] as const;
export type ShotType = (typeof ShotType)[number];

export const FreeKickRating = ["Safe", "Attack", "Danger", "HighDanger", "Offside"] as const;
export type FreeKickRating = (typeof FreeKickRating)[number];

export const VarType = ["Goal", "Penalty", "RedCard", "SecondYellowCard", "CornerKick", "MistakenIdentity", "Other"] as const;
export type VarType = (typeof VarType)[number];

export const VarOutcome = ["Stands", "Overturned"] as const;
export type VarOutcome = (typeof VarOutcome)[number];

export const PenaltyResult = ["Scored", "Missed", "Retake"] as const;
export type PenaltyResult = (typeof PenaltyResult)[number];

// ---------------------------------------------------------------------------
// Odds math + market discovery
// ---------------------------------------------------------------------------

/** Implied probability from decimal odds (e.g. 2.5 -> 0.4). */
export function impliedProbability(decimalOdds: number): number {
  if (!(decimalOdds > 1)) throw new RangeError(`Decimal odds must be > 1, got ${decimalOdds}`);
  return 1 / decimalOdds;
}

/**
 * TxLINE OddsPayload.Pct entries are de-margined percentage strings formatted to
 * 3 decimal places ("52.632"), or "NA" for quarter-handicap lines.
 * Returns probability in [0,1] or null for NA/invalid.
 */
export function pctToProbability(pct: string): number | null {
  if (pct === "NA") return null;
  const n = Number(pct);
  return Number.isFinite(n) ? n / 100 : null;
}

/** Minimal shape of one odds record needed for discovery/probability work. */
export interface OddsLike {
  FixtureId: number;
  Ts: number;
  SuperOddsType: string;
  MarketPeriod?: string;
  MarketParameters?: string;
  PriceNames?: string[];
  Prices?: number[];
  Pct?: string[];
  InRunning?: boolean;
  GameState?: string;
}

export interface MarketDescriptor {
  superOddsType: string;
  marketPeriod?: string;
  marketParameters?: string;
  priceNames: string[];
  /** Ts of the latest record seen for this market. */
  lastTs: number;
}

/**
 * Enumerate which markets are ACTUALLY present in an odds snapshot/stream slice.
 * The docs explicitly warn market availability varies per fixture — never assume.
 */
export function discoverMarkets(records: OddsLike[]): MarketDescriptor[] {
  const byKey = new Map<string, MarketDescriptor>();
  for (const r of records ?? []) {
    if (!r?.SuperOddsType) continue;
    const key = `${r.SuperOddsType}|${r.MarketPeriod ?? ""}|${r.MarketParameters ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        superOddsType: r.SuperOddsType,
        marketPeriod: r.MarketPeriod,
        marketParameters: r.MarketParameters,
        priceNames: r.PriceNames ?? [],
        lastTs: r.Ts,
      });
    } else if (r.Ts > existing.lastTs) {
      existing.lastTs = r.Ts;
      if (r.PriceNames?.length) existing.priceNames = r.PriceNames;
    }
  }
  return [...byKey.values()].sort((a, b) => a.superOddsType.localeCompare(b.superOddsType));
}

/**
 * Latest de-margined probabilities for one market from a list of odds records.
 * Picks the newest record matching the market and maps PriceNames -> probability.
 */
export function latestProbabilities(
  records: OddsLike[],
  market: { superOddsType: string; marketPeriod?: string; marketParameters?: string },
): Record<string, number | null> | null {
  let latest: OddsLike | undefined;
  for (const r of records ?? []) {
    if (r.SuperOddsType !== market.superOddsType) continue;
    if ((market.marketPeriod ?? "") !== (r.MarketPeriod ?? "")) continue;
    if ((market.marketParameters ?? "") !== (r.MarketParameters ?? "")) continue;
    if (!latest || r.Ts > latest.Ts) latest = r;
  }
  if (!latest?.PriceNames || !latest.Pct) return null;
  const out: Record<string, number | null> = {};
  latest.PriceNames.forEach((name, i) => {
    out[name] = pctToProbability(latest!.Pct![i] ?? "NA");
  });
  return out;
}
