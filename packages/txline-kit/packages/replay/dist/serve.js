/** `txline-replay serve` — wire-compatible replay of a corpus fixture.
 *
 *  Serves the same SSE format as the real API (data messages with
 *  id "timestamp:index", periodic heartbeats) plus snapshot reconstruction, so a
 *  TxlineClient pointed at this server via { network: "replay", baseUrl } cannot
 *  tell the difference. Auth headers are accepted and ignored.
 *
 *  Endpoints:
 *    GET  /api/scores/stream[?fixtureId=]   GET /api/odds/stream[?fixtureId=]
 *    GET  /api/scores/snapshot/{id}         GET /api/odds/snapshot/{id}
 *    GET  /api/scores/updates/{id}
 *    POST /control  {"action": "pause"|"resume"|"seek"|"speed", "value"?}
 *    GET  /control  -> playback status
 */
import * as http from "node:http";
import * as path from "node:path";
import { corpusDirFor, readFrames } from "./corpus.js";
function createPlayback(startTs, endTs, speed) {
    let anchorWall = Date.now();
    let anchorVirtual = startTs;
    let currentSpeed = speed;
    let paused = false;
    const now = () => (paused ? anchorVirtual : anchorVirtual + (Date.now() - anchorWall) * currentSpeed);
    const rebase = () => {
        anchorVirtual = now();
        anchorWall = Date.now();
    };
    return {
        virtualAt: now,
        seek(toTs) {
            anchorVirtual = toTs;
            anchorWall = Date.now();
        },
        setSpeed(s) {
            rebase();
            currentSpeed = s;
        },
        pause() {
            rebase();
            paused = true;
        },
        resume() {
            anchorWall = Date.now();
            paused = false;
        },
        status: () => ({ position: now(), speed: currentSpeed, paused, start: startTs, end: endTs }),
    };
}
export function startReplayServer(opts) {
    const dir = corpusDirFor(opts.fixtureId, opts.corpusDir);
    const scores = readFrames(path.join(dir, "scores.jsonl"));
    const odds = readFrames(path.join(dir, "odds.jsonl"));
    if (scores.length === 0 && odds.length === 0) {
        throw new Error(`No corpus data for fixture ${opts.fixtureId} in ${dir}. Run: txline-replay fetch --fixture ${opts.fixtureId}`);
    }
    const allTs = [...scores, ...odds].map((f) => f.ts);
    const startTs = Math.min(...allTs);
    const endTs = Math.max(...allTs);
    const playback = createPlayback(startTs, endTs, opts.speed ?? 1);
    function sseHandler(frames, res, fixtureFilter) {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
        });
        const filtered = fixtureFilter
            ? frames.filter((f) => {
                const d = f.data;
                return d["fixtureId"] === fixtureFilter || d["FixtureId"] === fixtureFilter;
            })
            : frames;
        // Emit every frame whose ts <= virtual clock, then poll for more.
        let cursor = filtered.findIndex((f) => f.ts > playback.virtualAt());
        if (cursor === -1)
            cursor = filtered.length;
        let index = 0;
        const tick = setInterval(() => {
            const vnow = playback.virtualAt();
            while (cursor < filtered.length && filtered[cursor].ts <= vnow) {
                const f = filtered[cursor++];
                res.write(`id: ${f.ts}:${index++}\ndata: ${JSON.stringify(f.data)}\n\n`);
            }
        }, 50);
        const heartbeat = setInterval(() => {
            res.write(`event: heartbeat\ndata: {"Ts": ${Math.floor(playback.virtualAt())}}\n\n`);
        }, 15_000);
        res.on("close", () => {
            clearInterval(tick);
            clearInterval(heartbeat);
        });
    }
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (code, body) => {
            res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            res.end(JSON.stringify(body));
        };
        const fixtureParam = url.searchParams.get("fixtureId");
        const fixtureFilter = fixtureParam ? Number(fixtureParam) : undefined;
        if (url.pathname === "/api/scores/stream")
            return sseHandler(scores, res, fixtureFilter);
        if (url.pathname === "/api/odds/stream")
            return sseHandler(odds, res, fixtureFilter);
        const scoresSnapshot = url.pathname.match(/^\/api\/scores\/snapshot\/(\d+)$/);
        if (scoresSnapshot) {
            const vnow = playback.virtualAt();
            const past = scores.filter((f) => f.ts <= vnow);
            if (past.length === 0)
                return send(404, { error: "no updates yet at current replay position" });
            return send(200, past[past.length - 1].data);
        }
        const scoresUpdates = url.pathname.match(/^\/api\/scores\/updates\/(\d+)$/);
        if (scoresUpdates) {
            const vnow = playback.virtualAt();
            return send(200, scores.filter((f) => f.ts <= vnow).map((f) => f.data));
        }
        const oddsSnapshot = url.pathname.match(/^\/api\/odds\/snapshot\/(\d+)$/);
        if (oddsSnapshot) {
            const vnow = playback.virtualAt();
            // Latest record per market identity, as a live snapshot would return.
            const latest = new Map();
            for (const f of odds) {
                if (f.ts > vnow)
                    break;
                const d = f.data;
                const key = `${d["SuperOddsType"]}|${d["MarketPeriod"] ?? ""}|${d["MarketParameters"] ?? ""}`;
                latest.set(key, f);
            }
            return send(200, [...latest.values()].map((f) => f.data));
        }
        if (url.pathname === "/control" && req.method === "POST") {
            let body = "";
            req.on("data", (c) => (body += c));
            req.on("end", () => {
                try {
                    const { action, value } = JSON.parse(body || "{}");
                    if (action === "pause")
                        playback.pause();
                    else if (action === "resume")
                        playback.resume();
                    else if (action === "seek" && typeof value === "number")
                        playback.seek(value);
                    else if (action === "speed" && typeof value === "number")
                        playback.setSpeed(value);
                    else
                        return send(400, { error: `unknown action ${action}` });
                    send(200, playback.status());
                }
                catch (e) {
                    send(400, { error: String(e) });
                }
            });
            return;
        }
        if (url.pathname === "/control")
            return send(200, playback.status());
        if (url.pathname === "/healthz")
            return send(200, { ok: true, fixtureId: opts.fixtureId });
        send(404, { error: `no route ${url.pathname}` });
    });
    server.listen(opts.port ?? 8788);
    return server;
}
//# sourceMappingURL=serve.js.map