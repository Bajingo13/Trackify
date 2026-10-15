/**
 * What to do with a licence scan in the driver form.
 *
 * Pure, so the rules can be tested without a browser. The form calls this with
 * what it holds and what the scan returned, and gets back the new form, which
 * fields to mark, and anything the person should be told.
 *
 * The rules, and why:
 *
 *   • Licence number, type and expiry are overwritten. The person uploaded a
 *     licence to fill these in; leaving the old value would make the upload
 *     look like it did nothing. On an edit this is exactly the renewal case.
 *   • Names are only filled when empty. On an edit, replacing a driver's name
 *     with whatever an OCR made of a glossy card would be a worse failure than
 *     asking the person to type it. A name that differs from the one entered
 *     is reported, not silently chosen between — it usually means the wrong
 *     person's licence was attached.
 *   • A field the scan did not find is left as it was. A partial reading never
 *     blanks something that was right.
 *   • Every field taken from the scan is marked, with how sure the reading was,
 *     so the person knows which values came from a machine.
 */

const squash = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** Do two names refer to the same person, ignoring case, spacing and punctuation? Middle names are not compared. */
export function sameName(a, b) {
  const [x, y] = [squash(a), squash(b)];
  if (!x || !y) return true; // nothing to compare is not a mismatch
  return x === y || x.includes(y) || y.includes(x);
}
/**
 * @param {object} form    the form's current values
 * @param {object} result  the scan result (status "read" expected)
 * @returns {{ form: object, marks: Record<string, "high"|"low">, filled: number, nameNote: string|null }}
 */
export function applyLicenseScan(form, result) {
  if (result?.status !== "read") return { form, marks: {}, filled: 0, nameNote: null };

  const f = result.fields || {};
  const c = result.confidence || {};
  const next = { ...form };
  const marks = {};

  const take = (key, value, confidence) => {
    if (!value) return;
    next[key] = value;
    marks[key] = confidence === "high" ? "high" : "low";
  };

  take("licenseNo", f.licenseNo, c.licenseNo);
  take("licenseExpiry", f.licenseExpiry, c.licenseExpiry);
  take("licenseType", f.licenseType, c.licenseType);

  if (!String(form.firstName || "").trim()) take("firstName", f.firstName, c.firstName);
  if (!String(form.lastName || "").trim()) take("lastName", f.lastName, c.lastName);

  let nameNote = null;
  const onCard = [f.firstName, f.lastName].filter(Boolean).join(" ");
  const entered = [form.firstName, form.lastName].filter(Boolean).join(" ");
  if (entered && onCard) {
    const lastAgrees = !f.lastName || sameName(form.lastName, f.lastName);
    const firstAgrees = !f.firstName || sameName(form.firstName, f.firstName);
    if (!lastAgrees || !firstAgrees) {
      nameNote = `The name on the licence (${f.lastName || "?"}, ${f.firstName || "?"}) is different from the name entered (${form.lastName || "?"}, ${form.firstName || "?"}). Make sure this is the right driver's licence.`;
    }
  }

  return { form: next, marks, filled: Object.keys(marks).length, nameNote };
}

/** The fields the Apply step offers for an existing driver, and how each differs from the record. */
export function licenceDifferences(driver, result) {
  if (result?.status !== "read") return [];
  const f = result.fields || {};
  const rows = [
    ["Licence number", "licenseNo", driver.licenseNo, f.licenseNo],
    ["Licence type", "licenseType", driver.licenseType, f.licenseType],
    ["Expiry", "licenseExpiry", driver.licenseExpiry, f.licenseExpiry],
  ];
  return rows
    .filter(([, , current, scanned]) => scanned && String(scanned) !== String(current || ""))
    .map(([label, key, current, scanned]) => ({ label, key, current: current || "—", scanned }));
}
