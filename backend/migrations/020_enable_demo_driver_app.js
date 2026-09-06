/**
 * 020 — Let the demo drivers actually sign in to the driver app.
 *
 * Migration 015 gave a PIN to every demo driver but flipped app_enabled on
 * only the first one, back when the app was read-only tracking. Now that a
 * driver can file expenses from the road, the drivers who are actually
 * carrying active trips need to be able to sign in, or the feature cannot be
 * used or demonstrated.
 *
 * Scoped deliberately: demo company only, and only drivers that already have
 * a PIN. It enables existing credentials, it never creates any. app_enabled
 * stays an explicit per-driver admin decision everywhere else.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [companies] = await conn.query(
    `SELECT company_id FROM companies WHERE company_id = 1 LIMIT 1`
  );
  if (!companies.length) return;

  const [r] = await conn.query(
    `UPDATE drivers
        SET app_enabled = 1
      WHERE company_id = 1
        AND status = 'active'
        AND pin_hash IS NOT NULL
        AND app_enabled = 0`
  );

  if (r.affectedRows) {
    console.log(`[020] enabled driver-app access for ${r.affectedRows} demo driver(s)`);
  }
}
