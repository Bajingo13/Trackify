/**
 * 023 — Let a maintenance job list a part that is not in the item catalogue.
 *
 * maintenance_parts.item_id was NOT NULL, so a job could only ever name a part
 * the warehouse already stocks. Real repairs are not like that: a mechanic
 * fits a bracket, a seal, a one-off from the shop down the road, and the job
 * still has to record what went into the truck.
 *
 * A free-text part records what was fitted and its cost story; it deliberately
 * does not touch stock, because there is no stock to deduct. Catalogue parts
 * behave exactly as before and still consume inventory on completion.
 *
 * Idempotent.
 */
export async function up(conn) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maintenance_parts'
        AND COLUMN_NAME = 'part_name'`
  );
  if (cols.length) return;

  // the foreign key has to go before the column can accept NULL
  const [fks] = await conn.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'maintenance_parts'
        AND COLUMN_NAME = 'item_id' AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  for (const fk of fks) {
    await conn.query(`ALTER TABLE maintenance_parts DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
  }

  await conn.query(
    `ALTER TABLE maintenance_parts
       MODIFY COLUMN item_id INT UNSIGNED NULL,
       ADD COLUMN part_name VARCHAR(150) NULL AFTER item_id,
       ADD COLUMN unit VARCHAR(30) NULL AFTER part_name`
  );

  // re-attach the key so a catalogue part still cannot point at a missing item
  await conn.query(
    `ALTER TABLE maintenance_parts
       ADD CONSTRAINT fk_maintenance_parts_item
       FOREIGN KEY (item_id) REFERENCES inventory_items(item_id)`
  );
}
