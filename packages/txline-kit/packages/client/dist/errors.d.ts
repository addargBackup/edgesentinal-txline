export declare class TxlineHttpError extends Error {
    readonly status: number;
    readonly url: string;
    readonly body: string;
    constructor(status: number, url: string, body: string);
}
/**
 * 403 from TxLINE means invalid API token or insufficient permissions — most
 * often devnet credentials against the mainnet host or vice versa. Never retried.
 */
export declare class TxlineNetworkMismatchError extends TxlineHttpError {
    constructor(url: string, body: string);
}
export declare class TxlineAuthError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=errors.d.ts.map