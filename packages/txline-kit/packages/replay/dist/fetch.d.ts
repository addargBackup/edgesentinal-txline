import { type NetworkName } from "@txline-kit/client";
export interface FetchOptions {
    fixtureId: number;
    network?: Exclude<NetworkName, "replay">;
    corpusDir: string;
    walletPath?: string;
}
export declare function fetchFixture(opts: FetchOptions): Promise<{
    scores: number;
    odds: number;
}>;
//# sourceMappingURL=fetch.d.ts.map