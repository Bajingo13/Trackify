/**
 * 051 — Phone notifications for drivers.
 *
 * A driver who has turned notifications on for the Driver app is given one row
 * per device here: the address their phone's browser gave us to reach it, and
 * the keys that make a message readable only by that phone. When the office
 * answers a request or decides a pause, a short notice is sent to every device
 * the driver has registered.
 *
 * endpoint_hash is the unique key (an endpoint is a long URL; a hash of it is
 * what is compared). The same phone registering again, even after another
 * driver signed in on it, is one row: the latest driver to enable it owns it.
 *
 * Rows are removed when the push service says the phone is gone (404 / 410),
 * when the driver turns notifications off, and with the driver. Additive.
 */
export async function up(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS driver_push_subscriptions (
      subscription_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT UNSIGNED NOT NULL,
      driver_id INT UNSIGNED NOT NULL,
      endpoint TEXT NOT NULL,
      endpoint_hash CHAR(64) NOT NULL,
      p256dh VARCHAR(255) NOT NULL,
      auth VARCHAR(255) NOT NULL,
      user_agent VARCHAR(255) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_success_at DATETIME(3) NULL,
      UNIQUE KEY uq_push_endpoint (endpoint_hash),
      KEY ix_push_driver (company_id, driver_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
