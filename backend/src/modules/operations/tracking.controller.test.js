import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import {
  activeTrips,
  GPS_ONLINE_TTL_MS,
  gpsStatusForRecordedAt,
} from "./tracking.controller.js";

test("GPS freshness expires a stored online flag after fifteen minutes", () => {
  const now = Date.now();
  assert.equal(gpsStatusForRecordedAt(new Date(now - 30_000), now), "online");
  assert.equal(
    gpsStatusForRecordedAt(new Date(now - GPS_ONLINE_TTL_MS - 1), now),
    "offline"
  );
  assert.equal(gpsStatusForRecordedAt(null, now), "offline");
  assert.equal(gpsStatusForRecordedAt(new Date(now + 5 * 60_000), now), "offline");
});

test("active trips never expose a days-old point as live", async () => {
  const execute = db.execute;
  try {
    db.execute = async () => [[
      {
        trip_ticket_id: 10,
        gps_status: "online",
        last_update: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
      {
        trip_ticket_id: 11,
        gps_status: "offline",
        last_update: new Date(Date.now() - 30_000),
      },
    ]];

    let body;
    await activeTrips(
      { context: { companyId: 1, branchId: 2 } },
      { json(value) { body = value; } }
    );

    assert.equal(body.data[0].gps_status, "offline");
    assert.equal(body.data[1].gps_status, "online");
  } finally {
    db.execute = execute;
  }
});
