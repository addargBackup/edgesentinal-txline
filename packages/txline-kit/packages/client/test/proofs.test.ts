import { describe, expect, it } from "vitest";
import {
  buildStatValidationInput, buildValidateStatArgs, dailyScoresRootsPda,
  epochDayFromTs, loadTxoracleIdl, strategy, toBytes32, toProofNodes,
  txoracleProgramId,
} from "../src/proofs.js";
import type { ScoresStatValidation, ScoresStatValidationV2 } from "../src/types.js";

const HASH = Array.from({ length: 32 }, (_, i) => i);

describe("toBytes32", () => {
  it("passes through 32-byte arrays", () => {
    expect(toBytes32(HASH)).toEqual(HASH);
  });
  it("decodes base64", () => {
    expect(toBytes32(Buffer.from(HASH).toString("base64"))).toEqual(HASH);
  });
  it("decodes hex", () => {
    expect(toBytes32(Buffer.from(HASH).toString("hex"))).toEqual(HASH);
  });
  it("rejects wrong lengths", () => {
    expect(() => toBytes32([1, 2, 3])).toThrow(RangeError);
  });
});

describe("epochDay + PDA", () => {
  it("computes epochDay from millis", () => {
    expect(epochDayFromTs(20624 * 86_400_000 + 5)).toBe(20624);
  });
  it("derives the daily scores roots PDA deterministically", () => {
    const pid = txoracleProgramId("devnet");
    const a = dailyScoresRootsPda(pid, 20624);
    const b = dailyScoresRootsPda(pid, 20624);
    const c = dailyScoresRootsPda(pid, 20625);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});

describe("IDL loading", () => {
  it("loads network-matched IDLs", () => {
    expect(loadTxoracleIdl("devnet").address).toBe("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
    expect(loadTxoracleIdl("mainnet").address).toBe("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA");
  });
});

const summary = {
  fixtureId: 18179550,
  updateStats: { updateCount: 10, minTimestamp: 1782000000000, maxTimestamp: 1782000600000 },
  eventStatsSubTreeRoot: HASH,
};
const node = { hash: HASH, isRightSibling: true };

describe("payload builders", () => {
  it("builds validateStat args (1X2 home-win shape)", () => {
    const v: ScoresStatValidation = {
      ts: 1782000000000,
      statToProve: { key: 1, value: 2, period: 0 },
      statToProve2: { key: 2, value: 1, period: 0 },
      eventStatRoot: HASH,
      summary,
      statProof: [node],
      statProof2: [node],
      subTreeProof: [node],
      mainTreeProof: [node, node],
    };
    const args = buildValidateStatArgs(v, { comparison: "greaterThan", threshold: 0 }, "subtract");
    expect(args.ts.toString()).toBe("1782000000000");
    expect(args.fixtureSummary.eventsSubTreeRoot).toEqual(HASH);
    expect(args.statA.statToProve).toEqual({ key: 1, value: 2, period: 0 });
    expect(args.statB?.statToProve).toEqual({ key: 2, value: 1, period: 0 });
    expect(args.op).toEqual({ subtract: {} });
    expect(args.predicate).toEqual({ threshold: 0, comparison: { greaterThan: {} } });
    expect(args.mainTreeProof).toHaveLength(2);
    expect(args.mainTreeProof[0].hash).toEqual(HASH);
  });

  it("builds StatValidationInput from a V2 response positionally", () => {
    const v: ScoresStatValidationV2 = {
      ts: 1782000000000,
      statsToProve: [
        { key: 1, value: 2, period: 0 },
        { key: 2, value: 1, period: 0 },
      ],
      eventStatRoot: HASH,
      summary,
      statProofs: [[node], [node, node]],
      subTreeProof: [node],
      mainTreeProof: [node],
    };
    const payload = buildStatValidationInput(v);
    expect(payload.stats).toHaveLength(2);
    expect(payload.stats[1].statProof).toHaveLength(2);
    expect(payload.ts.toString()).toBe("1782000000000");
  });

  it("builds strategies with positional indexes", () => {
    const s = strategy.build({
      discrete: [
        strategy.binary(0, 1, "subtract", "greaterThan", 0),
        strategy.single(0, "greaterThan", 0),
      ],
    });
    expect(s.discretePredicates).toHaveLength(2);
    expect(s.geometricTargets).toEqual([]);
    expect(s.distancePredicate).toBeNull();
  });
});

describe("proof node mapping", () => {
  it("coerces node hashes", () => {
    const mapped = toProofNodes([{ hash: Buffer.from(HASH).toString("base64"), isRightSibling: false }]);
    expect(mapped[0].hash).toEqual(HASH);
    expect(mapped[0].isRightSibling).toBe(false);
  });
});
