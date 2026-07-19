export type NetworkName = "devnet" | "mainnet" | "replay";
export interface NetworkConfig {
    name: NetworkName;
    apiBase: string;
    authUrl: string;
    programId: string;
    tokenMint: string;
    defaultRpcUrl: string;
    /** Free World Cup service level for this network. */
    freeServiceLevel: number;
}
/** Values verified in docs/VERIFIED.md — do not edit without re-verifying. */
export declare const NETWORKS: Record<"devnet" | "mainnet", NetworkConfig>;
/**
 * Probable World Cup 2026 competition id (observed in TxODDS's own examples:
 * /fixtures/snapshot?competitionId=72). Confirm post-activation; see VERIFIED.md (e).
 */
export declare const WORLD_CUP_COMPETITION_ID = 72;
//# sourceMappingURL=networks.d.ts.map