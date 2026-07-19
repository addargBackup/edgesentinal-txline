import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import type { ApiProofNode, ScoresStatValidation, ScoresStatValidationV2 } from "./types.js";
export type { ApiProofNode, ProofBundle, ScoresStatValidation, ScoresStatValidationV2, ScoreStat } from "./types.js";
/** Coerce an API hash (byte array | base64 | hex string) to number[32] for Anchor. */
export declare function toBytes32(v: number[] | Uint8Array | Buffer | string): number[];
export interface AnchorProofNode {
    hash: number[];
    isRightSibling: boolean;
}
/** Map API proof nodes to the exact shape Anchor expects (number[] hashes). */
export declare function toProofNodes(nodes: ApiProofNode[] | null | undefined): AnchorProofNode[];
/** epochDay used by daily-roots PDAs: floor(millis / 86_400_000). */
export declare function epochDayFromTs(ts: number): number;
/** PDA ["daily_scores_roots", epochDay as u16 LE] on the txoracle program. */
export declare function dailyScoresRootsPda(programId: PublicKey, epochDay: number): PublicKey;
export declare function txoracleProgramId(network: "devnet" | "mainnet"): PublicKey;
export declare function loadTxoracleIdl(network: "devnet" | "mainnet"): any;
export interface AnchorScoresBatchSummary {
    fixtureId: BN;
    updateStats: {
        updateCount: number;
        minTimestamp: BN;
        maxTimestamp: BN;
    };
    eventsSubTreeRoot: number[];
}
export type ComparisonName = "greaterThan" | "lessThan" | "equalTo";
export type BinaryOpName = "add" | "subtract";
/** { threshold, comparison: { greaterThan: {} } } — TraderPredicate for Anchor. */
export declare function traderPredicate(comparison: ComparisonName, threshold: number): {
    threshold: number;
    comparison: {
        [comparison]: {};
    };
};
/** Args for `validateStat` (legacy 1-2 stat mode) from a legacy proof response.
 *  Semantics: (statA op statB?) <comparison> threshold. */
export declare function buildValidateStatArgs(v: ScoresStatValidation, predicate: {
    comparison: ComparisonName;
    threshold: number;
}, op?: BinaryOpName | null): {
    ts: BN;
    fixtureSummary: AnchorScoresBatchSummary;
    fixtureProof: AnchorProofNode[];
    mainTreeProof: AnchorProofNode[];
    predicate: {
        threshold: number;
        comparison: {
            [x: string]: {};
        };
    };
    statA: {
        statToProve: import("./types.js").ScoreStat;
        eventStatRoot: number[];
        statProof: AnchorProofNode[];
    };
    statB: {
        statToProve: import("./types.js").ScoreStat;
        eventStatRoot: number[];
        statProof: AnchorProofNode[];
    } | null;
    op: {
        [op]: {};
    } | null;
};
/** StatValidationInput for `validateStatV2` from a V2 proof response
 *  (statKeys order in the request maps positionally to strategy indexes). */
export declare function buildStatValidationInput(v: ScoresStatValidationV2): {
    ts: BN;
    fixtureSummary: AnchorScoresBatchSummary;
    fixtureProof: AnchorProofNode[];
    mainTreeProof: AnchorProofNode[];
    eventStatRoot: number[];
    stats: {
        stat: import("./types.js").ScoreStat;
        statProof: AnchorProofNode[];
    }[];
};
/** Strategy helpers for validateStatV2 (indexes = positions in statKeys). */
export declare const strategy: {
    single(index: number, comparison: ComparisonName, threshold: number): {
        single: {
            index: number;
            predicate: {
                threshold: number;
                comparison: {
                    [x: string]: {};
                };
            };
        };
    };
    binary(indexA: number, indexB: number, op: BinaryOpName, comparison: ComparisonName, threshold: number): {
        binary: {
            indexA: number;
            indexB: number;
            op: {
                [x: string]: {};
            };
            predicate: {
                threshold: number;
                comparison: {
                    [x: string]: {};
                };
            };
        };
    };
    build(opts: {
        discrete?: unknown[];
        geometricTargets?: {
            statIndex: number;
            prediction: number;
        }[];
        distancePredicate?: {
            comparison: ComparisonName;
            threshold: number;
        };
    }): {
        geometricTargets: {
            statIndex: number;
            prediction: number;
        }[];
        distancePredicate: {
            threshold: number;
            comparison: {
                [x: string]: {};
            };
        } | null;
        discretePredicates: unknown[];
    };
};
//# sourceMappingURL=proofs.d.ts.map