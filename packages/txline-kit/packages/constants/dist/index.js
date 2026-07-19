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
};
export const PERIOD = {
    TOTAL: 0,
    H1: 1000,
    HT: 2000,
    H2: 3000,
    ET1: 4000,
    ET2: 5000,
    PE: 6000,
    ET_TOTAL: 7000,
};
const STAT_BASES = new Set(Object.values(STAT));
const PERIOD_PREFIXES = new Set(Object.values(PERIOD));
/** Compose a stat key: statKey(STAT.T1_CORNERS, PERIOD.H2) === 3007 */
export function statKey(base, period = PERIOD.TOTAL) {
    if (!STAT_BASES.has(base))
        throw new RangeError(`Unknown stat base: ${base}`);
    if (!PERIOD_PREFIXES.has(period))
        throw new RangeError(`Unknown period prefix: ${period}`);
    return period + base;
}
/** Decompose a stat key: parseStatKey(3007) === { base: 7, period: 3000 } */
export function parseStatKey(key) {
    const period = Math.floor(key / 1000) * 1000;
    const base = key - period;
    if (!STAT_BASES.has(base))
        throw new RangeError(`Unknown stat base in key: ${key}`);
    if (!PERIOD_PREFIXES.has(period))
        throw new RangeError(`Unknown period prefix in key: ${key}`);
    return { base, period };
}
// ---------------------------------------------------------------------------
// Game phases
// ---------------------------------------------------------------------------
export const PHASE = {
    NS: 1, H1: 2, HT: 3, H2: 4, F: 5, WET: 6, ET1: 7, HTET: 8, ET2: 9,
    FET: 10, WPE: 11, PE: 12, FPE: 13, I: 14, A: 15, C: 16, TXCC: 17,
    TXCS: 18, P: 19,
};
export const PHASE_NAME = Object.fromEntries(Object.entries(PHASE).map(([k, v]) => [v, k]));
/** Accepts a phase id (4) or name ("H2"); returns the id or undefined. */
export function normalizePhase(input) {
    if (typeof input === "number")
        return PHASE_NAME[input] ? input : undefined;
    const up = input.toUpperCase();
    return PHASE[up];
}
const LIVE = new Set([PHASE.H1, PHASE.HT, PHASE.H2, PHASE.WET, PHASE.ET1, PHASE.HTET, PHASE.ET2, PHASE.WPE, PHASE.PE]);
const TERMINAL = new Set([PHASE.F, PHASE.FET, PHASE.FPE, PHASE.I, PHASE.A, PHASE.C, PHASE.P]);
const VOIDABLE = new Set([PHASE.I, PHASE.A, PHASE.C, PHASE.P]);
export function isLive(phase) {
    const p = normalizePhase(phase);
    return p !== undefined && LIVE.has(p);
}
export function isTerminal(phase) {
    const p = normalizePhase(phase);
    return p !== undefined && TERMINAL.has(p);
}
/** Interrupted / Abandoned / Cancelled / Postponed — markets should void+refund. */
export function isVoidable(phase) {
    const p = normalizePhase(phase);
    return p !== undefined && VOIDABLE.has(p);
}
/** Final, immutable record for a fixture (per soccer-feed docs). Live records
 *  are PascalCase (`Action`); older docs show camelCase — accept both. */
export function isFinalised(update) {
    return (update?.Action ?? update?.action) === "game_finalised";
}
// ---------------------------------------------------------------------------
// Soccer event enums (SoccerData fields per OpenAPI spec)
// ---------------------------------------------------------------------------
export const ShotType = ["OnTarget", "OffTarget", "Woodwork", "Blocked"];
export const FreeKickRating = ["Safe", "Attack", "Danger", "HighDanger", "Offside"];
export const VarType = ["Goal", "Penalty", "RedCard", "SecondYellowCard", "CornerKick", "MistakenIdentity", "Other"];
export const VarOutcome = ["Stands", "Overturned"];
export const PenaltyResult = ["Scored", "Missed", "Retake"];
// ---------------------------------------------------------------------------
// Odds math + market discovery
// ---------------------------------------------------------------------------
/** Implied probability from decimal odds (e.g. 2.5 -> 0.4). */
export function impliedProbability(decimalOdds) {
    if (!(decimalOdds > 1))
        throw new RangeError(`Decimal odds must be > 1, got ${decimalOdds}`);
    return 1 / decimalOdds;
}
/**
 * TxLINE OddsPayload.Pct entries are de-margined percentage strings formatted to
 * 3 decimal places ("52.632"), or "NA" for quarter-handicap lines.
 * Returns probability in [0,1] or null for NA/invalid.
 */
export function pctToProbability(pct) {
    if (pct === "NA")
        return null;
    const n = Number(pct);
    return Number.isFinite(n) ? n / 100 : null;
}
/**
 * Enumerate which markets are ACTUALLY present in an odds snapshot/stream slice.
 * The docs explicitly warn market availability varies per fixture — never assume.
 */
export function discoverMarkets(records) {
    const byKey = new Map();
    for (const r of records ?? []) {
        if (!r?.SuperOddsType)
            continue;
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
        }
        else if (r.Ts > existing.lastTs) {
            existing.lastTs = r.Ts;
            if (r.PriceNames?.length)
                existing.priceNames = r.PriceNames;
        }
    }
    return [...byKey.values()].sort((a, b) => a.superOddsType.localeCompare(b.superOddsType));
}
/**
 * Latest de-margined probabilities for one market from a list of odds records.
 * Picks the newest record matching the market and maps PriceNames -> probability.
 */
export function latestProbabilities(records, market) {
    let latest;
    for (const r of records ?? []) {
        if (r.SuperOddsType !== market.superOddsType)
            continue;
        if ((market.marketPeriod ?? "") !== (r.MarketPeriod ?? ""))
            continue;
        if ((market.marketParameters ?? "") !== (r.MarketParameters ?? ""))
            continue;
        if (!latest || r.Ts > latest.Ts)
            latest = r;
    }
    if (!latest?.PriceNames || !latest.Pct)
        return null;
    const out = {};
    latest.PriceNames.forEach((name, i) => {
        out[name] = pctToProbability(latest.Pct[i] ?? "NA");
    });
    return out;
}
//# sourceMappingURL=index.js.map