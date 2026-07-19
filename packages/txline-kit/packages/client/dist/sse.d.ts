/** SSE client: fetch-based parser + auto-reconnect with Last-Event-ID resume.
 *  Spec (vendor/docs.yaml): data messages carry id "timestamp:index" and a JSON
 *  record; heartbeats have event=heartbeat. Silent streams outside live windows
 *  are NORMAL — reconnect quietly, never treat as an error. */
export interface SseMessage<T = unknown> {
    id?: string;
    event?: string;
    data: T;
    raw: string;
}
/** Incremental SSE frame parser (pure, unit-testable). */
export declare class SseParser {
    private buffer;
    push(chunk: string): SseMessage[];
}
export interface SseStreamOptions {
    url: string;
    headers: () => Promise<Record<string, string>>;
    /** Called on 401/403 before retrying (e.g. JWT renewal). Throw to abort. */
    onAuthReject: (status: number) => Promise<void>;
    onEventAt?: (ts: number) => void;
    onReconnect?: () => void;
    signal?: AbortSignal;
}
/** Async iterator over data messages; heartbeats update health, aren't yielded.
 *  Cancels the underlying connection when the consumer breaks/returns early. */
export declare function sseStream<T = unknown>(opts: SseStreamOptions): AsyncGenerator<SseMessage<T>>;
//# sourceMappingURL=sse.d.ts.map