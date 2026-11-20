// -----------------------------------------------------------------------------
// Appointment confirmations board (Dentrix Ascend via Zatanna, read-only)
// -----------------------------------------------------------------------------
// Keeps a Firestore list of upcoming appointments that are NOT confirmed in
// Dentrix, so the front desk can work them as a call list in the hub.
//
// Staff still confirm in Dentrix itself — the hub never writes to Dentrix. Each
// sync re-reads the appointments, so a row flips to "confirmed" on its own
// within one sync after someone confirms it there (or the patient replies to a
// reminder text). Rows for appointments that were cancelled, broken or moved
// out of the window are flagged `gone`.
//
// Docs: artifacts/{appId}/public/data/confirmations/{office}_{appointmentId}
//   Dentrix fields (written here): patient, time, provider, description, phone,
//     confirmed, textsSent, ...
//   Staff fields (written by the app, never touched here): outreach { status, note, by, at }
// -----------------------------------------------------------------------------
const admin = require("firebase-admin");
const { ZATANNA_SESSIONS, zatanna } = require("./dentrix");

const TIME_ZONE = "America/Phoenix";
const DAYS_AHEAD = 3;            // today + the next 3 days
const KEEP_PAST_DAYS = 14;       // delete rows for appointments older than this
const CONTACT_CONCURRENCY = 4;

/** YYYY-MM-DD in the clinic's time zone. */
function clinicDate(ms) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date(ms));
}

/** The clinic-local dates covered by one sync: [today, ..., today + DAYS_AHEAD]. */
function windowDates(nowMs, daysAhead = DAYS_AHEAD) {
    const dates = [];
    for (let i = 0; i <= daysAhead; i++) dates.push(clinicDate(nowMs + i * 86400e3));
    return [...new Set(dates)];
}

function primaryPhone(contact) {
    if (!contact) return null;
    return contact.primary_phone_number
        || contact.phone_numbers?.find((p) => p.type === "MOBILE")?.number
        || contact.phone_numbers?.[0]?.number
        || contact.additional_data?.phone
        || null;
}

/** The fields we keep from one Dentrix appointment (no notes, procedures or other clinical detail). */
function appointmentFields(appt, office) {
    const wall = (appt.wall_start_time || "").replace(" ", "T");
    return {
        office,
        appointmentId: appt.remote_id,
        patientId: appt.contact?.remote_id || String(appt.contact_id || "").split("/").pop() || null,
        patientName: appt.contact?.display_name
            || [appt.contact?.given_name, appt.contact?.family_name].filter(Boolean).join(" ")
            || "Unknown patient",
        date: wall.slice(0, 10) || clinicDate(Date.parse(appt.start_time)),
        wallStartTime: wall || null,
        startTime: appt.start_time || null,
        durationMinutes: appt.duration_minutes || appt.additional_data?.duration || null,
        provider: appt.providers?.[0]?.display_name || null,
        operatory: appt.resources?.find((r) => r.type === "OPERATORY")?.display_name || null,
        description: appt.short_description || null,
        confirmationStatus: appt.confirmation_status || appt.status || null,
        confirmed: appt.confirmed === true,
        textsSent: (appt.additional_data?.communications || []).filter((c) => c.type === "TEXT").length,
        isNewPatient: appt.is_new_patient === true,
    };
}

async function listAppointmentsForDates(apiKey, sessionId, firstDate, lastDate) {
    const appointments = [];
    let pageToken;
    for (let guard = 0; guard < 20; guard++) {
        const data = await zatanna(apiKey, sessionId, "listAppointments", {
            sync_mode: "enhanced",
            filter: `start_time>='${firstDate}' AND start_time<='${lastDate}'`,
            page_size: 500,
            ...(pageToken ? { page_token: pageToken } : {}),
        });
        appointments.push(...(data.appointments || []));
        pageToken = data.next_page_token;
        if (!pageToken || !(data.appointments || []).length) break;
    }
    return appointments;
}

