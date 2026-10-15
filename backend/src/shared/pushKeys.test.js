import { test } from "node:test";
import assert from "node:assert/strict";
import { valueOf, withPushKeys } from "./pushKeys.js";

const pair = { publicKey: "PUB123", privateKey: "PRIV456" };

test("a pair is added to an .env that has none, with a contact line to review", () => {
  const { text, changed } = withPushKeys("DB_HOST=127.0.0.1\nPORT=5000\n", pair);
  assert.equal(changed, true);
  assert.equal(valueOf(text, "VAPID_PUBLIC_KEY"), "PUB123");
  assert.equal(valueOf(text, "VAPID_PRIVATE_KEY"), "PRIV456");
  assert.equal(valueOf(text, "VAPID_SUBJECT"), "mailto:support@example.com");
  assert.match(text, /^DB_HOST=127\.0\.0\.1$/m, "what was there is untouched");
});

test("the empty lines from .env.example are filled in place, not repeated", () => {
  const example = "A=1\n\nVAPID_PUBLIC_KEY=\nVAPID_PRIVATE_KEY=\nVAPID_SUBJECT=mailto:me@company.com\n";
  const { text } = withPushKeys(example, pair);
  assert.equal((text.match(/^VAPID_PUBLIC_KEY=/gm) || []).length, 1);
  assert.equal(valueOf(text, "VAPID_PUBLIC_KEY"), "PUB123");
  assert.equal(valueOf(text, "VAPID_SUBJECT"), "mailto:me@company.com", "a contact someone set is kept");
});

test("an existing pair is never replaced: that would silence every registered phone", () => {
  const have = "VAPID_PUBLIC_KEY=OLDPUB\nVAPID_PRIVATE_KEY=OLDPRIV\n";
  const { text, changed } = withPushKeys(have, pair);
  assert.equal(changed, false);
  assert.equal(text, have);
});

test("half a pair is completed with a whole new one, so the two always match", () => {
  const { text, changed } = withPushKeys("VAPID_PUBLIC_KEY=ONLYPUB\n", pair);
  assert.equal(changed, true);
  assert.equal(valueOf(text, "VAPID_PUBLIC_KEY"), "PUB123");
  assert.equal(valueOf(text, "VAPID_PRIVATE_KEY"), "PRIV456");
});

test("running it twice changes nothing the second time", () => {
  const once = withPushKeys("PORT=5000", pair).text;
  assert.equal(withPushKeys(once, { publicKey: "OTHER", privateKey: "OTHER2" }).changed, false);
});
