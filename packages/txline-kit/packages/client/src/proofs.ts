/** Merkle-proof + txoracle program helpers.
 *  Call patterns verified against tx-on-chain/examples (see docs/VERIFIED.md (a)). */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { NETWORKS } from "./networks.js";
import type {
  ApiProofNode, ScoresStatValidation, ScoresStatValidationV2,
} from "./types.js";

export type { ApiProofNode, ProofBundle, ScoresStatValidation, ScoresStatValidationV2, ScoreStat } from "./types.js";

/** Coerce an API hash (byte array | base64 | hex string) to number[32] for Anchor. */
export function toBytes32(v: number[] | Uint8Array | Buffer | string): number[] {
  let bytes: number[];
  if (typeof v === "string") {
    if (/^[0-9a-fA-F]{64}$/.test(v)) bytes = [...Buffer.from(v, "hex")];
    else bytes = [...Buffer.from(v, "base64")];
  } else {
    bytes = Array.from(v);
  }
  if (bytes.length !== 32) {
    throw new RangeError(`Expected 32-byte hash, got ${bytes.length} bytes`);
  }
  return bytes;
}

export interface AnchorProofNode {
  hash: number[];
  isRightSibling: boolean;
}

/** Map API proof nodes to the exact shape Anchor expects (number[] hashes). */
export function toProofNodes(nodes: ApiProofNode[] | null | undefined): AnchorProofNode[] {
  return (nodes ?? []).map((n) => ({
    hash: toBytes32(n.hash),
    isRightSibling: n.isRightSibling,
  }));
}

/** epochDay used by daily-roots PDAs: floor(millis / 86_400_000). */
export function epochDayFromTs(ts: number): number {
  return Math.floor(ts / 86_400_000);
}

/** PDA ["daily_scores_roots", epochDay as u16 LE] on the txoracle program. */
export function dailyScoresRootsPda(programId: PublicKey, epochDay: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toBuffer("le", 2)],
    programId,
  );
  return pda;
}

export function txoracleProgramId(network: "devnet" | "mainnet"): PublicKey {
  return new PublicKey(NETWORKS[network].programId);
}

const idlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "idl");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadTxoracleIdl(network: "devnet" | "mainnet"): any {
  const file = path.join(idlDir, `txoracle.${network}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// ---------------------------------------------------------------------------
// Payload builders (Anchor camelCases the Rust field names)
// ---------------------------------------------------------------------------

export interface AnchorScoresBatchSummary {
  fixtureId: BN;
  updateStats: { updateCount: number; minTimestamp: BN; maxTimestamp: BN };
  eventsSubTreeRoot: number[];
}

function toAnchorSummary(v: ScoresStatValidation | ScoresStatValidationV2): AnchorScoresBatchSummary {
  return {
    fixtureId: new BN(v.summary.fixtureId),
    updateStats: {
      updateCount: v.summary.updateStats.updateCount,
      minTimestamp: new BN(v.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(v.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: toBytes32(v.summary.eventStatsSubTreeRoot),
  };
}

export type ComparisonName = "greaterThan" | "lessThan" | "equalTo";
export type BinaryOpName = "add" | "subtract";

/** { threshold, comparison: { greaterThan: {} } } — TraderPredicate for Anchor. */
export function traderPredicate(comparison: ComparisonName, threshold: number) {
  return { threshold, comparison: { [comparison]: {} } };
}

/** Args for `validateStat` (legacy 1-2 stat mode) from a legacy proof response.
 *  Semantics: (statA op statB?) <comparison> threshold. */
export function buildValidateStatArgs(
  v: ScoresStatValidation,
  predicate: { comparison: ComparisonName; threshold: number },
  op: BinaryOpName | null = null,
) {
  const statTerm = (stat: ScoresStatValidation["statToProve"], proof: ApiProofNode[]) => ({
    statToProve: stat,
    eventStatRoot: toBytes32(v.eventStatRoot),
    statProof: toProofNodes(proof),
  });
  return {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: toAnchorSummary(v),
    fixtureProof: toProofNodes(v.subTreeProof),
    mainTreeProof: toProofNodes(v.mainTreeProof),
    predicate: traderPredicate(predicate.comparison, predicate.threshold),
    statA: statTerm(v.statToProve, v.statProof),
    statB: v.statToProve2 && v.statProof2 ? statTerm(v.statToProve2, v.statProof2) : null,
    op: op ? { [op]: {} } : null,
  };
}

/** StatValidationInput for `validateStatV2` from a V2 proof response
 *  (statKeys order in the request maps positionally to strategy indexes). */
export function buildStatValidationInput(v: ScoresStatValidationV2) {
  return {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: toAnchorSummary(v),
    fixtureProof: toProofNodes(v.subTreeProof),
    mainTreeProof: toProofNodes(v.mainTreeProof),
    eventStatRoot: toBytes32(v.eventStatRoot),
    stats: (v.statsToProve ?? []).map((stat, i) => ({
      stat,
      statProof: toProofNodes(v.statProofs[i]),
    })),
  };
}

/** Strategy helpers for validateStatV2 (indexes = positions in statKeys). */
export const strategy = {
  single(index: number, comparison: ComparisonName, threshold: number) {
    return { single: { index, predicate: traderPredicate(comparison, threshold) } };
  },
  binary(indexA: number, indexB: number, op: BinaryOpName, comparison: ComparisonName, threshold: number) {
    return {
      binary: {
        indexA, indexB,
        op: { [op]: {} },
        predicate: traderPredicate(comparison, threshold),
      },
    };
  },
  build(opts: {
    discrete?: unknown[];
    geometricTargets?: { statIndex: number; prediction: number }[];
    distancePredicate?: { comparison: ComparisonName; threshold: number };
  }) {
    return {
      geometricTargets: opts.geometricTargets ?? [],
      distancePredicate: opts.distancePredicate
        ? traderPredicate(opts.distancePredicate.comparison, opts.distancePredicate.threshold)
        : null,
      discretePredicates: opts.discrete ?? [],
    };
  },
};
