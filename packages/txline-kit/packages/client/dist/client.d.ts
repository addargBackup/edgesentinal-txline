import type { Keypair } from "@solana/web3.js";
import { type NetworkName } from "./networks.js";
import { type SseMessage } from "./sse.js";
import type { Fixture, OddsPayload, ProofBundle, ScoreUpdate, ScoresSnapshot, StreamHealth } from "./types.js";
export interface TxlineClientOptions {
    network: NetworkName;
    /** Funded keypair; required for first-time activation on devnet/mainnet. */
    wallet?: Keypair;
    serviceLevel?: number;
    weeks?: number;
    leagues?: number[];
    rpcUrl?: string;
    /** Required (and only meaningful) for network "replay": e.g. http://localhost:8788/api */
    baseUrl?: string;
    credsDir?: string;
}
export interface StatValidationParams {
    fixtureId: number;
    /** From a real score record (scoresSnapshot().seq) — NEVER 0. */
    seq: number;
    statKey?: number;
    statKey2?: number;
    statKeys?: number[];
}
export interface StreamOptions {
    fixtureId?: number;
    signal?: AbortSignal;
}
export interface TxlineClient {
    readonly network: NetworkName;
    readonly apiBase: string;
    auth: {
        ensureActivated(): Promise<void>;
    };
    fixturesSnapshot(competitionId?: number, startEpochDay?: number): Promise<Fixture[]>;
    oddsSnapshot(fixtureId: number, asOf?: number): Promise<OddsPayload[]>;
    scoresSnapshot(fixtureId: number): Promise<ScoresSnapshot>;
    scoresUpdates(fixtureId: number): Promise<ScoreUpdate[]>;
    oddsUpdatesBucket(epochDay: number, hourOfDay: number, interval: number, fixtureId?: number): Promise<OddsPayload[]>;
    scoresUpdatesBucket(epochDay: number, hourOfDay: number, interval: number): Promise<ScoreUpdate[]>;
    scoresHistorical(fixtureId: number): Promise<ScoreUpdate[]>;
    statValidation(p: StatValidationParams): Promise<ProofBundle>;
    scoresStream(o?: StreamOptions): AsyncGenerator<SseMessage<ScoreUpdate>>;
    oddsStream(o?: StreamOptions): AsyncGenerator<SseMessage<OddsPayload>>;
    health(): StreamHealth;
}
export declare function createTxlineClient(opts: TxlineClientOptions): TxlineClient;
//# sourceMappingURL=client.d.ts.map