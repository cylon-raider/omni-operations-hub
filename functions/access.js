// -----------------------------------------------------------------------------
// Who may call the HTTP functions
// -----------------------------------------------------------------------------
// requireApprovedUser: for the endpoints the hub's own pages call (upload a
// recording, Dentrix lookup, refresh buttons). Mirrors isApproved() in
// firestore.rules — a Firebase sign-in alone isn't enough, since anyone can
// create an account; the account must also be approved (or be an owner).
//
// webhookKeyMatches: for mangoWebhook, which Mango calls with no Firebase
// sign-in. The webhook URL configured in Mango carries a shared secret
// (`&key=...`), stored in Secret Manager as MANGO_WEBHOOK_SECRET.
// -----------------------------------------------------------------------------
const admin = require("firebase-admin");
const { createHash, timingSafeEqual } = require("crypto");

// Keep in sync with isOwnerEmail() in firestore.rules / storage.rules and
// OWNER_EMAILS in src/utils/payrollConstants.js.
const OWNER_EMAILS = ["luckyj5521@gmail.com", "cmarkel@gmail.com"];

/**
 * Verifies the request's Firebase ID token and that the account is approved.
 * On failure it sends the 401/403 response itself and returns null, so
 * callers just do: `const user = await requireApprovedUser(req, res); if (!user) return;`
 */
async function requireApprovedUser(req, res) {
    const authHeader = req.get("Authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) {
        res.status(401).json({ ok: false, error: "Sign-in required." });
        return null;
    }
    let user;
    try {
        user = await admin.auth().verifyIdToken(idToken);
    } catch {
        res.status(401).json({ ok: false, error: "Invalid or expired session — sign in again." });
        return null;
    }
    if (user.email && OWNER_EMAILS.includes(user.email)) return user;

    const profile = await admin.firestore().collection("users").doc(user.uid).get();
    if (profile.exists && profile.get("approved") === true) return user;

    res.status(403).json({ ok: false, error: "Your account is waiting for approval." });
    return null;
}

/**
 * True when the request carries the webhook secret, as `?key=` on the URL or
 * an `X-Webhook-Key` header. Compares hashes so neither timing nor length
 * reveals anything about the secret. An unset secret never matches.
 */
function webhookKeyMatches(req, expected) {
    if (!expected) return false;
    const rawKey = req.get("X-Webhook-Key") || req.query.key;
    const provided = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (typeof provided !== "string" || !provided) return false;
    const digest = (s) => createHash("sha256").update(s, "utf8").digest();
    return timingSafeEqual(digest(provided), digest(expected));
}

module.exports = { OWNER_EMAILS, requireApprovedUser, webhookKeyMatches };
