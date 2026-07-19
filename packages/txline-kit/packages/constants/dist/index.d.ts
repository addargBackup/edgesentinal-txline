/**
 * @txline-kit/constants — soccer feed encodings, stat-key algebra, odds math.
 * Encodings sourced from https://txline.txodds.com/documentation/scores/soccer-feed
 * and the txoracle IDL. See ../../docs/VERIFIED.md for provenance.
 */
export declare const STAT: {
    readonly T1_GOALS: 1;
    readonly T2_GOALS: 2;
    readonly T1_YELLOW: 3;
    readonly T2_YELLOW: 4;
    readonly T1_RED: 5;
    readonly T2_RED: 6;
    readonly T1_CORNERS: 7;
    readonly T2_CORNERS: 8;
};
export type StatBase = (typeof STAT)[keyof typeof STAT];
export declare const PERIOD: {
    readonly TOTAL: 0;
    readonly H1: 1000;
    readonly HT: 2000;
    readonly H2: 3000;
    readonly ET1: 4000;
    readonly ET2: 5000;
    readonly PE: 6000;
    readonly ET_TOTAL: 7000;
};
export type PeriodPrefix = (typeof PERIOD)[keyof typeof PERIOD];
/** Compose a stat key: statKey(STAT.T1_CORNERS, PERIOD.H2) === 3007 */
export declare function statKey(base: number, period?: number): number;
/** Decompose a stat key: parseStatKey(3007) === { base: 7, period: 3000 } */
export declare function parseStatKey(key: number): {
    base: number;
    period: number;
};
export declare const PHASE: {
    readonly NS: 1;
    readonly H1: 2;
    readonly HT: 3;
    readonly H2: 4;
    readonly F: 5;
    readonly WET: 6;
    readonly ET1: 7;
    readonly HTET: 8;
    readonly ET2: 9;
    readonly FET: 10;
    readonly WPE: 11;
    readonly PE: 12;
    readonly FPE: 13;
    readonly I: 14;
    readonly A: 15;
    readonly C: 16;
    readonly TXCC: 17;
    readonly TXCS: 18;
    readonly P: 19;
};
export type PhaseName = keyof typeof PHASE;
export type PhaseId = (typeof PHASE)[PhaseName];
export declare const PHASE_NAME: Record<number, PhaseName>;
/** Accepts a phase id (4) or name ("H2"); returns the id or undefined. */
export declare function normalizePhase(input: number | string): number | undefined;
export declare function isLive(phase: number | string): boolean;
export declare function isTerminal(phase: number | string): boolean;
/** Interrupted / Abandoned / Cancelled / Postponed — markets should void+refund. */
export declare function isVoidable(phase: number | string): boolean;
/** Final, immutable record for a fixture (per soccer-feed docs). Live records
 *  are PascalCase (`Action`); older docs show camelCase — accept both. */
export declare function isFinalised(update: {
    Action?: string;
    action?: string;
}): boolean;
export declare const ShotType: readonly ["OnTarget", "OffTarget", "Woodwork", "Blocked"];
export type ShotType = (typeof ShotType)[number];
export declare const FreeKickRating: readonly ["Safe", "Attack", "Danger", "HighDanger", "Offside"];
export type FreeKickRating = (typeof FreeKickRating)[number];
export declare const VarType: readonly ["Goal", "Penalty", "RedCard", "SecondYellowCard", "CornerKick", "MistakenIdentity", "Other"];
export type VarType = (typeof VarType)[number];
export declare const VarOutcome: readonly ["Stands", "Overturned"];
export type VarOutcome = (typeof VarOutcome)[number];
export declare const PenaltyResult: readonly ["Scored", "Missed", "Retake"];
export type PenaltyResult = (typeof PenaltyResult)[number];
/** Implied probability from decimal odds (e.g. 2.5 -> 0.4). */
export declare function impliedProbability(decimalOdds: number): number;
/**
 * TxLINE OddsPayload.Pct entries are de-margined percentage strings formatted to
 * 3 decimal places ("52.632"), or "NA" for quarter-handicap lines.
 * Returns probability in [0,1] or null for NA/invalid.
 */
export declare function pctToProbability(pct: string): number | null;
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
export declare function discoverMarkets(records: OddsLike[]): MarketDescriptor[];
/**
 * Latest de-margined probabilities for one market from a list of odds records.
 * Picks the newest record matching the market and maps PriceNames -> probability.
 */
export declare function latestProbabilities(records: OddsLike[], market: {
    superOddsType: string;
    marketPeriod?: string;
    marketParameters?: string;
}): Record<string, number | null> | null;
//# sourceMappingURL=index.d.ts.map