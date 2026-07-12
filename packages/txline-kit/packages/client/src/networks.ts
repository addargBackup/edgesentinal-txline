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
export const NETWORKS: Record<"devnet" | "mainnet", NetworkConfig> = {
  devnet: {
    name: "devnet",
    apiBase: "https://txline-dev.txodds.com/api",
    authUrl: "https://txline-dev.txodds.com/auth/guest/start",
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    tokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
    defaultRpcUrl: "https://api.devnet.solana.com",
    freeServiceLevel: 1, // devnet free tier: World Cup & Int Friendlies, 0s delay
  },
  mainnet: {
    name: "mainnet",
    apiBase: "https://txline.txodds.com/api",
    authUrl: "https://txline.txodds.com/auth/guest/start",
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    tokenMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
    defaultRpcUrl: "https://api.mainnet-beta.solana.com",
    freeServiceLevel: 12, // mainnet free real-time World Cup tier (SL1 = 60s delay)
  },
};

/**
 * Probable World Cup 2026 competition id (observed in TxODDS's own examples:
 * /fixtures/snapshot?competitionId=72). Confirm post-activation; see VERIFIED.md (e).
 */
export const WORLD_CUP_COMPETITION_ID = 72;
