// -----------------------------------------------------------------------------
// Dentrix Ascend patient lookup (via Zatanna)
// -----------------------------------------------------------------------------
// When a call is logged, we look up the *other party's* phone number in that
// office's Dentrix Ascend and attach who the patient is and when their next
// appointment is, so staff see it on the call card without opening Dentrix.
//
// Zatanna (api.zatanna.ai) keeps a logged-in Dentrix Ascend session per office
// and exposes Dentrix operations as a REST API. We ONLY call read-only
// operations here (searchContacts, listFutureAppointments) — the API key can
// also write to Dentrix, but nothing in the hub should ever need that.
//
// The key lives in Secret Manager as ZATANNA_API_KEY (never in the repo):
//   firebase functions:secrets:set ZATANNA_API_KEY
//
// What we store on the call doc is deliberately minimal (name, chart number,
// status, next appointment) — no birth dates, addresses, insurance, or SSNs.
// -----------------------------------------------------------------------------
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const ZATANNA_API_KEY = defineSecret("ZATANNA_API_KEY");

const ZATANNA_API_BASE = process.env.ZATANNA_API_BASE || "https://api.zatanna.ai/v1/integrations";

// One Zatanna session (a logged-in Dentrix Ascend connection) per office.
// These are identifiers, not credentials — the API key is what grants access.
// Override with ZATANNA_SESSION_GLENDALE / ZATANNA_SESSION_LITCHFIELD if an
// office is ever reconnected and gets a new session id.
const ZATANNA_SESSIONS = {
    glendale: process.env.ZATANNA_SESSION_GLENDALE || "98e5e457-facc-56f0-9b04-12710e2c1cf1",
    litchfield: process.env.ZATANNA_SESSION_LITCHFIELD || "4f9416cd-535e-547a-97fb-fc9c77ebaeca",
};

const REQUEST_TIMEOUT_MS = 20000;
const MAX_PATIENTS = 3; // a household often shares one number; show at most this many

// Mango's placeholder when it has no caller number — never look that up.
const PLACEHOLDER_NUMBERS = new Set(["5550000000"]);

/** Reduce any phone format ("+1 (602) 555-0100", "16025550100") to 10 digits, or null. */
function normalizePhone(raw) {
    if (!raw) return null;
    let digits = String(raw).replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length !== 10 || PLACEHOLDER_NUMBERS.has(digits)) return null;
    return digits;
}

/** The number to look up: the patient's side of the call, not our office line. */
function externalNumberFor({ direction, fromNumber, toNumber }) {
    return direction === "outbound" ? toNumber : fromNumber;
}

/**
 * Pull the payload out of a Zatanna response. Zatanna's REST API wraps results
 * differently from what its docs/MCP show, and not the same way for every
 * integration, so accept every documented envelope (possibly nested):
 *   { kind: "success", data }      { result: { ok: true, value } }      { ok: true, value }
 * Returns { ok: true, data } or { ok: false, reason, stepUp }.
 */
function unwrapZatanna(json) {
    let node = json;
    for (let depth = 0; depth < 4 && node && typeof node === "object"; depth++) {
        if (node.kind === "success") {
            node = node.data ?? {};
            continue;
        }
        if (node.result && typeof node.result === "object") {
            node = node.result;
            continue;
        }
        if (node.ok === true && "value" in node) {
            node = node.value ?? {};
            continue;
        }
        if (node.ok === false || (node.kind && node.kind !== "success")) {
            const stepUp = node.state === "step_up_required";
            const reason = node.error?.message || (typeof node.error === "string" ? node.error : null) || node.state || node.kind || "unknown error";
            return { ok: false, reason, stepUp };
        }
        break;
    }
    if (!node || typeof node !== "object") return { ok: false, reason: "empty response" };
    return { ok: true, data: node };
}

