// -----------------------------------------------------------------------------
// Unscheduled treatment (Dentrix Ascend via Zatanna, read-only)
// -----------------------------------------------------------------------------
// Works out, for one patient, which planned treatment has no appointment yet:
//   * listTreatmentPlans          -> plans and their visits (completed flag)
//   * listTreatmentPlanProcedures -> each planned procedure (name, tooth, fee,
//                                    estimates, which plan visit it belongs to)
//   * listFutureAppointments      -> upcoming appointments, which list the plan
//                                    visits / procedures they will perform
// A procedure is "unscheduled" when it is still planned (status TREATMENT_PLAN,
// active, not expired) and neither its visit nor the procedure itself is on any
// upcoming appointment.
//
// Dentrix only exposes treatment plans per patient, so callers decide which
// patients to check (the huddle checks today's schedule; the follow-up list
// checks patients seen recently — see createTreatmentSync below).
// -----------------------------------------------------------------------------
const admin = require("firebase-admin");
const { ZATANNA_SESSIONS, zatanna, lookupPatientPhone } = require("./dentrix");

const MAX_PLANS = 20;

const idOf = (v) => (v == null ? null : String(v).split("/").pop());
const money = (v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

/** Visit ids and procedure ids that upcoming appointments will perform. */
function scheduledIdsFrom(appointments) {
    const visits = new Set();
    const procedures = new Set();
    for (const a of appointments || []) {
        if (a.cancelled || a.broken) continue;
        for (const v of a.additional_data?.visits || []) {
            if (v.id != null) visits.add(String(v.id));
            for (const p of v.procedures || []) if (p.id != null) procedures.add(String(p.id));
        }
        for (const p of a.additional_data?.patientProcedures || []) if (p?.id != null) procedures.add(String(p.id));
    }
    return { visits, procedures };
}

/** Keep only still-planned, active procedures that no upcoming appointment covers. */
function unscheduledProcedures(procedures, scheduled) {
    return procedures.filter((p) => {
        const status = p.status || p.additional_data?.status;
        if (status !== "TREATMENT_PLAN") return false;
        if (p.additional_data?.expired || p.additional_data?.state === "DELETED") return false;
        if (p.lifecycle_state && p.lifecycle_state !== "PENDING") return false;
        const visitId = idOf(p.additional_data?.visitId);
        if (visitId && scheduled.visits.has(visitId)) return false;
        if (scheduled.procedures.has(idOf(p.remote_id))) return false;
        return true;
    });
}

/** Group unscheduled procedures into a compact, display-ready summary (no clinical notes). */
function summarize(procs) {
    const items = procs.map((p) => ({
        code: p.procedure_code || p.additional_data?.code || null,
        description: p.description || p.additional_data?.description || "Procedure",
        tooth: p.tooth || null,
        fee: money(p.total_fee ?? p.fee_amount),
        patientEstimate: money(p.patient_estimate),
        visitId: idOf(p.additional_data?.visitId),
        plannedAt: p.additional_data?.serviceDate ? new Date(p.additional_data.serviceDate).toISOString().slice(0, 10) : null,
    }));
    const totalFee = items.reduce((s, i) => s + i.fee, 0);
    const totalPatientEstimate = items.reduce((s, i) => s + i.patientEstimate, 0);
    const plannedDates = items.map((i) => i.plannedAt).filter(Boolean).sort();
    return {
        count: items.length,
        totalFee: Math.round(totalFee * 100) / 100,
        totalPatientEstimate: Math.round(totalPatientEstimate * 100) / 100,
        oldestPlannedAt: plannedDates[0] || null,
        procedures: items.slice(0, 25),
    };
}

/**
 * Unscheduled treatment for one patient. `extraAppointments` lets a caller that
 * already has today's appointments count them as scheduled too.
 */
async function unscheduledTreatmentFor(apiKey, sessionId, patientId, { extraAppointments = [] } = {}) {
    const plansData = await zatanna(apiKey, sessionId, "listTreatmentPlans", { contact: patientId, page_size: MAX_PLANS });
    const plans = (plansData.treatment_plans || []).filter((tp) =>
        (tp.phases || tp.additional_data?.visits || []).some((v) => !(v.additional_data?.completed ?? v.completed)));
    if (!plans.length) return summarize([]);

    const futureData = await zatanna(apiKey, sessionId, "listFutureAppointments", { contact: patientId, page_size: 100 });
    const scheduled = scheduledIdsFrom([...(futureData.appointments || []), ...extraAppointments]);

    const procedures = [];
    for (const plan of plans) {
        const data = await zatanna(apiKey, sessionId, "listTreatmentPlanProcedures", {
            contact: patientId, treatmentPlan: plan.remote_id, page_size: 200,
        });
        procedures.push(...(data.procedures || []));
    }
    return summarize(unscheduledProcedures(procedures, scheduled));
}

// ---------------------------------------------------------------------------
// Follow-up list: artifacts/{appId}/public/data/unscheduled_treatment/{office}_{patientId}
// ---------------------------------------------------------------------------
const TIME_ZONE = "America/Phoenix";
const clinicDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const addDays = (date, n) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

const MIN_FEE = 1;                 // ignore $0 leftovers
const RECHECK_AFTER_DAYS = 7;
const RECHECK_PER_RUN = 60;
const BACKFILL_DAYS_DEFAULT = 180;
const CONCURRENCY = 4;

async function listAppointmentsOn(apiKey, sessionId, date) {
    const out = [];
    let pageToken;
    for (let guard = 0; guard < 10; guard++) {
        const data = await zatanna(apiKey, sessionId, "listAppointments", {
            sync_mode: "enhanced",
            filter: `start_time>='${date}' AND start_time<='${date}'`,
            page_size: 500,
            ...(pageToken ? { page_token: pageToken } : {}),
        });
        out.push(...(data.appointments || []));
        pageToken = data.next_page_token;
        if (!pageToken || !(data.appointments || []).length) break;
    }
    return out;
}

async function pool(items, worker, { concurrency = CONCURRENCY, deadline = Infinity } = {}) {
    let next = 0;
    let done = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < items.length && Date.now() < deadline) {
            const item = items[next++];
            try { await worker(item); done++; } catch (err) { console.warn("[treatment]", err.message); }
        }
    }));
    return done;
}

