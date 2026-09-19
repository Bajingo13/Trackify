/**
 * 032 — The company's own places.
 *
 * OpenStreetMap does not contain most Philippine subdivisions, and it never
 * will: "0394 Villa Esperanza Phase 2, Balayan" returns nothing however it is
 * searched, because nobody has mapped it. The geocoder can only degrade to
 * Balayan and ask somebody to drop a pin.
 *
 * Dropping that pin is fine once. Doing it every single time the same truck
 * goes to the same subdivision is what makes dispatchers stop using the map.
 * So the pin is kept: the first person to place it teaches the company where
 * the place is, and everybody afterwards types two letters and gets it back.
 *
 * Scoped to the company rather than the branch. A depot is a depot whichever
 * branch is dispatching to it, and a company that wants branch-local naming
 * can say so in the label.
 *
 * Unique on (company_id, label) so saving the same name twice corrects the
 * pin rather than growing a second entry — which is what somebody re-saving a
 * place actually means.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saved_places (
      place_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,

      -- what people here call it, which is what they will type looking for it
      label VARCHAR(160) NOT NULL,
      -- the address as a person writes it, kept whole for reading
      address VARCHAR(400) NULL,

      house_no VARCHAR(40) NULL,
      street VARCHAR(160) NULL,
      barangay VARCHAR(120) NULL,
      city VARCHAR(120) NULL,
      province VARCHAR(120) NULL,
      postcode VARCHAR(20) NULL,

      -- the whole point: the exact spot somebody stood and pointed at
      latitude DECIMAL(10,7) NOT NULL,
      longitude DECIMAL(10,7) NOT NULL,

      kind ENUM('depot','customer','stop','other') NOT NULL DEFAULT 'other',
      note VARCHAR(255) NULL,

      -- how often it earns its place in the list
      times_used INT UNSIGNED NOT NULL DEFAULT 0,
      last_used_at DATETIME NULL,

      created_by INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      UNIQUE KEY uq_saved_place_label (company_id, label),
      INDEX idx_saved_place_use (company_id, times_used),
      INDEX idx_saved_place_barangay (company_id, barangay),
      FOREIGN KEY (company_id) REFERENCES companies(company_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
