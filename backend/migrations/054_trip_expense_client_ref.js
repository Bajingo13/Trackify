/**
 * 054 — An expense filed from the road is stored once, however often it is sent.
 *
 * The Driver App replays an expense saved out of signal, and resends one whose
 * answer never arrived. Chat, Help & Support and pause requests already carry a
 * device-chosen client_ref for this; expenses did not, so a claim whose reply
 * was lost on a weak signal was filed — and paid — twice.
 *
 * NULL for every existing row and for anything not sent by the app, which a
 * unique key allows any number of.
 *
 * Idempotent.
 */
const exists = async (conn, sql, params) => {
  const [rows] = await conn.query(sql, params);
  return rows.length > 0;
};

export async function up(conn) {
  const hasColumn = await exists(
    conn,
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_expenses' AND COLUMN_NAME = 'client_ref'`
  );
  if (!hasColumn) {
    await conn.query("ALTER TABLE trip_expenses ADD COLUMN client_ref VARCHAR(64) NULL");
  }

  const hasKey = await exists(
    conn,
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_expenses' AND INDEX_NAME = 'uq_trip_expense_client_ref'`
  );
  if (!hasKey) {
    await conn.query(
      "ALTER TABLE trip_expenses ADD UNIQUE KEY uq_trip_expense_client_ref (submitted_by_driver_id, client_ref)"
    );
  }
}
