/**
 * Places this company has pinned for itself.
 *
 * The geocoder answers questions about places the world has mapped. This
 * answers questions about the places this company actually goes — the
 * subdivision OpenStreetMap has never heard of, the depot gate that is fifty
 * metres from where the road is drawn, the customer whose address is three
 * landmarks and a sari-sari store.
 *
 * Searched before the geocoder, because a place somebody here already stood in
 * front of beats anything a public database can guess.
 */
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";

const STR = (v, max) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

const NUM = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const KINDS = ["depot", "customer", "stop", "other"];

const shape = (r) => ({
  id: r.place_id,
  label: r.label,
  address: r.address,
  lat: Number(r.latitude),
  lng: Number(r.longitude),
  kind: r.kind,
  note: r.note,
  timesUsed: Number(r.times_used),
  lastUsedAt: r.last_used_at,
  // Shaped like a geocoder result so the picker can treat both alike.
  precision: "house",
  saved: true,
  address_parts: {
    houseNumber: r.house_no,
    street: r.street,
    barangay: r.barangay,
    city: r.city,
    province: r.province,
    postcode: r.postcode,
  },
});

/**
 * GET /operations/places?q=
 *
 * With nothing typed this is the company's most-used places, which is a useful
 * screen in itself — the ten addresses a dispatcher works with all week.
 */
export async function listPlaces(req, res) {
  const { companyId } = req.context;
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 50);

  if (!q) {
    const [rows] = await db.execute(
      `SELECT * FROM saved_places
        WHERE company_id = ?
        ORDER BY times_used DESC, last_used_at IS NULL, last_used_at DESC, label ASC
        LIMIT ${limit}`,
      [companyId]
    );
    return res.json({ success: true, data: rows.map(shape) });
  }

  const starts = `${q}%`;
  const has = `%${q}%`;

  const [rows] = await db.execute(
    `SELECT * FROM saved_places
      WHERE company_id = ?
        AND (label LIKE ? OR address LIKE ? OR barangay LIKE ? OR city LIKE ?)
      ORDER BY (label LIKE ?) DESC, times_used DESC, label ASC
      LIMIT ${limit}`,
    [companyId, has, has, has, has, starts]
  );

  res.json({ success: true, data: rows.map(shape) });
}

/**
 * POST /operations/places
 *
 * Saving a label that already exists corrects its pin rather than adding a
 * second entry — somebody re-saving a place is telling you the old pin was
 * wrong, not that there are now two of them.
 */
export async function savePlace(req, res) {
  const { companyId, userId } = req.context;
  const b = req.body || {};

  const label = STR(b.label, 160);
  const lat = NUM(b.lat);
  const lng = NUM(b.lng);

  if (!label) {
    return res.status(400).json({ success: false, message: "Give the place a name people here will recognise." });
  }
  if (lat == null || lng == null) {
    return res.status(400).json({ success: false, message: "A saved place needs a point on the map." });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ success: false, message: "That point is not on the map." });
  }

  const parts = b.address_parts || b.addressParts || {};
  const kind = KINDS.includes(b.kind) ? b.kind : "other";

  const [result] = await db.execute(
    `INSERT INTO saved_places
       (company_id, label, address, house_no, street, barangay, city, province, postcode,
        latitude, longitude, kind, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       address = VALUES(address), house_no = VALUES(house_no), street = VALUES(street),
       barangay = VALUES(barangay), city = VALUES(city), province = VALUES(province),
       postcode = VALUES(postcode), latitude = VALUES(latitude), longitude = VALUES(longitude),
       kind = VALUES(kind), note = VALUES(note)`,
    [
      companyId,
      label,
      STR(b.address, 400),
      STR(parts.houseNumber ?? parts.house_no, 40),
      STR(parts.street, 160),
      STR(parts.barangay, 120),
      STR(parts.city, 120),
      STR(parts.province, 120),
      STR(parts.postcode, 20),
      lat,
      lng,
      kind,
      STR(b.note, 255),
      userId || null,
    ]
  );

  await recordAudit(req, {
    module: "operations",
    action: "place.save",
    entityType: "saved_place",
    entityId: result.insertId || null,
    summary: `Saved the place "${label}"`,
  });

  res.status(201).json({ success: true, data: { id: result.insertId || null, label } });
}

/**
 * POST /operations/places/:id/used
 *
 * Fire and forget, so the list orders itself by what the company actually
 * uses. Not a failure worth reporting to somebody mid-way through booking a
 * trip, which is why a miss is a quiet 204.
 */
export async function markUsed(req, res) {
  const { companyId } = req.context;
  await db.execute(
    `UPDATE saved_places
        SET times_used = times_used + 1, last_used_at = NOW()
      WHERE place_id = ? AND company_id = ?`,
    [Number(req.params.id), companyId]
  );
  res.status(204).end();
}

export async function deletePlace(req, res) {
  const { companyId } = req.context;
  const placeId = Number(req.params.id);

  const [[place]] = await db.execute(
    `SELECT label FROM saved_places WHERE place_id = ? AND company_id = ? LIMIT 1`,
    [placeId, companyId]
  );
  if (!place) return res.status(404).json({ success: false, message: "That place is not saved." });

  await db.execute(`DELETE FROM saved_places WHERE place_id = ? AND company_id = ?`, [placeId, companyId]);

  await recordAudit(req, {
    module: "operations",
    action: "place.delete",
    entityType: "saved_place",
    entityId: placeId,
    summary: `Removed the saved place "${place.label}"`,
  });

  res.json({ success: true, message: "Removed." });
}
