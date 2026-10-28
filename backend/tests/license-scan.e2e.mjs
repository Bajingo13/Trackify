/**
 * Driver licence scanning, end to end.
 *
 * Reads a photographed licence through the real API with the real OCR engine,
 * then checks that the Driver App can only LOOK at a licence (every write is
 * refused) while showing whatever the office records, and runs the reminder
 * sweep against the real tables.
 *
 * The photo is tests/license-sample.jpg: a FICTIONAL card (made-up person,
 * made-up number) rendered to look like an LTO licence. It is not a real
 * person's document and must stay that way.
 *
 * Arranges and removes its own driver, and everything the run wrote.
 */
import "../src/config/env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../src/config/db.js";
import { operatingScope, trustTestPhone } from "./_context.mjs";
import { sendDriverLicenseReminders, __setReminderMail, __setReminderPush } from "../src/shared/driverLicenseReminders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.TRACKIFY_API_URL || "http://localhost:5000";
const CARD = fs.readFileSync(path.join(__dirname, "license-sample.jpg"));
const NOT_A_CARD = fs.readFileSync(path.join(__dirname, "receipt.png"));

let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

const photoForm = (bytes, type, name, fields = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  f.set("photo", new Blob([bytes], { type }), name);
  return f;
};

const login = await fetch(`${API}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "superadmin@gmail.com", password: "demo123" }),
});
const lj = await login.json();
if (!lj?.data?.token) { console.error("cannot sign in as the demo administrator"); process.exit(2); }
const scope = await operatingScope(lj.data.access, db);
const S = { Authorization: `Bearer ${lj.data.token}`, "X-Company-Id": String(scope.company_id), "X-Branch-Id": String(scope.branch_id) };
const SJ = { ...S, "Content-Type": "application/json" };

let driverId = null;
let remindersBefore = 0;
const [[{ top }]] = await db.execute("SELECT COALESCE(MAX(reminder_id), 0) AS top FROM driver_license_reminders");
remindersBefore = Number(top);

try {
  /* ---- the office scans a card ---- */
  const t0 = Date.now();
  const scan = await fetch(`${API}/api/v1/fleet/drivers/license-scan`, { method: "POST", headers: S, body: photoForm(CARD, "image/jpeg", "card.jpg") });
  const sj = await scan.json();
  console.log(`      (scan took ${Date.now() - t0} ms)`);
  check("the office can scan a licence photo", scan.ok && sj.data?.status === "read", JSON.stringify(sj).slice(0, 300));
  check("it reads the licence number", sj.data?.fields?.licenseNo === "T99-26-000417", sj.data?.fields?.licenseNo);
  check("it reads the expiry date", sj.data?.fields?.licenseExpiry === "2027-01-15", sj.data?.fields?.licenseExpiry);
  check("it reads the name, surname first", sj.data?.fields?.lastName === "Dela Cruz" && sj.data?.fields?.firstName === "Juan Santos", JSON.stringify(sj.data?.fields));
  check("it does not return the birth date", !JSON.stringify(sj).includes("1990"));
  check("it says how many days remain", Number.isInteger(sj.data?.daysLeft));

  const nope = await fetch(`${API}/api/v1/fleet/drivers/license-scan`, { method: "POST", headers: S, body: photoForm(NOT_A_CARD, "image/png", "receipt.png") });
  const nj = await nope.json();
  check("a receipt is not mistaken for a licence", nope.ok && nj.data?.status === "not_a_licence", JSON.stringify(nj).slice(0, 200));

  const pdf = await fetch(`${API}/api/v1/fleet/drivers/license-scan`, { method: "POST", headers: S, body: photoForm(Buffer.from("%PDF-1.4\n%fake\n"), "application/pdf", "scan.pdf") });
  check("a PDF is explained, not an error", pdf.ok && (await pdf.json()).data?.status === "unsupported");

  const junk = await fetch(`${API}/api/v1/fleet/drivers/license-scan`, { method: "POST", headers: S, body: photoForm(Buffer.from("<html>hi</html>"), "image/png", "x.png") });
  check("a file that is not really an image is refused", junk.status === 400, `status=${junk.status}`);

  const anon = await fetch(`${API}/api/v1/fleet/drivers/license-scan`, { method: "POST", body: photoForm(CARD, "image/jpeg", "card.jpg") });
  check("scanning needs a signed-in user", anon.status === 401, `status=${anon.status}`);

  /* ---- a duplicate number is caught while the person still has the card ---- */
  const [[existing]] = await db.execute("SELECT driver_id, license_no FROM drivers WHERE company_id = ? AND employee_no = 'DRV-001'", [scope.company_id]);
  const original = existing.license_no;
  await db.execute("UPDATE drivers SET license_no = 'T99-26-000417' WHERE driver_id = ?", [existing.driver_id]);
  try {
    const dup = await (await fetch(`${API}/api/v1/fleet/drivers/license-scan`, { method: "POST", headers: S, body: photoForm(CARD, "image/jpeg", "card.jpg") })).json();
    check("a number another driver holds is flagged", dup.data?.duplicateOf?.driverId === existing.driver_id, JSON.stringify(dup.data?.duplicateOf));
    const self = await (await fetch(`${API}/api/v1/fleet/drivers/license-scan?driverId=${existing.driver_id}`, { method: "POST", headers: S, body: photoForm(CARD, "image/jpeg", "card.jpg") })).json();
    check("but not against the driver being edited", !self.data?.duplicateOf);
  } finally {
    await db.execute("UPDATE drivers SET license_no = ? WHERE driver_id = ?", [original, existing.driver_id]);
  }

  /* ---- credential-first registration with a readable, Admin-reviewed licence ---- */
  const licenceDir = path.join(__dirname, "..", "uploads", "licenses");
  const filesOnDisk = () => {
    const out = [];
    const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name)) : out.push(e.name)); };
    walk(licenceDir);
    return out.length;
  };
  // No Employee Number is sent: the system assigns it, and hands it back.
  let employeeNo = null;
  // The email the PIN goes to is required (466b328). example.test is reserved:
  // it can never reach a real inbox.
  const MATCHING = {
    pin: "4821", licenseReviewed: "true", email: `e2e-licence-${Date.now()}@example.test`,
    firstName: "Juan Santos", lastName: "Dela Cruz", phone: "0917 000 0000",
    licenseNo: "T99-26-000417", licenseType: "Professional", licenseExpiry: "2027-01-15",
  };
  const register = (fields, file) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    if (file) f.set("photo", new Blob([file.bytes], { type: file.type }), file.name);
    return fetch(`${API}/api/v1/fleet/drivers`, { method: "POST", headers: S, body: f });
  };
  const driversNow = async () => Number((await db.execute("SELECT COUNT(*) n FROM drivers"))[0][0].n);
  const before = { drivers: await driversNow(), files: filesOnDisk() };

  const noPhoto = await register(MATCHING);
  const npj = await noPhoto.json();
  check("a driver cannot be registered without a licence photo", noPhoto.status === 400 && npj.code === "LICENSE_PHOTO_REQUIRED", JSON.stringify(npj));

  const wrongFile = await register(MATCHING, { bytes: NOT_A_CARD, type: "image/png", name: "receipt.png" });
  const wfj = await wrongFile.json();
  check("nor with a photo that is not a licence", wrongFile.status === 422 && wfj.code === "LICENSE_UNREADABLE", JSON.stringify(wfj).slice(0, 240));

  const asCard = { bytes: CARD, type: "image/jpeg", name: "card.jpg" };
  const notReviewed = await register({ ...MATCHING, licenseReviewed: "false" }, asCard);
  const nrj = await notReviewed.json();
  check("the Admin must confirm review before saving", notReviewed.status === 400 && nrj.code === "LICENSE_REVIEW_REQUIRED", JSON.stringify(nrj));

  const pdfTry = await register(MATCHING, { bytes: Buffer.from("%PDF-1.4\n%fake\n"), type: "application/pdf", name: "scan.pdf" });
  check("a PDF is refused by the server (the form turns it into an image first)", pdfTry.status === 422 && /PDF/.test((await pdfTry.json()).message));

  check("none of those refusals wrote a driver", (await driversNow()) === before.drivers, `drivers ${before.drivers} -> ${await driversNow()}`);
  check("or left a file behind", filesOnDisk() === before.files, `files ${before.files} -> ${filesOnDisk()}`);

  // a number sent anyway is ignored
  const created = await register({ ...MATCHING, employeeNo: "HANDTYPED-1" }, asCard);
  const cj = await created.json();
  driverId = cj.data?.driverId;
  check("readable, reviewed details register credentials, profile and licence together", created.status === 201 && driverId, JSON.stringify(cj));
  if (!driverId) throw new Error("no driver created");
  employeeNo = cj.data?.employeeNo;
  check("the system assigned an Employee Number and said which", /^DRV-\d{3,}$/.test(employeeNo || ""), String(employeeNo));
  const [[numbered]] = await db.execute("SELECT COUNT(*) n FROM drivers WHERE company_id = (SELECT company_id FROM drivers WHERE driver_id = ?) AND employee_no = ?", [driverId, employeeNo]);
  check("and it belongs to this driver alone", Number(numbered.n) === 1);
  check("a hand-typed number in the request was ignored", employeeNo !== "HANDTYPED-1");
  check("with the photo stored in the same step", filesOnDisk() === before.files + 1);
  const registered = await (await fetch(`${API}/api/v1/fleet/drivers/${driverId}`, { headers: S })).json();
  check("and on the driver's record", Number(registered.data?.has_license_photo) === 1 && String(registered.data?.license_no).toUpperCase() === "T99-26-000417", JSON.stringify(registered.data).slice(0, 200));

  // a different email, so the refusal can only be the licence number
  const again = await register({ ...MATCHING, email: `e2e-licence-again-${Date.now()}@example.test` }, asCard);
  check("a second driver cannot reuse the same licence number", again.status === 409, `status=${again.status}`);
  check("(and that refusal left no file either)", filesOnDisk() === before.files + 1);

  /* ---- the driver, from the app ---- */
  const [[emp]] = await db.execute("SELECT employee_no, app_enabled, pin_hash FROM drivers WHERE driver_id = ?", [driverId]);
  check("registration enables Driver App access", emp.employee_no === employeeNo && Boolean(emp.app_enabled) && Boolean(emp.pin_hash));
  // a new driver has no phone yet: the test phone becomes the trusted one
  const phone = await trustTestPhone(db, employeeNo);
  check("the new driver's test phone is trusted", Boolean(phone.key), phone.missing || "");
  const dl = await (await fetch(`${API}/api/v1/driver/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Driver-Device": phone.key || "" },
    body: JSON.stringify({ employeeNo, pin: "4821" }),
  })).json();
  const D = { Authorization: `Bearer ${dl.data?.token}`, "X-Driver-Device": phone.key || "" };
  check("the driver signs in", Boolean(dl.data?.token), JSON.stringify(dl).slice(0, 200));


  /* ---- the driver can only look ---- */
  const prof0 = await (await fetch(`${API}/api/v1/driver/me`, { headers: D })).json();
  const l0 = prof0.data?.license || {};
  check("the driver sees the licence the office recorded", String(l0.no).toUpperCase() === "T99-26-000417" && l0.type === "Professional" && l0.expiry === "2027-01-15" && l0.hasPhoto === true, JSON.stringify(l0));
  check("there is nothing for the office to review: drivers cannot submit", !("pendingReview" in l0));

  const ph = await fetch(`${API}/api/v1/driver/me/license-photo`, { headers: D });
  const phBytes = Buffer.from(await ph.arrayBuffer());
  check("and the photo the office attached", ph.ok && phBytes.length === CARD.length, `status=${ph.status} len=${phBytes.length}`);
  check("which is never served from a cache, so a replacement shows at once", /no-cache/.test(ph.headers.get("cache-control") || ""), ph.headers.get("cache-control"));

  const attempts = [
    ["POST", "/me/license-scan", photoForm(CARD, "image/jpeg", "c.jpg")],
    ["POST", "/me/license", photoForm(CARD, "image/jpeg", "c.jpg", { licenseNo: "N01-77-777777", licenseExpiry: "2035-01-01" })],
    ["POST", "/me/license-photo", photoForm(CARD, "image/jpeg", "c.jpg")],
    ["DELETE", "/me/license-photo", undefined],
    ["PUT", "/me/license", undefined],
  ];
  for (const [method, p, body] of attempts) {
    const r = await fetch(`${API}/api/v1/driver${p}`, { method, headers: D, body });
    check(`the driver cannot ${method} ${p}`, r.status === 404 || r.status === 405, `status=${r.status}`);
  }
  const sneak = await fetch(`${API}/api/v1/driver/me`, { method: "PATCH", headers: { ...D, "Content-Type": "application/json" }, body: JSON.stringify({ phone: "0918 222 3333", licenseNo: "N01-77-777777", licenseExpiry: "2035-01-01", licenseType: "Student" }) });
  const [[still]] = await db.execute("SELECT license_no, license_expiry, license_type, license_photo_path FROM drivers WHERE driver_id = ?", [driverId]);
  check("nor by slipping licence fields into the profile update", sneak.ok && String(still.license_no).toUpperCase() === "T99-26-000417" && String(still.license_expiry).slice(0, 10) === "2027-01-15" && still.license_type === "Professional" && still.license_photo_path, JSON.stringify(still));

  /* ---- what the office changes, the driver sees ---- */
  const edit = await fetch(`${API}/api/v1/fleet/drivers/${driverId}`, { method: "PATCH", headers: SJ, body: JSON.stringify({ licenseNo: "QA9-99-000003", licenseType: "Non-Professional", licenseExpiry: "2032-02-29" }) });
  const prof1 = await (await fetch(`${API}/api/v1/driver/me`, { headers: D })).json();
  const l1 = prof1.data?.license || {};
  check("a licence edited by the office is what the driver sees next", edit.ok && l1.no === "QA9-99-000003" && l1.type === "Non-Professional" && l1.expiry === "2032-02-29", JSON.stringify(l1));

  await new Promise((r) => setTimeout(r, 1100)); // photoUpdatedAt has one-second resolution
  const swap = await fetch(`${API}/api/v1/fleet/drivers/${driverId}/license-photo`, { method: "POST", headers: S, body: photoForm(CARD, "image/jpeg", "new.jpg") });
  const prof2b = await (await fetch(`${API}/api/v1/driver/me`, { headers: D })).json();
  const ph2 = await fetch(`${API}/api/v1/driver/me/license-photo`, { headers: D });
  check("and so is a readable photo the office replaces", swap.ok && (await ph2.arrayBuffer()).byteLength === CARD.length && prof2b.data.license.photoUpdatedAt !== l0.photoUpdatedAt, `status=${swap.status}`);

  const other = await fetch(`${API}/api/v1/fleet/drivers/${driverId}/license-photo`, { headers: S });
  check("the office's own view of the photo is not cached either", /no-cache|max-age=0/.test(other.headers.get("cache-control") || "") , other.headers.get("cache-control"));


  /* ---- the compliance feed and bell agree with the app ---- */
  await db.execute("UPDATE drivers SET license_expiry = DATE_ADD(CURDATE(), INTERVAL 45 DAY) WHERE driver_id = ?", [driverId]);
  const comp = await (await fetch(`${API}/api/v1/fleet/compliance?withinDays=120`, { headers: S })).json();
  const mine = (comp.data || []).find((r) => r.entity_type === "driver" && Number(r.entity_id) === driverId && r.doc_type === "Driver Licence");
  check("a licence 45 days out is 'expiring' in the Compliance feed (60-day window)", mine?.compliance_status === "expiring", JSON.stringify(mine));
  const prof = await (await fetch(`${API}/api/v1/driver/me`, { headers: D })).json();
  check("and 'expiring' in the Driver App", prof.data?.license?.state === "expiring" && prof.data.license.daysLeft >= 44 && prof.data.license.daysLeft <= 46, JSON.stringify(prof.data?.license));

  await db.execute("UPDATE drivers SET license_expiry = DATE_SUB(CURDATE(), INTERVAL 2 DAY) WHERE driver_id = ?", [driverId]);
  const prof2 = await (await fetch(`${API}/api/v1/driver/me`, { headers: D })).json();
  check("an expired licence is 'expired' in the Driver App", prof2.data?.license?.state === "expired" && prof2.data.license.daysLeft === -2, JSON.stringify(prof2.data?.license));
  const comp2 = await (await fetch(`${API}/api/v1/fleet/compliance?withinDays=120`, { headers: S })).json();
  const mine2 = (comp2.data || []).find((r) => r.entity_type === "driver" && Number(r.entity_id) === driverId && r.doc_type === "Driver Licence");
  check("and 'expired' in the Compliance feed", mine2?.compliance_status === "expired", JSON.stringify(mine2));

  /* ---- the reminder sweep, against the real tables (mail and push faked) ---- */
  await db.execute("UPDATE drivers SET license_expiry = DATE_ADD(CURDATE(), INTERVAL 5 DAY) WHERE driver_id = ?", [driverId]);
  const mails = [];
  const pushes = [];
  __setReminderMail({ isMailConfigured: () => true, send: async (m) => { mails.push(m); return { sent: true }; } });
  __setReminderPush({ pushEnabled: () => true, notifyDriver: async (n) => { pushes.push(n); return { sent: 1, removed: 0 }; } });
  try {
    const dry = await sendDriverLicenseReminders({ dryRun: true });
    check("a dry run finds the licence due and sends nothing", dry.due.some((d) => d.driverId === driverId) && mails.length === 0 && pushes.length === 0);

    const first = await sendDriverLicenseReminders();
    check("the sweep notifies the driver", pushes.some((p) => p.driverId === driverId), JSON.stringify(first.driver.sent.map((s) => s.driverId)));
    check("and the office, in one email", mails.length >= 1 && first.office.sent.some((s) => s.driver.startsWith("Juan Santos")));

    const before = { mails: mails.length, pushes: pushes.length };
    const second = await sendDriverLicenseReminders();
    check("running it again sends nothing more", mails.length === before.mails && pushes.length === before.pushes && second.driver.sent.length === 0 && second.office.sent.length === 0);

    const [claimed] = await db.execute("SELECT audience, threshold_days FROM driver_license_reminders WHERE driver_id = ? ORDER BY audience", [driverId]);
    check("each audience is recorded once, at the 7-day threshold", claimed.length === 2 && claimed.every((c) => c.threshold_days === 7), JSON.stringify(claimed));
  } finally {
    __setReminderMail(null);
    __setReminderPush(null);
  }
} finally {
  /* ---- put everything back ---- */
  if (driverId) {
    await fetch(`${API}/api/v1/fleet/drivers/${driverId}/license-photo`, { method: "DELETE", headers: S }).catch(() => {});
    await db.execute("DELETE FROM audit_logs WHERE entity_type = 'driver' AND entity_id = ?", [String(driverId)]);
    await db.execute("DELETE FROM drivers WHERE driver_id = ?", [driverId]); // reminders cascade
  }
  // The sweep above looked at every driver in the company, with mail and push
  // faked. Those claims describe notices nobody received, so they must not stand.
  await db.execute("DELETE FROM driver_license_reminders WHERE reminder_id > ?", [remindersBefore]);
  await db.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
