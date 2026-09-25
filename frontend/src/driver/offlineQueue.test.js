import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearQueue, dismissRefused, enqueue, flush, pending, pendingCount, refusedWork,
} from "./offlineQueue.js";

describe("offline queue replay", () => {
  const OWNER = 7;
  beforeEach(async () => {
    await clearQueue(OWNER);
    await clearQueue(8);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await clearQueue(OWNER);
    await clearQueue(8);
  });

  it("shares one replay when two flushes start at the same time", async () => {
    await enqueue({ ownerId: OWNER, kind: "expense", method: "POST", url: "/api/v1/expenses" });

    let releaseSend;
    const sendGate = new Promise((resolve) => {
      releaseSend = resolve;
    });
    const send = vi.fn(() => sendGate);

    const first = flush(send, OWNER);
    const second = flush(send, OWNER);

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    releaseSend();

    await expect(first).resolves.toEqual({ sent: 1, dropped: 0 });
    await expect(second).resolves.toEqual({ sent: 1, dropped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(pending(OWNER)).resolves.toEqual([]);
  });

  it("drops stale GPS pings but still replays durable driver records", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const queuedAt = new Date("2026-09-14T00:00:00.000Z");
    vi.setSystemTime(queuedAt);

    await enqueue({ ownerId: OWNER, kind: "ping", body: { latitude: 7.1, longitude: 125.6 } });
    await enqueue({ ownerId: OWNER, kind: "expense", body: { amount: 850 } });

    vi.setSystemTime(new Date(queuedAt.getTime() + 15 * 60 * 1000 + 1));
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(flush(send, OWNER)).resolves.toEqual({ sent: 1, dropped: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ kind: "expense" });
    await expect(pending(OWNER)).resolves.toEqual([]);
  });

  it("bounds a long offline GPS backlog without discarding durable work", async () => {
    await enqueue({ ownerId: OWNER, kind: "expense", body: { amount: 850 } });
    for (let i = 0; i < 25; i += 1) {
      await enqueue({ ownerId: OWNER, kind: "ping", body: { latitude: 7.1, longitude: 125.6 + i } });
    }

    // A driver can spend hours outside coverage. Only recent positions are
    // useful on reconnect; receipts and deliveries must remain untouched.
    await expect(pendingCount(OWNER)).resolves.toEqual({ total: 21, pings: 20, records: 1 });
    const rows = await pending(OWNER);
    expect(rows.filter((row) => row.kind === "ping").map((row) => row.body.longitude))
      .toEqual(Array.from({ length: 20 }, (_, i) => 125.6 + i + 5));
  });

  it("never replays one driver's saved work under another driver's session", async () => {
    await enqueue({ ownerId: 7, kind: "expense", body: { amount: 850 } });
    await enqueue({ ownerId: 8, kind: "delivery", body: { receivedBy: "Customer" } });
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(flush(send, 8)).resolves.toEqual({ sent: 1, dropped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ ownerId: 8, kind: "delivery" });
    await expect(pendingCount(7)).resolves.toEqual({ total: 1, pings: 0, records: 1 });
    await expect(pendingCount(8)).resolves.toEqual({ total: 0, pings: 0, records: 0 });
  });

  it("refuses to save unowned work that could be sent by the next driver", async () => {
    await expect(enqueue({ kind: "expense", body: { amount: 850 } })).resolves.toBe(false);
    await expect(pending()).resolves.toEqual([]);
  });

  it("records a refused record with the server's reason so the driver can be told", async () => {
    await enqueue({ ownerId: OWNER, kind: "expense", body: { amount: 850 } });
    await enqueue({ ownerId: OWNER, kind: "deliver", body: { receivedBy: "Customer" } });
    const refusal = Object.assign(new Error("This trip is already closed."), { status: 409 });
    const send = vi.fn().mockRejectedValueOnce(refusal).mockResolvedValueOnce(undefined);

    // The refusal must not block the delivery behind it.
    await expect(flush(send, OWNER)).resolves.toEqual({ sent: 1, dropped: 1 });
    expect(refusedWork(OWNER)).toEqual([
      expect.objectContaining({ kind: "expense", reason: "This trip is already closed." }),
    ]);
    expect(refusedWork(8)).toEqual([]);

    dismissRefused(OWNER);
    expect(refusedWork(OWNER)).toEqual([]);
  });

  it("does not report stale GPS pings as refused work", async () => {
    await enqueue({ ownerId: OWNER, kind: "ping", body: { latitude: 7.1, longitude: 125.6 } });
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("Trip not in transit"), { status: 409 }));
    await flush(send, OWNER);
    expect(refusedWork(OWNER)).toEqual([]);
  });

  it.each([401, 408, 429])("keeps everything when the server answers %i, which means try later", async (status) => {
    // 401: the session ran out during a long dead zone. The driver signs in
    // again and the same work sends; dropping it would lose a filed delivery.
    await enqueue({ ownerId: OWNER, kind: "deliver", body: { receivedBy: "Customer" } });
    await enqueue({ ownerId: OWNER, kind: "expense", body: { amount: 850 } });
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("later"), { status }));

    await expect(flush(send, OWNER)).resolves.toEqual({ sent: 0, dropped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(pendingCount(OWNER)).resolves.toEqual({ total: 2, pings: 0, records: 2 });
    expect(refusedWork(OWNER)).toEqual([]);
  });
});
