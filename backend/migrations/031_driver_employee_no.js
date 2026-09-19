/**
 * 031 — Give every driver the number they sign in with.
 *
 * The Driver App authenticates on employee_no plus a PIN. Nothing ever set
 * employee_no: the Add Driver form has no field for it, and the web screens
 * displayed a number computed from the row id — "DRV-007" — including in the
 * dialog that tells the office "the driver signs in with their employee number
 * (DRV-007) and this PIN". That number was never stored, so the login matched
 * NULL and every driver created through the web was unable to sign in. Only the
 * demo drivers worked, because migration 002 seeded theirs.
 *
 * Two things, then. Backfill the numbers the screens have been promising, and
 * make the column unique per company so the promise stays true.
 *
 * Unique per company rather than globally, because DRV-001 is the first driver
 * at every firm and always will be. That leaves the Driver App looking up a
 * number that is only unique within a company it has not been told — handled
 * in driver.controller.js, which now refuses an ambiguous sign-in rather than
 * guessing which company the driver meant.
 *
 * Idempotent.
 */

const pad = (n) => `DRV-${String(n).padStart(3, "0")}`;

export async function up(conn) {
  /*
   * Backfill, company by company, continuing from whatever numbering that
   * company already uses rather than restarting at 001 — a company with
   * DRV-001..DRV-012 seeded gets DRV-013 next, not a collision.
   */
  const [missing] = await conn.query(
    `SELECT driver_id, company_id FROM drivers
      WHERE employee_no IS NULL OR employee_no = ''
      ORDER BY company_id, driver_id`
  );

  const nextByCompany = new Map();

  for (const row of missing) {
    if (!nextByCompany.has(row.company_id)) {
      // The highest DRV-### already used by this company, whatever else is in
      // the column — a company numbering its people some other way is left be.
      const [[peak]] = await conn.query(
        `SELECT MAX(CAST(SUBSTRING(employee_no, 5) AS UNSIGNED)) AS top
           FROM drivers
          WHERE company_id = ? AND employee_no REGEXP '^DRV-[0-9]+$'`,
        [row.company_id]
      );
      nextByCompany.set(row.company_id, Number(peak?.top || 0) + 1);
    }

    let candidate = nextByCompany.get(row.company_id);
    // Step over anything already taken, including numbers written by hand.
    // eslint-disable-next-line no-await-in-loop
    for (;;) {
      const [[clash]] = await conn.query(
        `SELECT driver_id FROM drivers WHERE company_id = ? AND employee_no = ? LIMIT 1`,
        [row.company_id, pad(candidate)]
      );
      if (!clash) break;
      candidate += 1;
    }

    // eslint-disable-next-line no-await-in-loop
    await conn.query(`UPDATE drivers SET employee_no = ? WHERE driver_id = ?`, [
      pad(candidate),
      row.driver_id,
    ]);
    nextByCompany.set(row.company_id, candidate + 1);
  }

  /* One number per person, per company — the same guarantee vehicles have had
   * on their plate since migration 001. */
  const [indexes] = await conn.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'drivers'
        AND INDEX_NAME = 'uq_driver_employee_no'`
  );
  if (!indexes.length) {
    await conn.query(
      `ALTER TABLE drivers ADD UNIQUE KEY uq_driver_employee_no (company_id, employee_no)`
    );
  }
}
