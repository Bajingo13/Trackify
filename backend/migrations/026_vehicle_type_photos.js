/**
 * 026 — A company's own photograph for a kind of vehicle.
 *
 * The app ships four photographs covering ten body shapes, so a Closed Van is
 * currently shown a box truck and a Wing Van is shown a curtainsider. Shipping
 * more photographs only moves the problem: the next operator runs a body type
 * nobody here has a picture of, and they have no way to fix it without a
 * release.
 *
 * So the mapping becomes data. A company uploads one photograph per vehicle
 * type and every vehicle of that type across the system uses it — fleet cards,
 * dispatch, tracking, and the driver's phone. Nothing bundled is deleted; the
 * shipped photograph stays as the fallback when a company has not supplied one,
 * and the drawn silhouette stays as the fallback below that.
 *
 * Scoped per company rather than globally: two operators can disagree about
 * what their "Wing Van" looks like, and both are right about their own fleet.
 *
 * vehicle_type is the label itself rather than a foreign key, because that is
 * how vehicles already store it — a VARCHAR on the vehicle row, not a lookup.
 * Matching on the string keeps a company free to invent a type the dropdown
 * has never heard of and still give it a picture.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [existing] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vehicle_type_photos'`
  );
  if (existing.length) return;

  await conn.query(`
    CREATE TABLE vehicle_type_photos (
      type_photo_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,

      -- the label as it appears on the vehicle row, e.g. 'Closed Van'
      vehicle_type VARCHAR(100) NOT NULL,

      photo_path VARCHAR(255) NOT NULL,
      photo_mime VARCHAR(100) NOT NULL,
      photo_size INT UNSIGNED NULL,

      uploaded_by INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      -- one photograph per type per company, enforced here rather than in a
      -- handler: replacing a photo is an update, never a second row that the
      -- next read has to pick between
      UNIQUE KEY uq_company_vehicle_type (company_id, vehicle_type),

      FOREIGN KEY (company_id) REFERENCES companies(company_id),
      FOREIGN KEY (uploaded_by) REFERENCES users(user_id)
    ) ENGINE=InnoDB
  `);
}
