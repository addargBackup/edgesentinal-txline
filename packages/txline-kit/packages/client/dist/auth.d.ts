import { Keypair } from "@solana/web3.js";
import type { NetworkConfig } from "./networks.js";
export interface AuthOptions {
    network: NetworkConfig;
    wallet?: Keypair;
    serviceLevel?: number;
    weeks?: number;
    leagues?: number[];
    rpcUrl?: string;
    credsDir?: string;
}
export declare class AuthManager {
    private readonly opts;
    jwt: string;
    apiToken: string;
    private renewing;
    private readonly credsFile;
    constructor(opts: AuthOptions);
    headers(): Record<string, string>;
    /** POST /auth/guest/start — single-flight so concurrent 401s renew once. */
    renewJwt(): Promise<string>;
    /** Idempotent: reuses a persisted API token, otherwise runs the full
     *  guest → subscribe(serviceLevel, weeks) → activate flow on-chain. */
    ensureActivated(): Promise<void>;
    /** Anchor `subscribe` per VERIFIED.md; returns the confirmed tx signature. */
    private subscribeOnChain;
    /** POST /api/token/activate with detached signature over "txSig:leagues:jwt". */
    private activate;
    private load;
    private persist;
}
//# sourceMappingURL=auth.d.ts.map