function createConfirmationsSync({ db, appId }) {
    const col = db.collection("artifacts").doc(appId).collection("public").doc("data").collection("confirmations");
    const ts = () => admin.firestore.FieldValue.serverTimestamp();

    async function syncOffice(apiKey, office, nowMs) {
        const sessionId = ZATANNA_SESSIONS[office];
        const dates = windowDates(nowMs);
        const first = dates[0];
        const last = dates[dates.length - 1];

        const appointments = await listAppointmentsForDates(apiKey, sessionId, first, last);
        const existingSnap = await col.where("office", "==", office).get();
        const existing = new Map(existingSnap.docs.map((d) => [d.id, d]));

        const seen = new Set();
        const toWrite = []; // [docId, fields, needsPhone]
        for (const appt of appointments) {
            if (!appt.remote_id) continue;
            const id = `${office}_${appt.remote_id}`;
            const fields = appointmentFields(appt, office);
            if (fields.date < first || fields.date > last) continue;
            if (appt.cancelled || appt.broken) continue; // treated as gone below
            seen.add(id);
            const prev = existing.get(id)?.data();
            // Only track appointments that are (or were, while on the list) unconfirmed.
            if (fields.confirmed && !prev) continue;
            if (fields.confirmed && !prev.confirmed) fields.confirmedAt = ts();
            toWrite.push([id, fields, !prev?.phone && !fields.confirmed]);
        }

        // Phone numbers: one contact lookup per newly listed patient.
        let next = 0;
        async function worker() {
            while (next < toWrite.length) {
                const entry = toWrite[next++];
                if (!entry[2] || !entry[1].patientId) continue;
                try {
                    const data = await zatanna(apiKey, sessionId, "getContact", { contact: entry[1].patientId });
                    entry[1].phone = primaryPhone(data.contact || data);
                } catch (err) {
                    console.warn(`[confirmations] ${office}: contact lookup failed:`, err.message);
                }
            }
        }
        await Promise.all(Array.from({ length: CONTACT_CONCURRENCY }, worker));

        const writer = db.bulkWriter();
        let added = 0;
        let nowConfirmed = 0;
        for (const [id, fields] of toWrite) {
            const prev = existing.get(id)?.data();
            if (!prev) added++;
            if (fields.confirmedAt) nowConfirmed++;
            writer.set(col.doc(id), { ...fields, gone: false, syncedAt: ts(), ...(prev ? {} : { firstSeenAt: ts() }) }, { merge: true });
        }
        // Rows in the window that Dentrix no longer lists (cancelled, broken, moved away).
        const cutoff = clinicDate(nowMs - KEEP_PAST_DAYS * 86400e3);
        for (const [id, doc] of existing) {
            const d = doc.data();
            if (d.date < cutoff) { writer.delete(doc.ref); continue; }
            if (d.date >= first && d.date <= last && !seen.has(id) && !d.gone) {
                writer.set(doc.ref, { gone: true, syncedAt: ts() }, { merge: true });
            }
        }
        await writer.close();

        await db.collection("confirmations_state").doc(office).set({
            lastSyncedAt: ts(), first, last,
            unconfirmed: toWrite.filter(([, f]) => !f.confirmed).length,
        }, { merge: true });
        return { office, appointments: appointments.length, unconfirmed: toWrite.filter(([, f]) => !f.confirmed).length, added, nowConfirmed };
    }

    async function run(apiKey, offices = Object.keys(ZATANNA_SESSIONS)) {
        const nowMs = Date.now();
        const results = [];
        for (const office of offices) {
            try {
                results.push(await syncOffice(apiKey, office, nowMs));
            } catch (err) {
                console.warn(`[confirmations] ${office} failed:`, err.message);
                results.push({ office, error: err.message });
            }
        }
        console.log("[confirmations] sync:", JSON.stringify(results));
        return results;
    }

    return { run, syncOffice };
}

module.exports = { createConfirmationsSync, appointmentFields, windowDates, clinicDate, primaryPhone };
