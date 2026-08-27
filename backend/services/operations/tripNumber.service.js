export async function generateTripNumber(connection, companyId, branchId) {
  const year = new Date().getFullYear();

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

  return `TT-${year}-${String(nextNumber).padStart(6, "0")}`;
}
