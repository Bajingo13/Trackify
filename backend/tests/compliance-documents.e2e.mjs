/**
 * End-to-end QA for Fleet Compliance's "Record Document" workflow.
 *
 * The suite deliberately creates a second, temporary tenant. That turns
 * company isolation into an observable behaviour instead of assuming a
 * single-company demo database is representative. Every row created here is
 * removed in `finally`, even when a request or assertion fails midway.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { operatingScope } from "./_context.mjs";

const API = process.env.TRACKIFY_API_URL || "http://localhost:5000";
const PASSWORD = process.env.TRACKIFY_TEST_PASSWORD || "demo123";
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const primaryDocType = `QA Compliance ${runId}`;
const tenantDocType = `QA Tenant ${runId}`;

let pass = 0;
let fail = 0;
let unmet = null;
const createdDocumentIds = new Set();
let tenantCompanyId = null;
let tenantBranchId = null;
let tenantVehicleId = null;

const check = (name, condition, extra = "") => {
  if (condition) {
    pass++;
    console.log(`ok    ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? ` ${extra}` : ""}`);
  }
};

const json = async (response) => response.json().catch(() => ({}));

async function login(email) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await json(response);
  if (!response.ok || !body.data?.token) {
    throw new Error(`seeded login unavailable for ${email} (HTTP ${response.status})`);
  }
  return body.data;
}

const headersFor = (session, scope) => ({
  Authorization: `Bearer ${session.token}`,
  "X-Company-Id": String(scope.company_id),
  "X-Branch-Id": String(scope.branch_id),
  "Content-Type": "application/json",
});

async function request(path, { session, scope, method = "GET", body } = {}) {
  return fetch(`${API}${path}`, {
    method,
    headers: headersFor(session, scope),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const isoDate = (daysFromToday) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
};

try {
  let manager;
  let deniedUser;
  let systemAdmin;
  try {
    [manager, deniedUser, systemAdmin] = await Promise.all([
      login(process.env.TRACKIFY_FLEET_MANAGER_EMAIL || "fleetmanager@gmail.com"),
      login(process.env.TRACKIFY_DENIED_EMAIL || "dispatcher@gmail.com"),
      login(process.env.TRACKIFY_SYSTEM_ADMIN_EMAIL || "superadmin@gmail.com"),
    ]);
  } catch (error) {
    unmet = error.message;
    throw error;
  }

  const managerScope = await operatingScope(manager.access, db);
  const deniedScope = await operatingScope(deniedUser.access, db);
  if (!managerScope.company_id || !managerScope.branch_id) {
    unmet = "fleet-manager demo user has no active company/branch scope";
    throw new Error(unmet);
  }

  const [[vehicle]] = await db.execute(
    `SELECT vehicle_id, plate_no
       FROM vehicles
      WHERE company_id = ? AND status <> 'inactive'
      ORDER BY vehicle_id
      LIMIT 1`,
    [managerScope.company_id],
  );
  if (!vehicle) {
    unmet = "fleet-manager company has no active vehicle fixture";
    throw new Error(unmet);
  }

  const missingRequired = await request("/api/v1/fleet/compliance/documents", {
    session: manager,
    scope: managerScope,
    method: "POST",
    body: {},
  });
  check(
    "document entity and type are required",
    missingRequired.status === 400,
    `status=${missingRequired.status}`,
  );

  const invalidEntity = await request("/api/v1/fleet/compliance/documents", {
    session: manager,
    scope: managerScope,
    method: "POST",
    body: {
      entityType: "vehicle",
      entityId: -1,
      docType: primaryDocType,
      expiryDate: isoDate(14),
    },
  });
  check(
    "an unknown vehicle is rejected",
    invalidEntity.status === 400,
    `status=${invalidEntity.status}`,
  );

  const denied = await request("/api/v1/fleet/compliance/documents", {
    session: deniedUser,
    scope: deniedScope,
    method: "POST",
    body: {
      entityType: "vehicle",
      entityId: vehicle.vehicle_id,
      docType: primaryDocType,
      expiryDate: isoDate(14),
    },
  });
  check(
    "a user without compliance.manage cannot record a document",
    denied.status === 403,
    `status=${denied.status}`,
  );

  const create = await request("/api/v1/fleet/compliance/documents", {
    session: manager,
    scope: managerScope,
    method: "POST",
    body: {
      entityType: "vehicle",
      entityId: vehicle.vehicle_id,
      docType: primaryDocType,
      docNumber: `QA-${runId}`,
      issueDate: isoDate(0),
      expiryDate: isoDate(14),
      reference: `qa://${runId}`,
      notes: "Temporary automated QA record",
    },
  });
  const createBody = await json(create);
  if (createBody.data?.documentId) createdDocumentIds.add(Number(createBody.data.documentId));
  check(
    "fleet manager records a vehicle compliance document",
    create.status === 201 && Number(createBody.data?.documentId) > 0,
    `status=${create.status}`,
  );

  const feed = await request("/api/v1/fleet/compliance?withinDays=365", {
    session: manager,
    scope: managerScope,
  });
  const feedBody = await json(feed);
  const primaryRow = (feedBody.data || []).find((row) => row.doc_type === primaryDocType);
  check("compliance feed returns the newly recorded document", feed.ok && Boolean(primaryRow));
  check(
    "feed preserves the selected vehicle and document number",
    Number(primaryRow?.entity_id) === Number(vehicle.vehicle_id) &&
      primaryRow?.entity_type === "vehicle" &&
      primaryRow?.doc_number === `QA-${runId}`,
    JSON.stringify(primaryRow || {}).slice(0, 180),
  );

  const [[auditRow]] = await db.execute(
    `SELECT audit_id, company_id, user_id, actor_email, action, entity_type, entity_id
       FROM audit_logs
      WHERE company_id = ? AND action = 'compliance.document.create'
        AND summary = ?
      ORDER BY audit_id DESC
      LIMIT 1`,
    [
      managerScope.company_id,
      `Recorded ${primaryDocType} for vehicle #${vehicle.vehicle_id}`,
    ],
  );
  check(
    "successful creation is attributed in the audit log",
    Boolean(auditRow) &&
      auditRow.actor_email ===
        (process.env.TRACKIFY_FLEET_MANAGER_EMAIL || "fleetmanager@gmail.com") &&
      auditRow.entity_type === "vehicle" &&
      Number(auditRow.entity_id) === Number(vehicle.vehicle_id),
  );

  // A disposable second company gives the feed isolation check a real record
  // to leak if its company predicate ever regresses.
  const [tenantCompany] = await db.execute(
    `INSERT INTO companies (company_name, company_code, status)
     VALUES (?, ?, 'active')`,
    [`QA Tenant ${runId}`, `QAC-${runId}`.slice(0, 50)],
  );
  tenantCompanyId = Number(tenantCompany.insertId);

  const [tenantBranch] = await db.execute(
    `INSERT INTO branches (company_id, branch_name, branch_code, prefix, status)
     VALUES (?, ?, ?, 'QA', 'active')`,
    [tenantCompanyId, `QA Branch ${runId}`, "QA"],
  );
  tenantBranchId = Number(tenantBranch.insertId);

  const [tenantVehicle] = await db.execute(
    `INSERT INTO vehicles
       (company_id, home_branch_id, plate_no, vehicle_type, status)
     VALUES (?, ?, ?, 'Wing Van', 'active')`,
    [tenantCompanyId, tenantBranchId, `QA${runId}`.slice(-20)],
  );
  tenantVehicleId = Number(tenantVehicle.insertId);
  const tenantScope = { company_id: tenantCompanyId, branch_id: tenantBranchId };

  const tenantCreate = await request("/api/v1/fleet/compliance/documents", {
    session: systemAdmin,
    scope: tenantScope,
    method: "POST",
    body: {
      entityType: "vehicle",
      entityId: tenantVehicleId,
      docType: tenantDocType,
      docNumber: `TENANT-${runId}`,
      expiryDate: isoDate(14),
    },
  });
  const tenantCreateBody = await json(tenantCreate);
  if (tenantCreateBody.data?.documentId) {
    createdDocumentIds.add(Number(tenantCreateBody.data.documentId));
  }
  check(
    "system administrator can record within a second valid tenant",
    tenantCreate.status === 201 && Number(tenantCreateBody.data?.documentId) > 0,
    `status=${tenantCreate.status}`,
  );

  const spoofed = await request("/api/v1/fleet/compliance?withinDays=365", {
    session: manager,
    scope: tenantScope,
  });
  check(
    "fleet manager cannot select an unassigned tenant through headers",
    spoofed.status === 403,
    `status=${spoofed.status}`,
  );

  const primaryFeedAgain = await request("/api/v1/fleet/compliance?withinDays=365", {
    session: manager,
    scope: managerScope,
  });
  const primaryFeedBody = await json(primaryFeedAgain);
  check(
    "primary tenant feed does not leak the second tenant document",
    primaryFeedAgain.ok &&
      !(primaryFeedBody.data || []).some((row) => row.doc_type === tenantDocType),
  );

  const tenantFeed = await request("/api/v1/fleet/compliance?withinDays=365", {
    session: systemAdmin,
    scope: tenantScope,
  });
  const tenantFeedBody = await json(tenantFeed);
  check(
    "second tenant sees its own document and not the primary record",
    tenantFeed.ok &&
      (tenantFeedBody.data || []).some((row) => row.doc_type === tenantDocType) &&
      !(tenantFeedBody.data || []).some((row) => row.doc_type === primaryDocType),
  );
} catch (error) {
  if (!unmet) {
    fail++;
    console.log(`FAIL  suite aborted unexpectedly: ${error.message}`);
  }
} finally {
  try {
    if (createdDocumentIds.size) {
      const ids = [...createdDocumentIds];
      await db.execute(
        `DELETE FROM compliance_documents
          WHERE document_id IN (${ids.map(() => "?").join(",")})`,
        ids,
      );
    }
    await db.execute(
      `DELETE FROM compliance_documents WHERE doc_type IN (?, ?)`,
      [primaryDocType, tenantDocType],
    );
    // The primary audit summary contains the seeded vehicle id rather than the
    // document id, so the unique per-run document type is the safe cleanup key.
    await db.execute(
      `DELETE FROM audit_logs
        WHERE action = 'compliance.document.create'
          AND summary LIKE ?`,
      [`Recorded %${runId}%`],
    );
    if (tenantVehicleId) {
      await db.execute("DELETE FROM vehicles WHERE vehicle_id = ?", [tenantVehicleId]);
    }
    if (tenantBranchId) {
      await db.execute("DELETE FROM branches WHERE branch_id = ?", [tenantBranchId]);
    }
    if (tenantCompanyId) {
      await db.execute("DELETE FROM companies WHERE company_id = ?", [tenantCompanyId]);
    }
    const [[leftovers]] = await db.execute(
      `SELECT
         (SELECT COUNT(*) FROM compliance_documents WHERE doc_type IN (?, ?)) AS documents,
         (SELECT COUNT(*) FROM audit_logs
           WHERE action = 'compliance.document.create' AND summary LIKE ?) AS audits,
         (SELECT COUNT(*) FROM companies WHERE company_id = ?) AS companies`,
      [primaryDocType, tenantDocType, `Recorded %${runId}%`, tenantCompanyId ?? 0],
    );
    check(
      "cleanup removed all compliance QA fixtures",
      Number(leftovers.documents) === 0 &&
        Number(leftovers.audits) === 0 &&
        Number(leftovers.companies) === 0,
      JSON.stringify(leftovers),
    );
  } catch (cleanupError) {
    fail++;
    console.log(`FAIL  cleanup ${cleanupError.message}`);
  } finally {
    await db.end();
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) {
  process.exitCode = 1;
} else if (unmet) {
  console.error(`fixture unavailable: ${unmet}`);
  process.exitCode = 2;
} else {
  process.exitCode = 0;
}
