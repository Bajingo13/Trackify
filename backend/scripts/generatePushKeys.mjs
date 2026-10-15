import webpush from "web-push";

// Prints a key pair for phone notifications. Put both lines in the .env at the repo
// root, and set VAPID_SUBJECT to a contact address (mailto:you@company.com) or your site's https address.
// Keep the private key secret, and do not change the pair later: phones registered with the old
// public key would stop receiving notices until their drivers turned notifications off and on again.
const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:support@example.com");
