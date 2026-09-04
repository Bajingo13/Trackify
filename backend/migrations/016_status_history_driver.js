/**
 * 016 — Allow trip_status_history.changed_by to be NULL.
 *
 * The Driver App advances a trip (start / deliver) without a staff user, so the
 * history row's actor is recorded in `remarks` ("… (driver <name>)") instead of
 * the FK. The FK to users(user_id) still holds for non-null values.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [[col]] = await conn.query(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trip_status_history'
        AND COLUMN_NAME = 'changed_by'`
  );
  if (col && col.IS_NULLABLE === "NO") {
    await conn.query(`ALTER TABLE trip_status_history MODIFY changed_by INT UNSIGNED NULL`);
  }
}