function createTreatmentSync({ db, appId }) {
    const col = db.collection("artifacts").doc(appId).collection("public").doc("data").collection("unscheduled_treatment");
    const stateCol = db.collection("treatment_state");
    const ts = () => admin.firestore.FieldValue.serverTimestamp();

    /** Re-evaluate one patient and upsert / clear their follow-up row. */
    async function checkPatient(apiKey, office, patient) {
        const sessionId = ZATANNA_SESSIONS[office];
        const ref = col.doc(`${office}_${patient.id}`);
        const summary = await unscheduledTreatmentFor(apiKey, sessionId, patient.id);
        const prev = (await ref.get()).data();
        if (summary.count === 0 || summary.totalFee < MIN_FEE) {
            if (prev && !prev.cleared) await ref.set({ cleared: true, clearedAt: ts(), checkedAt: ts(), count: 0 }, { merge: true });
            return "clear";
        }
        let phone = prev?.phone || null;
        if (!phone) phone = await lookupPatientPhone(apiKey, sessionId, patient.id).catch(() => null);
        await ref.set({
            office,
            patientId: patient.id,
            patientName: patient.name || prev?.patientName || "Unknown patient",
            phone,
            lastSeen: [prev?.lastSeen, patient.seenOn].filter(Boolean).sort().pop() || null,
            ...summary,
            cleared: false,
            checkedAt: ts(),
            ...(prev ? {} : { firstSeenAt: ts() }),
        }, { merge: true });
        return "listed";
    }

    /** Patients who had a (non-cancelled, non-broken) appointment on `date`. */
    async function patientsSeenOn(apiKey, office, date) {
        const appts = await listAppointmentsOn(apiKey, ZATANNA_SESSIONS[office], date);
        const byId = new Map();
        for (const a of appts) {
            if (a.cancelled || a.broken) continue;
            const id = a.contact?.remote_id || idOf(a.contact_id);
            if (!id) continue;
            byId.set(id, { id, name: a.contact?.display_name || [a.contact?.given_name, a.contact?.family_name].filter(Boolean).join(" "), seenOn: date });
        }
        return [...byId.values()];
    }

    /**
     * Nightly: today's patients, then older rows due a re-check, then the
     * backfill walking back day by day until BACKFILL_DAYS ago.
     */
    async function run(apiKey, { backfillDays = BACKFILL_DAYS_DEFAULT, budgetMs = 7.5 * 60e3, offices = Object.keys(ZATANNA_SESSIONS) } = {}) {
        const started = Date.now();
        const deadline = started + budgetMs;
        const today = clinicDate(started);
        const results = {};
        for (const office of offices) {
            const r = results[office] = { today: 0, rechecked: 0, backfillDays: 0, listed: 0, cleared: 0 };
            const tally = (out) => { if (out === "listed") r.listed++; else if (out === "clear") r.cleared++; };
            try {
                const todays = await patientsSeenOn(apiKey, office, today);
                r.today = await pool(todays, async (p) => tally(await checkPatient(apiKey, office, p)), { deadline });

                const cutoff = admin.firestore.Timestamp.fromMillis(started - RECHECK_AFTER_DAYS * 86400e3);
                const stale = (await col.where("office", "==", office).get()).docs
                    .map((d) => d.data())
                    .filter((d) => !d.cleared && (!d.checkedAt?.toMillis || d.checkedAt.toMillis() < cutoff.toMillis()))
                    .slice(0, RECHECK_PER_RUN);
                r.rechecked = await pool(stale, async (d) => tally(await checkPatient(apiKey, office, { id: d.patientId, name: d.patientName })), { deadline });

                const stateRef = stateCol.doc(`backfill_${office}`);
                const state = (await stateRef.get()).data() || {};
                let cursor = state.cursor || addDays(today, -1); // walk backwards
                const stopAt = addDays(today, -backfillDays);
                while (cursor >= stopAt && Date.now() < deadline - 60e3) {
                    const patients = await patientsSeenOn(apiKey, office, cursor);
                    await pool(patients, async (p) => tally(await checkPatient(apiKey, office, p)), { deadline });
                    if (Date.now() >= deadline) break; // day not finished: redo it next run
                    cursor = addDays(cursor, -1);
                    r.backfillDays++;
                }
                await stateRef.set({ cursor, stopAt, updatedAt: ts() }, { merge: true });
            } catch (err) {
                console.warn(`[treatment] ${office} failed:`, err.message);
                r.error = err.message;
            }
        }
        console.log(`[treatment] run in ${Math.round((Date.now() - started) / 1000)}s:`, JSON.stringify(results));
        return results;
    }

    return { run, checkPatient };
}

module.exports = {
    unscheduledTreatmentFor,
    scheduledIdsFrom,
    unscheduledProcedures,
    summarize,
    createTreatmentSync,
    listAppointmentsOn,
    clinicDate,
    addDays,
    pool,
};
