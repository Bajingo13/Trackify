import "../../config/env.js";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { UPLOAD_ROOT } from "../finance/receipts.storage.js";
import {
  driverLicensePhoto,
  uploadDriverLicensePhoto,
  removeDriverLicensePhoto,
  listMaintenanceAttachments,
  uploadMaintenanceAttachment,
  serveMaintenanceAttachment,
  removeMaintenanceAttachment,
  uploadComplianceFile,
  removeComplianceFile,
} from "./fleetDocuments.controller.js";

/**
 * Licences, certificates and receipts attached to fleet records.
 *
 * What these guard is not the upload — multer does that — but the two things
 * that fail silently. First, company scoping: a licence is a photograph of a
 * person and a receipt is a financial record, so a row belonging to another
 * company must be invisible rather than merely unlisted. Second, the order of
 * a replacement: the row has to point at the new file before the old one is
 * deleted, because a crash between the two should leave a stray file, not a
 * driver whose licence has vanished.
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
    type() { return this; },
    set() { return this; },
    setHeader() { return this; },
  };
  return out;
}

const req = (extra = {}) => ({
  context: { companyId: 1, branchId: 1, userId: 9 },
  user: { userId: 9, email: "staff@example.com" },
  headers: {},
  socket: {},
  params: {},
  body: {},
  query: {},
  ...extra,
});

/** A file as multer hands it over, living under the upload root. */
const upload = (name = "receipt.jpg") => ({
  path: path.join(UPLOAD_ROOT, "receipts", "2026", "09", name),
  originalname: name,
  mimetype: "image/jpeg",
  size: 12345,
});

/** Anything that is not a SELECT is a write; give it an insert id. */
const writes = (rows) => (sql) => (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql) ? [{ insertId: 1 }] : rows);

/* ---- company scoping ---- */

test("a driver belonging to another company has no licence photo to find", async () => {
  // The query returns nothing because the company_id in the WHERE clause did
  // not match — which must read as "no such driver", not "no photo yet".
  await withDb(
    () => [[]],
    async (calls) => {
      const out = recorder();
      await driverLicensePhoto(req({ params: { id: "77" } }), out.res);

      assert.equal(out.statusCode, 404);
      assert.match(out.body.message, /Driver not found/);
      assert.match(calls[0].sql, /company_id = \?/);
      assert.deepEqual(calls[0].params, [77, 1]);
    }
  );
});

test("a maintenance job from another company cannot have a receipt attached to it", async () => {
  await withDb(
    () => [[]],
    async () => {
      const out = recorder();
      await uploadMaintenanceAttachment(
        req({ params: { id: "5" }, file: upload() }),
        out.res
      );
      assert.equal(out.statusCode, 404);
      assert.match(out.body.message, /Maintenance record not found/);
    }
  );
});

test("an attachment from another company is not served", async () => {
  await withDb(
    () => [[]],
    async (calls) => {
      const out = recorder();
      await serveMaintenanceAttachment(req({ params: { attachmentId: "12" } }), out.res);

      assert.equal(out.statusCode, 404);
      assert.match(calls[0].sql, /company_id = \?/);
      assert.deepEqual(calls[0].params, [12, 1]);
    }
  );
});

test("listing a job's attachments is scoped to the company twice over", async () => {
  // Once to prove the job is ours, once on the attachments themselves. Either
  // alone would let a guessed id through.
  await withDb(
    (sql) => (sql.includes("vehicle_maintenance") ? [[{ maintenance_id: 5, plate_no: "ABC 1234" }]] : [[]]),
    async (calls) => {
      const out = recorder();
      await listMaintenanceAttachments(req({ params: { id: "5" } }), out.res);

      assert.equal(out.body.success, true);
      for (const call of calls) assert.match(call.sql, /company_id = \?/);
    }
  );
});

/* ---- not losing the file ---- */

test("a replacement licence is recorded before the old file is let go", async () => {
  await withDb(
    writes([[{ license_photo_path: "licenses/2026/08/old.jpg" }]]),
    async (calls) => {
      const out = recorder();
      await uploadDriverLicensePhoto(req({ params: { id: "4" }, file: upload("licence.jpg") }), out.res);

      // Read the existing path first, then point the row at the new file. The
      // old file is deleted only afterwards, off the back of what was read.
      assert.match(calls[0].sql, /^SELECT license_photo_path/);
      assert.match(calls[1].sql, /^UPDATE drivers SET license_photo_path = \?/);
      assert.equal(out.body.success, true);
    }
  );
});

