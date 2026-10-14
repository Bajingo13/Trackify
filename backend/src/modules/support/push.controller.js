import { pushEnabled, removeSubscription, saveSubscription, vapidPublicKey } from "./push.service.js";

/**
 * Notification settings for the signed-in driver's phone. Mounted under
 * /api/v1/driver/push. Nothing here takes a driver id: it is always the caller's own.
 */

/* GET /api/v1/driver/push/key — whether notifications are available, and the key the phone needs */
export async function key(req, res) {
  res.json({ success: true, data: { enabled: pushEnabled(), publicKey: vapidPublicKey() } });
}

/* POST /api/v1/driver/push/subscribe  { subscription } */
export async function subscribe(req, res) {
  const result = await saveSubscription({
    driver: req.driver,
    subscription: req.body?.subscription,
    userAgent: req.get("user-agent"),
  });
  if (result.error) return res.status(result.status).json({ success: false, message: result.error });
  res.json({ success: true, data: { subscribed: true } });
}

/* POST /api/v1/driver/push/unsubscribe  { endpoint } */
export async function unsubscribe(req, res) {
  const result = await removeSubscription({ driver: req.driver, endpoint: req.body?.endpoint });
  if (result.error) return res.status(result.status).json({ success: false, message: result.error });
  res.json({ success: true, data: { subscribed: false } });
}
