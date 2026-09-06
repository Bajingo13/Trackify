/**
 * End-to-end QA for driver-submitted expenses with receipt upload.
 * Cleans up everything it creates.
 */
const API = "http://localhost:5000";
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`ok    ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

// a tiny valid PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const staffLogin = async (email) => {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "demo123" }),
  });
  const j = await r.json();
  const a = j.data.access?.[0] || {};
  return {
    token: j.data.token,
    H: {
      Authorization: `Bearer ${j.data.token}`,
      "X-Company-Id": String(a.company_id ?? ""),
      "X-Branch-Id": String(a.branch_id ?? ""),
    },
  };
};

const fin = await staffLogin("financeofficer@gmail.com");
const audit = await staffLogin("auditor@gmail.com");

// driver login
const dl = await fetch(`${API}/api/v1/driver/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ employeeNo: "DRV-001", pin: "1234" }),
});
const dj = await dl.json();
check("driver logs in", dl.ok && dj.data?.token, JSON.stringify(dj).slice(0, 120));
const DH = { Authorization: `Bearer ${dj.data.token}` };

// find a trip the driver can file against
const trips = await (await fetch(`${API}/api/v1/driver/trips`, { headers: DH })).json();
let trip = (trips.data || []).find((t) => ["released", "in_transit"].includes(t.status)) || (trips.data || [])[0];
if (!trip && process.env.TRIP_ID) {
  // the driver trip list only carries active runs; a just-delivered trip is
  // still reachable by id, which is exactly when receipts get filed
  trip = await (await fetch(`${API}/api/v1/driver/trips/${process.env.TRIP_ID}`, { headers: DH })).json().then((d) => d.data);
}
check("driver has a trip", !!trip, JSON.stringify(trips).slice(0, 160));
if (!trip) process.exit(1);
console.log(`      using ${trip.ticketNo} (${trip.status})`);

// ---- submit with a receipt photo ----
const form = new FormData();
form.set("category", "fuel");
form.set("amount", "2450.75");
form.set("description", "Diesel top-up, Digos");
form.set("receiptNo", "OR-77123");
form.set("receipt", new Blob([PNG], { type: "image/png" }), "receipt.png");

const sub = await fetch(`${API}/api/v1/driver/trips/${trip.id}/expenses`, {
  method: "POST", headers: DH, body: form,
});
const subJ = await sub.json();
check("driver submits fuel expense with receipt", sub.status === 201 && subJ.data?.hasReceipt, JSON.stringify(subJ).slice(0, 160));
const expenseId = subJ.data?.id;

// ---- validation ----
const badForm = new FormData();
badForm.set("category", "fuel");
badForm.set("amount", "0");
const bad = await fetch(`${API}/api/v1/driver/trips/${trip.id}/expenses`, { method: "POST", headers: DH, body: badForm });
check("zero amount rejected", bad.status === 400);

const otherForm = new FormData();
otherForm.set("category", "fuel");
otherForm.set("amount", "100");
const other = await fetch(`${API}/api/v1/driver/trips/999999/expenses`, { method: "POST", headers: DH, body: otherForm });
check("cannot file against a trip that isn't theirs", other.status === 404);

// ---- driver sees their own claim ----
const mine = await (await fetch(`${API}/api/v1/driver/trips/${trip.id}/expenses`, { headers: DH })).json();
const claim = (mine.data || []).find((e) => e.id === expenseId);
check("driver sees own claim as submitted", claim?.status === "submitted" && claim?.hasReceipt === true, JSON.stringify(claim));

// ---- finance sees it pending ----
const pending = await (await fetch(`${API}/api/v1/finance/expenses?status=submitted`, { headers: fin.H })).json();
const seen = (pending.data || []).find((e) => e.id === expenseId);
check("finance sees the claim awaiting review", !!seen, JSON.stringify(pending).slice(0, 160));
check("claim carries the driver's name", !!seen?.submittedByDriver, seen?.submittedByDriver);
check("claim exposes its receipt", (seen?.attachments || []).length === 1);

const attId = seen?.attachments?.[0];

// ---- receipt is served, and only to the right company ----
const img = await fetch(`${API}/api/v1/finance/expenses/receipts/${attId}`, { headers: fin.H });
const bytes = Buffer.from(await img.arrayBuffer());
check("receipt downloads intact", img.ok && bytes.equals(PNG), `status=${img.status} len=${bytes.length}`);

const noAuth = await fetch(`${API}/api/v1/finance/expenses/receipts/${attId}`);
check("receipt refuses anonymous access", noAuth.status === 401 || noAuth.status === 403, `status=${noAuth.status}`);

// ---- a submitted claim cannot reach a voucher ----
const vou = await fetch(`${API}/api/v1/finance/vouchers`, {
  method: "POST", headers: { ...fin.H, "Content-Type": "application/json" },
  body: JSON.stringify({ payee: "QA Payee", purpose: "QA", expenseIds: [expenseId] }),
});
const vouJ = await vou.json().catch(() => ({}));
const voucherId = vouJ?.data?.id;
if (voucherId) {
  const check1 = await (await fetch(`${API}/api/v1/finance/vouchers/${voucherId}`, { headers: fin.H })).json();
  check("unreviewed claim is not pulled onto a voucher", (check1.data?.lines || []).every((l) => l.tripExpenseId !== expenseId));
  await fetch(`${API}/api/v1/finance/vouchers/${voucherId}`, { method: "DELETE", headers: fin.H });
} else {
  check("voucher refuses an unreviewed claim", !vou.ok, `status=${vou.status}`);
}

// ---- auditor may read but not approve ----
const auditTry = await fetch(`${API}/api/v1/finance/expenses/${expenseId}/approve`, { method: "POST", headers: audit.H });
check("auditor cannot approve", auditTry.status === 403, `status=${auditTry.status}`);

// ---- reject needs a reason ----
const noReason = await fetch(`${API}/api/v1/finance/expenses/${expenseId}/reject`, {
  method: "POST", headers: { ...fin.H, "Content-Type": "application/json" }, body: JSON.stringify({}),
});
check("rejection requires a reason", noReason.status === 400, `status=${noReason.status}`);

// ---- approve ----
const appr = await fetch(`${API}/api/v1/finance/expenses/${expenseId}/approve`, {
  method: "POST", headers: { ...fin.H, "Content-Type": "application/json" }, body: JSON.stringify({ note: "Checked against OR" }),
});
check("finance approves the claim", appr.ok, `status=${appr.status}`);

const after = await (await fetch(`${API}/api/v1/finance/expenses?tripTicketId=${trip.id}`, { headers: fin.H })).json();
const approved = (after.data || []).find((e) => e.id === expenseId);
check("approved claim becomes recorded", approved?.status === "recorded", approved?.status);

// ---- double review blocked ----
const again = await fetch(`${API}/api/v1/finance/expenses/${expenseId}/approve`, {
  method: "POST", headers: { ...fin.H, "Content-Type": "application/json" }, body: JSON.stringify({}),
});
check("a claim cannot be reviewed twice", again.status === 409, `status=${again.status}`);

// ---- cleanup ----
const del = await fetch(`${API}/api/v1/finance/expenses/${expenseId}`, { method: "DELETE", headers: fin.H });
check("cleanup: claim deleted", del.ok, `status=${del.status}`);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