test("an upload whose row write fails does not report success", async () => {
  // The file is discarded and the error propagates. Reporting success on a row
  // that was never written would leave a licence nobody can find.
  await withDb(
    (sql) => {
      if (/^\s*UPDATE/i.test(sql)) throw new Error("write failed");
      return [[{ license_photo_path: null }]];
    },
    async () => {
      const out = recorder();
      await assert.rejects(
        () => uploadDriverLicensePhoto(req({ params: { id: "4" }, file: upload() }), out.res),
        /write failed/
      );
      assert.equal(out.body, undefined);
    }
  );
});

test("nothing attached is refused before anything is written", async () => {
  await withDb(
    () => [[]],
    async (calls) => {
      const out = recorder();
      await uploadDriverLicensePhoto(req({ params: { id: "4" } }), out.res);

      assert.equal(out.statusCode, 400);
      assert.equal(calls.length, 0, "the database was touched for a request carrying no file");
    }
  );
});

/* ---- the data itself ---- */

test("an unrecognised attachment kind becomes a receipt rather than a failed write", async () => {
  // kind is an enum in the schema. Passing a value through unchecked would
  // turn a typo into a 500 at the moment somebody is filing paperwork.
  await withDb(
    writes([[{ maintenance_id: 5, plate_no: "ABC 1234" }]]),
    async (calls) => {
      const out = recorder();
      await uploadMaintenanceAttachment(
        req({ params: { id: "5" }, body: { kind: "nonsense" }, file: upload() }),
        out.res
      );

      const insert = calls.find((c) => c.sql.includes("INSERT INTO maintenance_attachments"));
      assert.equal(insert.params[2], "receipt");
      assert.equal(out.statusCode, 201);
    }
  );
});

test("a note on an attachment is kept, and kept short", async () => {
  await withDb(
    writes([[{ maintenance_id: 5, plate_no: "ABC 1234" }]]),
    async (calls) => {
      await uploadMaintenanceAttachment(
        req({ params: { id: "5" }, body: { kind: "invoice", note: "x".repeat(400) }, file: upload() }),
        recorder().res
      );
      const insert = calls.find((c) => c.sql.includes("INSERT INTO maintenance_attachments"));
      assert.equal(insert.params[2], "invoice");
      assert.equal(insert.params[7].length, 255, "a note longer than the column would fail the insert");
    }
  );
});

test("removing an attachment deletes the row it was found by", async () => {
  await withDb(
    writes([[{ storage_path: "receipts/2026/09/x.jpg", maintenance_id: 5, kind: "receipt" }]]),
    async (calls) => {
      const out = recorder();
      await removeMaintenanceAttachment(req({ params: { attachmentId: "12" } }), out.res);

      const del = calls.find((c) => c.sql.startsWith("DELETE FROM maintenance_attachments"));
      assert.deepEqual(del.params, [12, 1]);
      assert.equal(out.body.success, true);
    }
  );
});

test("removing a compliance file clears every column describing it", async () => {
  // Leaving a name or a size behind would show a document that is not there.
  await withDb(
    writes([[{ document_id: 3, doc_type: "registration", file_path: "documents/2026/09/or.pdf" }]]),
    async (calls) => {
      const out = recorder();
      await removeComplianceFile(req({ params: { id: "3" } }), out.res);

      const update = calls.find((c) => c.sql.startsWith("UPDATE compliance_documents"));
      for (const column of ["file_path", "file_name", "file_mime", "file_size", "file_uploaded_at", "file_uploaded_by"]) {
        assert.match(update.sql, new RegExp(`${column} = NULL`));
      }
      assert.equal(out.body.success, true);
    }
  );
});

test("a compliance document that is not ours cannot be given a file", async () => {
  await withDb(
    () => [[]],
    async () => {
      const out = recorder();
      await uploadComplianceFile(req({ params: { id: "3" }, file: upload("or.pdf") }), out.res);
      assert.equal(out.statusCode, 404);
    }
  );
});

test("removing a licence photo that was never there still answers cleanly", async () => {
  // An office clearing a field nobody filled is not an error.
  await withDb(
    writes([[{ license_photo_path: null }]]),
    async () => {
      const out = recorder();
      await removeDriverLicensePhoto(req({ params: { id: "4" } }), out.res);
      assert.equal(out.body.success, true);
    }
  );
});
