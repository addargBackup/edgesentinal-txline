import { AuthManager } from "./auth.js";
import { TxlineHttpError, TxlineNetworkMismatchError } from "./errors.js";
import { NETWORKS } from "./networks.js";
import { SseParser, sseStream } from "./sse.js";
/** Some endpoints (e.g. /scores/historical) return a body of SSE-formatted
 *  "data: {...}" frames instead of a JSON document (live-verified 2026-07-11).
 *  Detect and normalize: SSE bodies become an array of the data payloads. */
function parseJsonOrSseBody(text) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("data:") || trimmed.startsWith("id:") || trimmed.startsWith("event:")) {
        const parser = new SseParser();
        const frames = parser.push(text.endsWith("\n\n") ? text : text + "\n\n");
        return frames.filter((f) => f.event !== "heartbeat").map((f) => f.data);
    }
    return JSON.parse(text);
}
export function createTxlineClient(opts) {
    let cfg;
    let auth;
    if (opts.network === "replay") {
        if (!opts.baseUrl)
            throw new Error('network "replay" requires baseUrl');
        cfg = {
            name: "replay",
            apiBase: opts.baseUrl.replace(/\/$/, ""),
            authUrl: "",
            programId: NETWORKS.devnet.programId,
            tokenMint: NETWORKS.devnet.tokenMint,
            defaultRpcUrl: NETWORKS.devnet.defaultRpcUrl,
            freeServiceLevel: 1,
        };
        auth = null; // replay servers accept and ignore auth headers
    }
    else {
        const base = NETWORKS[opts.network];
        cfg = opts.baseUrl ? { ...base, apiBase: opts.baseUrl.replace(/\/$/, "") } : base;
        auth = new AuthManager({
            network: cfg,
            wallet: opts.wallet,
            serviceLevel: opts.serviceLevel,
            weeks: opts.weeks,
            leagues: opts.leagues,
            rpcUrl: opts.rpcUrl,
            credsDir: opts.credsDir,
        });
    }
    const healthState = { scoresLastEventAt: null, oddsLastEventAt: null, reconnects: 0 };
    async function headers() {
        if (!auth)
            return {};
        if (!auth.jwt && !auth.apiToken)
            await auth.ensureActivated();
        return auth.headers();
    }
    async function fetchJson(pathname, query) {
        const url = new URL(cfg.apiBase + pathname);
        for (const [k, v] of Object.entries(query ?? {})) {
            if (v !== undefined)
                url.searchParams.set(k, String(v));
        }
        const doFetch = async () => fetch(url, { headers: await headers() });
        let res = await doFetch();
        if (res.status === 401 && auth) {
            // Expired guest JWT: renew from the same host, keep API token, retry once.
            await auth.renewJwt();
            res = await doFetch();
        }
        if (res.status === 403) {
            throw new TxlineNetworkMismatchError(url.toString(), await res.text());
        }
        if (!res.ok) {
            throw new TxlineHttpError(res.status, url.toString(), await res.text());
        }
        const text = await res.text();
        return parseJsonOrSseBody(text);
    }
    function makeStream(pathname, side, o) {
        const url = new URL(cfg.apiBase + pathname);
        if (o?.fixtureId !== undefined)
            url.searchParams.set("fixtureId", String(o.fixtureId));
        return sseStream({
            url: url.toString(),
            headers,
            onAuthReject: async (status) => {
                // 401/403 mid-stream: renew the guest JWT and let the loop retry.
                if (auth)
                    await auth.renewJwt();
                else if (status === 403)
                    throw new TxlineNetworkMismatchError(url.toString(), "stream rejected");
            },
            onEventAt: (ts) => {
                if (side === "scores")
                    healthState.scoresLastEventAt = ts;
                else
                    healthState.oddsLastEventAt = ts;
            },
            onReconnect: () => {
                healthState.reconnects += 1;
            },
            signal: o?.signal,
        });
    }
    return {
        network: opts.network,
        apiBase: cfg.apiBase,
        auth: {
            ensureActivated: async () => {
                if (auth)
                    await auth.ensureActivated();
            },
        },
        fixturesSnapshot: (competitionId, startEpochDay) => fetchJson("/fixtures/snapshot", { competitionId, startEpochDay }),
        oddsSnapshot: (fixtureId, asOf) => fetchJson(`/odds/snapshot/${fixtureId}`, { asOf }),
        scoresSnapshot: (fixtureId) => fetchJson(`/scores/snapshot/${fixtureId}`),
        scoresUpdates: (fixtureId) => fetchJson(`/scores/updates/${fixtureId}`),
        oddsUpdatesBucket: (epochDay, hourOfDay, interval, fixtureId) => fetchJson(`/odds/updates/${epochDay}/${hourOfDay}/${interval}`, { fixtureId }),
        scoresUpdatesBucket: (epochDay, hourOfDay, interval) => fetchJson(`/scores/updates/${epochDay}/${hourOfDay}/${interval}`),
        scoresHistorical: (fixtureId) => fetchJson(`/scores/historical/${fixtureId}`),
        statValidation: (p) => {
            if (!p.seq)
                throw new RangeError("statValidation: seq must come from a real score record (never 0)");
            return fetchJson("/scores/stat-validation", {
                fixtureId: p.fixtureId,
                seq: p.seq,
                statKey: p.statKey,
                statKey2: p.statKey2,
                statKeys: p.statKeys?.join(","),
            });
        },
        scoresStream: (o) => makeStream("/scores/stream", "scores", o),
        oddsStream: (o) => makeStream("/odds/stream", "odds", o),
        health: () => ({ ...healthState }),
    };
}
//# sourceMappingURL=client.js.map