import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueue, enqueue, flush, pending, pendingCount } from "./offlineQueue.js";

describe("offline queue replay", () => {
  beforeEach(async () => {
    await clearQueue();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await clearQueue();
  });

  it("shares one replay when two flushes start at the same time", async () => {
    await enqueue({ kind: "expense", method: "POST", url: "/api/v1/expenses" });

    let releaseSend;
    const sendGate = new Promise((resolve) => {
      releaseSend = resolve;
    });
    const send = vi.fn(() => sendGate);

    const first = flush(send);
    const second = flush(send);

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    releaseSend();

    await expect(first).resolves.toEqual({ sent: 1, dropped: 0 });
    await expect(second).resolves.toEqual({ sent: 1, dropped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(pending()).resolves.toEqual([]);
  });

  it("drops stale GPS pings but still replays durable driver records", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const queuedAt = new Date("2026-09-14T00:00:00.000Z");
    vi.setSystemTime(queuedAt);

    await enqueue({ kind: "ping", body: { latitude: 7.1, longitude: 125.6 } });
    await enqueue({ kind: "expense", body: { amount: 850 } });

    vi.setSystemTime(new Date(queuedAt.getTime() + 15 * 60 * 1000 + 1));
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(flush(send)).resolves.toEqual({ sent: 1, dropped: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ kind: "expense" });
    await expect(pending()).resolves.toEqual([]);
  });

  it("bounds a long offline GPS backlog without discarding durable work", async () => {
    await enqueue({ kind: "expense", body: { amount: 850 } });
    for (let i = 0; i < 25; i += 1) {
      await enqueue({ kind: "ping", body: { latitude: 7.1, longitude: 125.6 + i } });
    }

    // A driver can spend hours outside coverage. Only recent positions are
    // useful on reconnect; receipts and deliveries must remain untouched.
    await expect(pendingCount()).resolves.toEqual({ total: 21, pings: 20, records: 1 });
    const rows = await pending();
    expect(rows.filter((row) => row.kind === "ping").map((row) => row.body.longitude))
      .toEqual(Array.from({ length: 20 }, (_, i) => 125.6 + i + 5));
  });
});
