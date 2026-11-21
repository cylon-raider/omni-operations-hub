// -----------------------------------------------------------------------------
// Morning huddle (Dentrix Ascend via Zatanna, read-only)
// -----------------------------------------------------------------------------
// One document per office per day — artifacts/{appId}/public/data/huddles/{office}_{date}
// — listing every scheduled patient with the things a morning huddle covers:
//   unconfirmed · new patient · balance due · insurance not (recently) verified ·
//   unscheduled treatment (a same-day opportunity) · lab case not back · premed.
// Built at 5:30am and 12:30pm for today and tomorrow, and on demand.
//
// Kept deliberately small: balance totals only (no ledger lines), insurance
// status + date only, treatment totals and procedure names only, no notes.
// -----------------------------------------------------------------------------
const admin = require("firebase-admin");
const { ZATANNA_SESSIONS, zatanna } = require("./dentrix");
const { unscheduledTreatmentFor, listAppointmentsOn, clinicDate, addDays, pool } = require("./treatment");

const VERIFY_STALE_DAYS = 30;
// Patients processed at once. Each one fans out to ~3 Dentrix calls in parallel,
// so 3 here is ~9 concurrent requests per office — more than that slowed
// Dentrix to 7-13s per call and produced server errors in production.
const CONCURRENCY = 3;

const idOf = (v) => (v == null ? null : String(v).split("/").pop());
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Insurance verification -> { status, verifiedAt, needsVerification }. */
function insuranceState(v, nowMs) {
    if (!v) return { status: "NONE", verifiedAt: null, needsVerification: false }; // no coverage on file
    const verifiedAt = v.verified_at || null;
    const ageDays = verifiedAt ? (nowMs - Date.parse(verifiedAt)) / 86400e3 : Infinity;
    const status = v.status || "UNKNOWN";
    return { status, verifiedAt, needsVerification: status !== "ELIGIBLE" || ageDays > VERIFY_STALE_DAYS };
}

/** Fields taken straight from the appointment. */
function appointmentFlags(appt) {
    const ad = appt.additional_data || {};
    const lab = ad.labCase;
    return {
        appointmentId: appt.remote_id,
        wallStartTime: (appt.wall_start_time || "").replace(" ", "T") || null,
        durationMinutes: appt.duration_minutes || ad.duration || null,
        provider: appt.providers?.[0]?.display_name || null,
        operatory: appt.resources?.find((r) => r.type === "OPERATORY")?.display_name || null,
        description: appt.short_description || null,
        confirmed: appt.confirmed === true,
        completed: appt.completed === true,
        isNewPatient: appt.is_new_patient === true,
        premed: ad.needsPremedicate === true,
        asap: ad.ASAP === true || appt.sooner_if_possible === true,
        scheduledProduction: round2(ad.productionAmount),
        labCase: lab ? {
            lab: lab.dentalLab?.name || null,
            status: lab.status || null,
            dueDate: lab.dueDate ? new Date(lab.dueDate).toISOString().slice(0, 10) : null,
            notBack: lab.status !== "RECEIVED",
        } : null,
    };
}