async function zatanna(apiKey, sessionId, operation, body) {
    const res = await fetch(`${ZATANNA_API_BASE}/${encodeURIComponent(sessionId)}/execute/${operation}`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    const out = res.ok && json ? unwrapZatanna(json) : null;
    // 202 / step_up_required = the vendor asked for a verification code and the
    // call is paused waiting for a human to answer it in Zatanna.
    if (res.status === 202 || out?.stepUp) {
        throw new Error("Login needs a verification code — check the Zatanna dashboard.");
    }
    if (!out || !out.ok) {
        const msg = out?.reason || json?.error?.message || json?.error || res.statusText;
        // Shape hint (keys only, never values) so an unexpected envelope is diagnosable from logs.
        const shape = json && typeof json === "object" ? ` [response keys: ${Object.keys(json).join(",")}]` : "";
        throw new Error(`Zatanna ${operation} failed (${res.status}): ${String(msg).slice(0, 200)}${shape}`);
    }
    return out.data;
}

/** Earliest upcoming appointment that isn't cancelled / broken, or null. */
async function nextAppointmentFor(apiKey, sessionId, contactId) {
    const data = await zatanna(apiKey, sessionId, "listFutureAppointments", {
        contact: contactId,
        page_size: 20,
    });
    const now = Date.now();
    const upcoming = (data.appointments || [])
        .filter((a) => !a.cancelled && !a.broken && a.start_time && Date.parse(a.start_time) >= now)
        .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    const appt = upcoming[0];
    if (!appt) return null;
    return {
        startTime: appt.start_time,                // absolute (UTC / offset)
        wallStartTime: appt.wall_start_time || null, // clinic-local, for display
        description: appt.short_description || null,
        confirmed: appt.confirmed === true,
    };
}

/**
 * A patient's best phone number (primary, else mobile, else first). Note that
 * getContact returns the whole chart; only the number is kept.
 */
async function lookupPatientPhone(apiKey, sessionId, patientId) {
    const data = await zatanna(apiKey, sessionId, "getContact", { contact: patientId });
    const c = data.contact || data;
    return c.primary_phone_number
        || c.phone_numbers?.find((p) => p.type === "MOBILE")?.number
        || c.phone_numbers?.[0]?.number
        || c.additional_data?.phone
        || null;
}

/**
 * Look up a phone number in one office's Dentrix. Returns the object stored on
 * the call doc as `dentrix`. Never throws — failures come back as status "error".
 */
async function lookupPatientByPhone(apiKey, location, rawPhone) {
    const base = { lookedUpAt: admin.firestore.FieldValue.serverTimestamp() };
    const phone = normalizePhone(rawPhone);
    if (!phone) return { ...base, status: "skipped", reason: "No usable caller number." };

    const office = (location || "glendale").toLowerCase();
    const sessionId = ZATANNA_SESSIONS[office];
    if (!sessionId) return { ...base, status: "skipped", reason: `No Dentrix connection for "${office}".` };

    try {
        const data = await zatanna(apiKey, sessionId, "searchContacts", { phone, page_size: 10 });
        const contacts = (data.contacts || []).filter((c) => c.remote_id);
        if (contacts.length === 0) return { ...base, status: "none", matchCount: 0, patients: [] };

        const patients = await Promise.all(contacts.slice(0, MAX_PATIENTS).map(async (c) => {
            let nextAppointment = null;
            try {
                nextAppointment = await nextAppointmentFor(apiKey, sessionId, c.remote_id);
            } catch (err) {
                console.warn(`Dentrix appointment lookup failed for contact ${c.remote_id}:`, err.message);
            }
            const first = c.preferred_name || c.given_name || "";
            return {
                id: c.remote_id,
                name: [first, c.family_name].filter(Boolean).join(" ") || c.display_name || "Unknown",
                chartNumber: c.chart_id || c.additional_data?.chartNumber || null,
                state: c.state || null,
                isNewPatient: c.is_new_patient === true || c.state === "NEW_PATIENT",
                nextAppointment,
            };
        }));

        return {
            ...base,
            status: contacts.length === 1 ? "matched" : "multiple",
            matchCount: contacts.length,
            patients,
        };
    } catch (err) {
        // Log only the error, never the number — keeps PHI out of Cloud Logging.
        console.warn(`Dentrix lookup failed (${office}):`, err.message);
        return { ...base, status: "error", reason: err.message.slice(0, 300) };
    }
}

/** Look up a call's other party and write the result onto the call doc. */
async function enrichCallWithDentrix(callRef, apiKey, { location, direction, fromNumber, toNumber }) {
    if (!apiKey || direction === "internal") return null;
    const dentrix = await lookupPatientByPhone(apiKey, location, externalNumberFor({ direction, fromNumber, toNumber }));
    await callRef.set({ dentrix }, { merge: true });
    return dentrix;
}

module.exports = {
    ZATANNA_API_KEY,
    ZATANNA_SESSIONS,
    zatanna,
    unwrapZatanna,
    lookupPatientPhone,
    enrichCallWithDentrix,
    lookupPatientByPhone,
    normalizePhone,
    externalNumberFor,
};
