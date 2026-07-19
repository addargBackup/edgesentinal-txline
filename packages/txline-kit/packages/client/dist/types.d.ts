/** Typed subsets of the TxLINE OpenAPI schemas (vendor/docs.yaml). Unknown
 *  fields are preserved via index signatures — the API is additive. */
export interface Fixture {
    Ts: number;
    StartTime: number;
    Competition: string;
    CompetitionId: number;
    FixtureGroupId: number;
    Participant1Id: number;
    Participant1: string;
    Participant2Id: number;
    Participant2: string;
    FixtureId: number;
    Participant1IsHome: boolean;
    [k: string]: unknown;
}
/** OddsPayload — StablePrice consensus record. Pct is de-margined ("52.632" | "NA"). */
export interface OddsPayload {
    FixtureId: number;
    MessageId: string;
    Ts: number;
    Bookmaker: string;
    BookmakerId: number;
    SuperOddsType: string;
    GameState?: string;
    InRunning: boolean;
    MarketParameters?: string;
    MarketPeriod?: string;
    PriceNames?: string[];
    Prices?: number[];
    Pct?: string[];
    [k: string]: unknown;
}
export interface SoccerTotalScore {
    [k: string]: unknown;
}
export interface SoccerFixtureClock {
    running: boolean;
    seconds: number;
}
/** SoccerData — per-event detail payload (booleans per event type). */
export interface SoccerData {
    Action?: string;
    Corner?: boolean;
    Goal?: boolean;
    GoalType?: unknown;
    RedCard?: boolean;
    YellowCard?: boolean;
    VAR?: boolean;
    Penalty?: boolean;
    FreeKickType?: string;
    ThrowInType?: string;
    Minutes?: number;
    Participant?: number;
    PlayerId?: number;
    Outcome?: string;
    Type?: string;
    StatusId?: number;
    [k: string]: unknown;
}
/** One Scores update record (soccer subset). `Seq` is the on-chain-provable
 *  sequence. NOTE: live records are PascalCase (verified 2026-07-11), e.g.
 *  {"FixtureId":18209181,"GameState":"scheduled","Action":"coverage_update",
 *   "Ts":...,"Seq":0,"Data":{},"Stats":{}} */
export interface ScoreUpdate {
    FixtureId: number;
    GameState: string;
    StartTime: number;
    IsTeam: boolean;
    FixtureGroupId: number;
    CompetitionId: number;
    CountryId: number;
    SportId: number;
    Participant1IsHome: boolean;
    Participant1Id: number;
    Participant2Id: number;
    Action: string;
    Id: number;
    Ts: number;
    ConnectionId: number;
    Seq: number;
    Clock?: SoccerFixtureClock;
    Score?: {
        Participant1: SoccerTotalScore;
        Participant2: SoccerTotalScore;
    };
    Data?: SoccerData;
    /** Map of statKey -> value (settlement stats). */
    Stats?: Record<string, number>;
    [k: string]: unknown;
}
export type ScoresSnapshot = ScoreUpdate;
export interface ApiProofNode {
    hash: number[] | string;
    isRightSibling: boolean;
}
export interface ScoreStat {
    key: number;
    value: number;
    period: number;
}
export interface ScoresUpdateStats {
    updateCount: number;
    minTimestamp: number;
    maxTimestamp: number;
}
export interface ScoresBatchSummary {
    fixtureId: number;
    updateStats: ScoresUpdateStats;
    eventStatsSubTreeRoot: number[] | string;
}
/** Legacy mode (statKey / statKey2) response. */
export interface ScoresStatValidation {
    ts: number;
    statToProve: ScoreStat;
    eventStatRoot: number[] | string;
    summary: ScoresBatchSummary;
    statProof: ApiProofNode[];
    subTreeProof: ApiProofNode[];
    mainTreeProof: ApiProofNode[];
    statToProve2?: ScoreStat;
    statProof2?: ApiProofNode[];
}
/** V2 mode (statKeys=a,b,...) response. Arrays are positional wrt statKeys. */
export interface ScoresStatValidationV2 {
    ts: number;
    statsToProve: ScoreStat[];
    eventStatRoot: number[] | string;
    summary: ScoresBatchSummary;
    statProofs: ApiProofNode[][];
    subTreeProof: ApiProofNode[];
    mainTreeProof: ApiProofNode[];
}
export type ProofBundle = ScoresStatValidation | ScoresStatValidationV2;
export interface StreamHealth {
    scoresLastEventAt: number | null;
    oddsLastEventAt: number | null;
    reconnects: number;
}
//# sourceMappingURL=types.d.ts.map