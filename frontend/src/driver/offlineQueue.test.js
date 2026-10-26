import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearQueue, dismissRefused, enqueue, enqueueTrailPoint, flush, pending, pendingCount, refusedWork,
  MAX_TRAIL_PER_TRIP, TRAIL_BATCH, TRAIL_TTL_MS,
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
    await expect(pendingCount(OWNER)).resolves.toEqual({ total: 21, pings: 20, trail: 0, records: 1 });
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
    await expect(pendingCount(7)).resolves.toEqual({ total: 1, pings: 0, trail: 0, records: 1 });
    await expect(pendingCount(8)).resolves.toEqual({ total: 0, pings: 0, trail: 0, records: 0 });
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

  it("takes a replay the server answers as already done as sent, not refused", async () => {
    // the start went through the first time, but its answer was lost on a weak signal
    await enqueue({ ownerId: OWNER, kind: "start", path: "/trips/41/start", json: {} });
    const send = vi.fn().mockResolvedValue({ success: true, data: { status: "in_transit", alreadyDone: true } });

    await expect(flush(send, OWNER)).resolves.toEqual({ sent: 1, dropped: 0 });
    await expect(pending(OWNER)).resolves.toEqual([]);
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
    await expect(pendingCount(OWNER)).resolves.toEqual({ total: 2, pings: 0, trail: 0, records: 2 });
    expect(refusedWork(OWNER)).toEqual([]);
  });
});

describe("the trail kept through a dead zone", () => {
  const OWNER = 7;
  const T0 = new Date("2026-10-26T06:00:00.000Z").getTime();
  const MIN = 60 * 1000;
  const reading = (n, at) => ({ clientRef: `fix-0000000000-${n}`, capturedAt: at, lat: 7 + n / 1000, lng: 125.6 });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    await clearQueue(OWNER);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await clearQueue(OWNER);
  });

  it("keeps one point a minute for each trip", async () => {
    expect(await enqueueTrailPoint(OWNER, 41, reading(1, T0))).toBe(true);
    expect(await enqueueTrailPoint(OWNER, 41, reading(2, T0 + 30 * 1000))).toBe(false);
    expect(await enqueueTrailPoint(OWNER, 41, reading(3, T0 + MIN))).toBe(true);
    // another trip keeps its own minute
    expect(await enqueueTrailPoint(OWNER, 42, reading(4, T0 + 10 * 1000))).toBe(true);
    await expect(pendingCount(OWNER)).resolves.toEqual({ total: 3, pings: 0, trail: 3, records: 0 });
  });

  it("keeps the minute after the app restarts, from what is stored", async () => {
    await enqueueTrailPoint(OWNER, 41, reading(1, T0));
    // a restart loses what is in memory, not the store: load the module afresh
    vi.resetModules();
    const restarted = await import("./offlineQueue.js");
    await expect(restarted.pending(OWNER)).resolves.toHaveLength(1);
    expect(await restarted.enqueueTrailPoint(OWNER, 41, reading(2, T0 + 20 * 1000))).toBe(false);
    expect(await restarted.enqueueTrailPoint(OWNER, 41, reading(3, T0 + MIN))).toBe(true);
    await restarted.clearQueue(OWNER);
  });

  it("takes nothing without a name, a time, a driver or a trip", async () => {
    expect(await enqueueTrailPoint(OWNER, 41, { capturedAt: T0, lat: 1, lng: 1 })).toBe(false);
    expect(await enqueueTrailPoint(OWNER, 41, { clientRef: "fix-0000000000-1", lat: 1, lng: 1 })).toBe(false);
    expect(await enqueueTrailPoint(null, 41, reading(1, T0))).toBe(false);
    expect(await enqueueTrailPoint(OWNER, "x", reading(1, T0))).toBe(false);
    await expect(pending(OWNER)).resolves.toEqual([]);
  });

  it("stops at its cap rather than filling the phone", async () => {
    for (let i = 0; i < MAX_TRAIL_PER_TRIP; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await enqueue({ ownerId: OWNER, kind: "trail", tripId: 41, path: "/trips/41/trail", json: { point: reading(i, T0 - (MAX_TRAIL_PER_TRIP - i) * MIN) } });
    }
    expect(await enqueueTrailPoint(OWNER, 41, reading(9999, T0 + MIN))).toBe(false);
  }, 30000);

  it("sends a trip's points in order, in batches, and drops each batch once answered", async () => {
    const total = TRAIL_BATCH + 50;
    for (let i = 0; i < total; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await enqueue({ ownerId: OWNER, kind: "trail", tripId: 41, path: "/trips/41/trail", json: { point: reading(i, T0 - (total - i) * MIN) } });
    }
    await enqueue({ ownerId: OWNER, kind: "deliver", path: "/trips/41/deliver", json: {} });
    const send = vi.fn().mockResolvedValue({ success: true });

    await expect(flush(send, OWNER)).resolves.toEqual({ sent: total + 1, dropped: 0 });
    const trailCalls = send.mock.calls.filter(([row]) => row.kind === "trail");
    expect(trailCalls).toHaveLength(2);
    expect(trailCalls[0][0].path).toBe("/trips/41/trail");
    expect(trailCalls[0][0].json.points).toHaveLength(TRAIL_BATCH);
    expect(trailCalls[1][0].json.points).toHaveLength(50);
    expect(trailCalls[0][0].json.points[0].clientRef).toBe("fix-0000000000-0");
    // the delivery still goes, after the points saved before it
    expect(send.mock.calls.at(-1)[0].kind).toBe("deliver");
    await expect(pending(OWNER)).resolves.toEqual([]);
  });

  it("keeps each trip's trail apart", async () => {
    await enqueueTrailPoint(OWNER, 41, reading(1, T0));
    await enqueueTrailPoint(OWNER, 42, reading(2, T0));
    const send = vi.fn().mockResolvedValue({ success: true });
    await flush(send, OWNER);
    expect(send.mock.calls.map(([row]) => row.path)).toEqual(["/trips/41/trail", "/trips/42/trail"]);
  });

  it("lets a day-old point go without sending it or calling it refused", async () => {
    await enqueueTrailPoint(OWNER, 41, reading(1, T0));
    vi.setSystemTime(T0 + TRAIL_TTL_MS + 1);
    const send = vi.fn().mockResolvedValue({ success: true });
    await expect(flush(send, OWNER)).resolves.toEqual({ sent: 0, dropped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(refusedWork(OWNER)).toEqual([]);
  });

  it("keeps the trail while there is no signal or the server is down", async () => {
    await enqueueTrailPoint(OWNER, 41, reading(1, T0));
    for (const err of [new TypeError("Failed to fetch"), Object.assign(new Error("not yet"), { status: 503 })]) {
      const send = vi.fn().mockRejectedValue(err);
      // eslint-disable-next-line no-await-in-loop
      await expect(flush(send, OWNER)).resolves.toEqual({ sent: 0, dropped: 0 });
    }
    await expect(pendingCount(OWNER)).resolves.toMatchObject({ trail: 1 });
  });

  it("drops a trail the server will never take, without showing it as refused work", async () => {
    await enqueueTrailPoint(OWNER, 41, reading(1, T0));
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("Trip not found."), { status: 404 }));
    await expect(flush(send, OWNER)).resolves.toEqual({ sent: 0, dropped: 1 });
    await expect(pending(OWNER)).resolves.toEqual([]);
    expect(refusedWork(OWNER)).toEqual([]);
  });
});
