/** SSE client: fetch-based parser + auto-reconnect with Last-Event-ID resume.
 *  Spec (vendor/docs.yaml): data messages carry id "timestamp:index" and a JSON
 *  record; heartbeats have event=heartbeat. Silent streams outside live windows
 *  are NORMAL — reconnect quietly, never treat as an error. */
/** Incremental SSE frame parser (pure, unit-testable). */
export class SseParser {
    buffer = "";
    push(chunk) {
        this.buffer += chunk;
        const out = [];
        // Frames are delimited by a blank line (\n\n or \r\n\r\n).
        for (;;) {
            const match = this.buffer.match(/\r?\n\r?\n/);
            if (!match || match.index === undefined)
                break;
            const frame = this.buffer.slice(0, match.index);
            this.buffer = this.buffer.slice(match.index + match[0].length);
            const msg = parseFrame(frame);
            if (msg)
                out.push(msg);
        }
        return out;
    }
}
function parseFrame(frame) {
    let id;
    let event;
    const dataLines = [];
    for (const line of frame.split(/\r?\n/)) {
        if (!line || line.startsWith(":"))
            continue; // comment/keepalive
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" "))
            value = value.slice(1);
        if (field === "id")
            id = value;
        else if (field === "event")
            event = value;
        else if (field === "data")
            dataLines.push(value);
        // "retry" ignored — we manage backoff ourselves.
    }
    if (id === undefined && event === undefined && dataLines.length === 0)
        return null;
    const raw = dataLines.join("\n");
    let data = raw;
    if (raw) {
        try {
            data = JSON.parse(raw);
        }
        catch {
            /* leave as string */
        }
    }
    return { id, event, data, raw };
}
/** Async iterator over data messages; heartbeats update health, aren't yielded.
 *  Cancels the underlying connection when the consumer breaks/returns early. */
export async function* sseStream(opts) {
    let lastEventId;
    let attempt = 0;
    let currentReader = null;
    try {
        yield* run();
    }
    finally {
        // Consumer broke out of the loop (or aborted): release the HTTP connection.
        // (cast: TS can't see the assignment happening inside the run() closure)
        const reader = currentReader;
        await reader?.cancel().catch(() => { });
    }
    async function* run() {
        for (;;) {
            if (opts.signal?.aborted)
                return;
            try {
                const headers = {
                    ...(await opts.headers()),
                    Accept: "text/event-stream",
                    "Cache-Control": "no-cache",
                };
                if (lastEventId)
                    headers["Last-Event-ID"] = lastEventId;
                const res = await fetch(opts.url, { headers, signal: opts.signal });
                if (res.status === 401 || res.status === 403) {
                    await opts.onAuthReject(res.status);
                    attempt++;
                    await backoff(attempt, opts.signal);
                    continue;
                }
                if (!res.ok || !res.body) {
                    attempt++;
                    await backoff(attempt, opts.signal);
                    continue;
                }
                attempt = 0;
                const parser = new SseParser();
                const decoder = new TextDecoder();
                const reader = res.body.getReader();
                currentReader = reader;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    for (const msg of parser.push(decoder.decode(value, { stream: true }))) {
                        opts.onEventAt?.(Date.now());
                        if (msg.event === "heartbeat")
                            continue;
                        if (msg.id)
                            lastEventId = msg.id;
                        yield msg;
                    }
                }
                currentReader = null;
                // Server closed the stream: reconnect (resume via Last-Event-ID).
                opts.onReconnect?.();
                attempt++;
                await backoff(attempt, opts.signal);
            }
            catch (err) {
                currentReader = null;
                if (opts.signal?.aborted)
                    return;
                opts.onReconnect?.();
                attempt++;
                await backoff(attempt, opts.signal);
            }
        }
    }
}
async function backoff(attempt, signal) {
    const base = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    const delay = base / 2 + Math.random() * (base / 2); // jitter
    await new Promise((resolve) => {
        const t = setTimeout(resolve, delay);
        signal?.addEventListener("abort", () => {
            clearTimeout(t);
            resolve();
        }, { once: true });
    });
}
//# sourceMappingURL=sse.js.map