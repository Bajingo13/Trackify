import { settingsFor } from "../../shared/companySettings.js";

export async function generateTripNumber(connection, companyId, branchId) {
  const year = new Date().getFullYear();

  /*
   * The prefix was hardcoded "TT" here while the seeded tickets read "DVO-",
   * which is the whole argument for making it a setting: a company calls its
   * own paperwork what it calls it.
   *
   * Read on the caller's connection so it sits inside the same transaction as
   * the sequence bump — a settings change committed halfway through cannot
   * give one ticket the old prefix and the next number the new one.
   */
  const { tripPrefix } = await settingsFor(companyId, connection);

  const [rows] = await connection.execute(
    `SELECT sequence_id, last_number FROM trip_sequences
     WHERE company_id = ? AND branch_id = ? AND sequence_year = ?
     FOR UPDATE`,
    [companyId, branchId, year]
  );

  let nextNumber;

  if (!rows.length) {
    nextNumber = 1;
    await connection.execute(
      `INSERT INTO trip_sequences (company_id, branch_id, sequence_year, last_number) VALUES (?, ?, ?, ?)`,
      [companyId, branchId, year, nextNumber]
    );
  } else {
    nextNumber = Number(rows[0].last_number) + 1;
    await connection.execute(
      `UPDATE trip_sequences SET last_number = ? WHERE sequence_id = ?`,
      [nextNumber, rows[0].sequence_id]
    );
  }

  /* The counter is per company, branch and year, so the prefix changes the
   * label and not the sequence: nothing is renumbered, nothing collides. */
  return `${tripPrefix}-${year}-${String(nextNumber).padStart(6, "0")}`;
}
