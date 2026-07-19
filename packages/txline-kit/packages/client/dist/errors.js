export class TxlineHttpError extends Error {
    status;
    url;
    body;
    constructor(status, url, body) {
        super(`TxLINE HTTP ${status} for ${url}: ${body.slice(0, 300)}`);
        this.status = status;
        this.url = url;
        this.body = body;
        this.name = "TxlineHttpError";
    }
}
/**
 * 403 from TxLINE means invalid API token or insufficient permissions — most
 * often devnet credentials against the mainnet host or vice versa. Never retried.
 */
export class TxlineNetworkMismatchError extends TxlineHttpError {
    constructor(url, body) {
        super(403, url, body);
        this.name = "TxlineNetworkMismatchError";
        this.message =
            `TxLINE 403 for ${url}. Check that JWT, API token, program ID and host all ` +
                `come from the SAME network (devnet vs mainnet), and that your subscription ` +
                `covers this data. Body: ${body.slice(0, 300)}`;
    }
}
export class TxlineAuthError extends Error {
    constructor(message) {
        super(message);
        this.name = "TxlineAuthError";
    }
}
//# sourceMappingURL=errors.js.map