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
export interface ServeOptions {
    fixtureId: number;
    corpusDir: string;
    speed?: number;
    port?: number;
}
export declare function startReplayServer(opts: ServeOptions): http.Server;
//# sourceMappingURL=serve.d.ts.map