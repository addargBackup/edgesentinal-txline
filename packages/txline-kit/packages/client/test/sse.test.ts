import { describe, expect, it } from "vitest";
import { SseParser } from "../src/sse.js";

describe("SseParser", () => {
  it("parses a complete data frame", () => {
    const p = new SseParser();
    const msgs = p.push('id: 1751234567890:0\ndata: {"fixtureId":123,"seq":5}\n\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("1751234567890:0");
    expect(msgs[0].data).toEqual({ fixtureId: 123, seq: 5 });
  });

  it("handles frames split across chunks", () => {
    const p = new SseParser();
    expect(p.push('data: {"a":')).toHaveLength(0);
    const msgs = p.push("1}\n\ndata: ");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].data).toEqual({ a: 1 });
    expect(p.push("2\n\n")[0].data).toBe(2);
  });

  it("parses heartbeat events", () => {
    const p = new SseParser();
    const msgs = p.push('event: heartbeat\ndata: {"Ts": 12345}\n\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].event).toBe("heartbeat");
    expect(msgs[0].data).toEqual({ Ts: 12345 });
  });

  it("handles CRLF delimiters and comments", () => {
    const p = new SseParser();
    const msgs = p.push(': keepalive\r\n\r\nid: 9:1\r\ndata: {"x":true}\r\n\r\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("9:1");
    expect(msgs[0].data).toEqual({ x: true });
  });

  it("joins multi-line data fields", () => {
    const p = new SseParser();
    const msgs = p.push("data: line1\ndata: line2\n\n");
    expect(msgs[0].data).toBe("line1\nline2");
  });
});
