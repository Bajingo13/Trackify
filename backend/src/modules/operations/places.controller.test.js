import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { listPlaces, savePlace, markUsed, deletePlace } from "./places.controller.js";

/**
 * The company's own pinned places.
 *
 * This exists because OpenStreetMap does not contain most Philippine
 * subdivisions and never will, so the only way to reach an exact gate twice is
 * to remember where somebody put the pin the first time.
 *
 * What these guard: that one company cannot see or edit another company's
 * places, and that a place saved twice corrects the pin rather than breeding a
 * second copy under the same name — which would leave a dispatcher choosing
 * between two identical-looking entries with different coordinates.
 */

async function withDb(handler, fn) {
  const real = db.execute;
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    return handler(String(sql), params);
  };
  try {
    return await fn(calls);
  } finally {
    db.execute = real;
  }
}

function recorder() {
  const out = { statusCode: 200 };
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
    end() { out.ended = true; return this; },
  };
  return out;
}

const req = (extra = {}) => ({
  context: { companyId: 1, branchId: 1, userId: 9 },
  user: { userId: 9, email: "staff@example.com" },
  headers: {},
  socket: {},
  params: {},
  query: {},
  body: {},
  ...extra,
});

const row = (over = {}) => ({
  place_id: 3,
  label: "Villa Esperanza Phase 2",
  address: "0394 Villa Esperanza Phase 2, Balayan, Batangas",
  house_no: "0394",
  street: null,
  barangay: null,
  city: "Balayan",
  province: "Batangas",
  postcode: null,
  latitude: "13.9381793",
  longitude: "120.7294945",
  kind: "customer",
  note: null,
  times_used: 4,
  last_used_at: null,
  ...over,
});

const writes = (rows) => (sql) => (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql) ? [{ insertId: 11 }] : rows);

/* ---- reading ---- */

test("an empty search returns the places this company actually uses", async () => {
  // A dispatcher opening the box with nothing typed wants the ten addresses
  // they work with all week, not an empty list.
  await withDb(
    () => [[row()]],
    async (calls) => {
      const out = recorder();
      await listPlaces(req(), out.res);

      assert.equal(out.body.data.length, 1);
      assert.match(calls[0].sql, /ORDER BY times_used DESC/);
      assert.deepEqual(calls[0].params, [1]);
    }
  );
});

test("a search is scoped to the company, and prefers a name that starts with it", async () => {
  await withDb(
    () => [[row()]],
    async (calls) => {
      await listPlaces(req({ query: { q: "villa" } }), recorder().res);

      assert.match(calls[0].sql, /company_id = \?/);
      // The first parameter after the company is the contains-match; the last
      // is the starts-with used only for ordering.
      assert.equal(calls[0].params[0], 1);
      assert.equal(calls[0].params[1], "%villa%");
      assert.equal(calls[0].params.at(-1), "villa%");
    }
  );
});

test("a saved place is shaped like a geocoder result, so the picker treats both alike", async () => {
  await withDb(
    () => [[row()]],
    async () => {
      const out = recorder();
      await listPlaces(req(), out.res);

      const place = out.body.data[0];
      assert.equal(place.lat, 13.9381793);
      assert.equal(place.lng, 120.7294945);
      assert.equal(place.precision, "house", "a pin somebody placed is exact by definition");
      assert.equal(place.saved, true);
      assert.equal(place.address_parts.city, "Balayan");
    }
  );
});

/* ---- saving ---- */

test("saving the same name again corrects the pin instead of duplicating it", async () => {
  // Re-saving means the old pin was wrong, not that there are now two.
  await withDb(writes([[]]), async (calls) => {
    const out = recorder();
    await savePlace(
      req({ body: { label: "Villa Esperanza Phase 2", lat: 13.93, lng: 120.72 } }),
      out.res
    );

    const insert = calls.find((c) => c.sql.includes("INSERT INTO saved_places"));
    assert.match(insert.sql, /ON DUPLICATE KEY UPDATE/);
    assert.match(insert.sql, /latitude = VALUES\(latitude\)/);
    assert.equal(out.statusCode, 201);
  });
});

test("a place with no name is refused, because nobody could find it again", async () => {
  await withDb(writes([[]]), async (calls) => {
    const out = recorder();
    await savePlace(req({ body: { lat: 13.93, lng: 120.72 } }), out.res);

    assert.equal(out.statusCode, 400);
    assert.equal(calls.length, 0, "the database was touched for a place that was never valid");
  });
});

test("a place with no point is refused, because the point is the whole value", async () => {
  await withDb(writes([[]]), async () => {
    const out = recorder();
    await savePlace(req({ body: { label: "Somewhere" } }), out.res);
    assert.equal(out.statusCode, 400);
    assert.match(out.body.message, /point on the map/);
  });
});

test("coordinates off the globe are refused", async () => {
  // A transposed latitude and longitude puts a Philippine address in the
  // Southern Ocean, and a pin nobody checks is worse than no pin.
  await withDb(writes([[]]), async () => {
    const out = recorder();
    await savePlace(req({ body: { label: "Wrong", lat: 120.72, lng: 13.93 } }), out.res);
    assert.equal(out.statusCode, 400);
  });
});

test("an unrecognised kind becomes other rather than failing the write", async () => {
  await withDb(writes([[]]), async (calls) => {
    await savePlace(
      req({ body: { label: "Depot", lat: 13.9, lng: 120.7, kind: "nonsense" } }),
      recorder().res
    );
    const insert = calls.find((c) => c.sql.includes("INSERT INTO saved_places"));
    assert.equal(insert.params[11], "other");
  });
});

test("the address parts are kept, so a saved place can still be reported on by barangay", async () => {
  await withDb(writes([[]]), async (calls) => {
    await savePlace(
      req({
        body: {
          label: "Villa Esperanza Phase 2",
          lat: 13.93,
          lng: 120.72,
          address_parts: { houseNumber: "0394", barangay: "Poblacion", city: "Balayan", province: "Batangas" },
        },
      }),
      recorder().res
    );

    const insert = calls.find((c) => c.sql.includes("INSERT INTO saved_places"));
    assert.equal(insert.params[3], "0394");
    assert.equal(insert.params[5], "Poblacion");
    assert.equal(insert.params[6], "Balayan");
  });
});

/* ---- using and removing ---- */

test("marking a place used is scoped to the company", async () => {
  await withDb(writes([[]]), async (calls) => {
    const out = recorder();
    await markUsed(req({ params: { id: "3" } }), out.res);

    assert.match(calls[0].sql, /times_used = times_used \+ 1/);
    assert.deepEqual(calls[0].params, [3, 1]);
    assert.equal(out.ended, true);
  });
});

test("another company's place cannot be deleted", async () => {
  await withDb(
    () => [[]],
    async (calls) => {
      const out = recorder();
      await deletePlace(req({ params: { id: "3" } }), out.res);

      assert.equal(out.statusCode, 404);
      assert.match(calls[0].sql, /company_id = \?/);
      assert.equal(calls.length, 1, "it went looking for more after finding nothing");
    }
  );
});