function createHuddleSync({ db, appId }) {
    const col = db.collection("artifacts").doc(appId).collection("public").doc("data").collection("huddles");
    const ts = () => admin.firestore.FieldValue.serverTimestamp();

    async function patientDetails(apiKey, sessionId, patientId, dayAppointments, nowMs) {
        const [billing, verification, treatment] = await Promise.all([
            zatanna(apiKey, sessionId, "getPatientBilling", { contact: patientId }).catch(() => null),
            zatanna(apiKey, sessionId, "getInsuranceVerification", { contact: patientId, coverageRole: "PRIMARY" }).catch(() => null),
            unscheduledTreatmentFor(apiKey, sessionId, patientId, { extraAppointments: dayAppointments }).catch(() => null),
        ]);
        const aging = billing?.aging || {};
        return {
            balance: billing ? {
                patient: round2(aging.patient_total),
                insurance: round2(aging.insurance_total),
                total: round2(aging.grand_total ?? aging.total),
                patientOver90: round2(aging.patient_over_90),
            } : null,
            insurance: insuranceState(verification, nowMs),
            unscheduled: treatment ? {
                count: treatment.count,
                totalFee: treatment.totalFee,
                totalPatientEstimate: treatment.totalPatientEstimate,
                procedures: treatment.procedures.slice(0, 8).map((p) => ({ description: p.description, tooth: p.tooth, fee: p.fee })),
            } : null,
        };
    }

    async function buildDay(apiKey, office, date, { deadline = Infinity } = {}) {
        const sessionId = ZATANNA_SESSIONS[office];
        const nowMs = Date.now();
        const ref = col.doc(`${office}_${date}`);
        // Lets the page show "Building…" (and keeps any previous result visible meanwhile).
        await ref.set({ office, date, building: true, buildStartedAt: ts() }, { merge: true });
        const appts = (await listAppointmentsOn(apiKey, sessionId, date)).filter((a) => !a.cancelled && !a.broken);

        // One row per patient (their first appointment of the day).
        const rows = new Map();
        const apptsByPatient = new Map();
        for (const a of appts) {
            const pid = a.contact?.remote_id || idOf(a.contact_id);
            if (!pid) continue;
            if (!apptsByPatient.has(pid)) apptsByPatient.set(pid, []);
            apptsByPatient.get(pid).push(a);
            if (rows.has(pid)) continue;
            rows.set(pid, {
                patientId: pid,
                patientName: a.contact?.display_name || [a.contact?.given_name, a.contact?.family_name].filter(Boolean).join(" ") || "Unknown patient",
                ...appointmentFlags(a),
            });
        }

        await pool([...rows.values()], async (row) => {
            Object.assign(row, await patientDetails(apiKey, sessionId, row.patientId, apptsByPatient.get(row.patientId), nowMs));
        }, { concurrency: CONCURRENCY, deadline });

        const patients = [...rows.values()].sort((a, b) => (a.wallStartTime || "").localeCompare(b.wallStartTime || ""));
        const sum = (f) => round2(patients.reduce((s, p) => s + (f(p) || 0), 0));
        const totals = {
            patients: patients.length,
            unconfirmed: patients.filter((p) => !p.confirmed).length,
            newPatients: patients.filter((p) => p.isNewPatient).length,
            balanceDue: patients.filter((p) => (p.balance?.patient || 0) > 0).length,
            balanceDueAmount: sum((p) => Math.max(0, p.balance?.patient || 0)),
            insuranceToVerify: patients.filter((p) => p.insurance?.needsVerification).length,
            unscheduledTreatment: patients.filter((p) => (p.unscheduled?.count || 0) > 0).length,
            unscheduledTreatmentAmount: sum((p) => p.unscheduled?.totalFee),
            labCasesNotBack: patients.filter((p) => p.labCase?.notBack).length,
            premed: patients.filter((p) => p.premed).length,
            scheduledProduction: sum((p) => p.scheduledProduction),
            incomplete: patients.filter((p) => !p.balance && !p.insurance && !p.unscheduled).length,
        };
        await ref.set({ office, date, patients, totals, generatedAt: ts(), building: false, buildError: null });
        return { office, date, ...totals };
    }

    /** Build one office's huddles for the given clinic dates, one after another. */
    async function buildDays(apiKey, office, dates, { budgetMs = 8 * 60e3 } = {}) {
        const started = Date.now();
        const deadline = started + budgetMs;
        const results = [];
        for (const date of dates) {
            if (Date.now() > deadline - 30e3) {
                results.push({ office, date, skipped: "out of time" });
                continue;
            }
            try {
                results.push(await buildDay(apiKey, office, date, { deadline }));
            } catch (err) {
                console.warn(`[huddle] ${office} ${date} failed:`, err.message);
                await col.doc(`${office}_${date}`).set({ building: false, buildError: err.message.slice(0, 300) }, { merge: true }).catch(() => {});
                results.push({ office, date, error: err.message });
            }
        }
        console.log(`[huddle] ${office} built in ${Math.round((Date.now() - started) / 1000)}s:`, JSON.stringify(results));
        return results;
    }

    /** Today + tomorrow (clinic time) as YYYY-MM-DD. */
    const upcomingDates = (nowMs = Date.now()) => [clinicDate(nowMs), addDays(clinicDate(nowMs), 1)];

    return { buildDay, buildDays, upcomingDates };
}

module.exports = { createHuddleSync, insuranceState, appointmentFlags };
