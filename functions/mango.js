// -----------------------------------------------------------------------------
// Mango Voice recordings via Zatanna
// -----------------------------------------------------------------------------
// Since 2026-10-13 Mango's webhook no longer includes recording_url, so calls
// reach the hub without audio. Zatanna keeps a logged-in Mango Voice session per
// office and its `getCall` operation returns a signed recording URL (valid ~1h).
//
// This module finds Mango calls that should have a transcript, matches each one
// to the call doc the webhook already created (by the outside party's phone
// number + time), and runs the existing transcribe -> analyze pipeline on it.
//
// Two passes share one scheduled function (see syncMangoRecordings in index.js):
//   * ongoing  — the last few hours, every run, so new calls fill in within minutes.
//   * backfill — walks forward from MANGO_BACKFILL_SINCE in 6-hour windows,
//                controlled by MANGO_BACKFILL in functions/.env:
//                  off   (default) do nothing
//                  count  tally eligible calls + minutes (no OpenAI spend), see logs
//                  run    transcribe them, a batch per run
//
// Only read-only Zatanna operations are used (listCalls, getCall). Progress is
// tracked in Firestore (mango_sync_calls / mango_sync_state) so nothing is
// transcribed twice and a run can stop anywhere and resume.
// -----------------------------------------------------------------------------
const admin = require("firebase-admin");
const { normalizePhone, unwrapZatanna } = require("./dentrix");

const ZATANNA_API_BASE = process.env.ZATANNA_API_BASE || "https://api.zatanna.ai/v1/integrations";

// One Zatanna Mango Voice session per office (identifiers, not credentials).
// Litchfield's Mango account is named "Chewy Dental, LLC".
const MANGO_SESSIONS = {
    glendale: process.env.MANGO_SESSION_GLENDALE || "8aa000ed-86e2-565d-a10c-a4260d9442c9",
    litchfield: process.env.MANGO_SESSION_LITCHFIELD || "1af473b2-a4c6-5aa0-92db-711ba64c03f9",
};

const MIN_DURATION_SECONDS = 25;        // answered calls: same cutoff the webhook uses
const MIN_VOICEMAIL_SECONDS = 5;        // voicemails: even a short message matters
const HANGUP_SECONDS = 5;               // missed calls shorter than this are hang-ups, not callbacks
const RETURN_MIN_SECONDS = 20;          // an outbound call this long counts as returning a missed call
const RETURN_LOOKBACK_MS = 7 * 24 * 3600e3;
const ONGOING_LOOKBACK_MS = 3 * 3600e3; // ongoing pass covers the last 3 hours
const SETTLE_MS = 2 * 60e3;             // let a call settle (webhook + recording) before touching it
const UNMATCHED_GIVE_UP_MS = 30 * 60e3; // ongoing: stop retrying a match after 30 min
const BACKFILL_WINDOW_MS = 6 * 3600e3;
const MATCH_BEFORE_MS = 10 * 60e3;      // hub createdAt may be at call start or end:
const MATCH_AFTER_MS = 40 * 60e3;       // allow [start - 10m, end + 40m]
const MAX_ATTEMPTS = 3;
const STAFF_STATUSES = ["In Progress", "Resolved"]; // never reset what staff set by hand
const REQUEST_TIMEOUT_MS = 30000;

// Sync statuses that mean "never look at this call again".
const FINAL_STATUSES = new Set(["done", "has_transcript", "labeled", "no_recording", "unmatched", "ineligible"]);

// ---------------------------------------------------------------------------
// Zatanna
// ---------------------------------------------------------------------------
async function mango(apiKey, sessionId, operation, body) {
    const res = await fetch(`${ZATANNA_API_BASE}/${encodeURIComponent(sessionId)}/execute/${operation}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    const out = res.ok && json ? unwrapZatanna(json) : null;
    if (!out || !out.ok) {
        const why = out?.reason || json?.error?.message || res.statusText;
        const shape = json && typeof json === "object" ? ` [response keys: ${Object.keys(json).join(",")}]` : "";
        throw new Error(`Zatanna mangovoice.${operation} failed (${res.status}): ${String(why).slice(0, 200)}${shape}`);
    }
    return out.data;
}

/** Every call that started inside [after, before), all pages. */
async function listCallsBetween(apiKey, sessionId, afterMs, beforeMs) {
    const calls = [];
    for (let offset = 0, guard = 0; guard < 100; guard++) {
        const page = await mango(apiKey, sessionId, "listCalls", {
            startedAfter: new Date(afterMs).toISOString(),
            startedBefore: new Date(beforeMs).toISOString(),
            limit: 100,
            offset,
        });
        calls.push(...(page.items || []));
        if (!page.hasMore || !page.items?.length) break;
        offset = page.nextOffset ?? offset + page.items.length;
    }
    return calls;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** "voicemail" (has a message to transcribe), "missed" (no message: needs a callback) or "answered". */
function callKind(call) {
    if (call.voicemailId) return "voicemail";
    if (call.isMissed) return "missed";
    return "answered";
}

/** Should the hub act on this Mango call? Returns null if yes, or the reason it shouldn't. */
function ineligibleReason(call) {
    if (call.status && call.status !== "completed") return `status ${call.status}`;
    if (call.type && call.type !== "standard") return `type ${call.type}`;
    if (call.direction !== "inbound" && call.direction !== "outbound") return `direction ${call.direction}`;
    const kind = callKind(call);
    if (kind !== "answered") {
        if (call.direction !== "inbound") return "missed outbound"; // staff dialled, nobody answered
        if (kind === "voicemail" && (call.durationSeconds || 0) < MIN_VOICEMAIL_SECONDS) return "short voicemail";
        return null;
    }
    if ((call.durationSeconds || 0) < MIN_DURATION_SECONDS) return "short";
    // Both ends are our own users/extensions -> an internal office call.
    if ((call.from?.userId || call.from?.extensionId) && (call.to?.userId || call.to?.extensionId)) return "internal";
    return null;
}

/** The outside party's 10-digit number for a Mango call. */
function externalNumber(call) {
    return normalizePhone(call.direction === "outbound" ? call.to?.formattedNumber : call.from?.formattedNumber);
}

/**
 * Pick the hub call doc for a Mango call: same office, same outside number,
 * createdAt within the window, closest in time, and not claimed by another
 * Mango call. `hubCalls` is [{ id, data, createdAtMs }].
 */
function findHubMatch(call, office, hubCalls) {
    const phone = externalNumber(call);
    if (!phone) return null;
    const start = Date.parse(call.startedAt);
    const end = call.endedAt ? Date.parse(call.endedAt) : start + (call.durationSeconds || 0) * 1000;
    let best = null;
    for (const h of hubCalls) {
        const d = h.data;
        if ((d.location || "glendale") !== office) continue;
        if (d.mangoCallId && d.mangoCallId !== call.callId) continue;
        if (h.createdAtMs < start - MATCH_BEFORE_MS || h.createdAtMs > end + MATCH_AFTER_MS) continue;
        const dir = d.direction;
        const candidates = dir === "outbound" ? [d.toNumber]
            : dir === "inbound" ? [d.fromNumber]
            : [d.fromNumber, d.toNumber];
        if (!candidates.some((n) => normalizePhone(n) === phone)) continue;
        if (d.mangoCallId === call.callId) return h; // already linked: exact
        const gap = Math.abs(h.createdAtMs - start);
        if (!best || gap < best.gap) best = { h, gap };
    }
    return best ? best.h : null;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
function createMangoSync({ db, appId, processAudioAndAnalyze }) {
    const callsCol = db.collection("artifacts").doc(appId).collection("public").doc("data").collection("calls");
    const syncCol = db.collection("mango_sync_calls");
    const stateCol = db.collection("mango_sync_state");
    const ts = () => admin.firestore.FieldValue.serverTimestamp();

    async function loadHubCalls(fromMs, toMs) {
        const snap = await callsCol
            .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(fromMs))
            .where("createdAt", "<=", admin.firestore.Timestamp.fromMillis(toMs))
            .get();
        return snap.docs.map((doc) => ({
            id: doc.id,
            data: doc.data(),
            createdAtMs: doc.data().createdAt?.toMillis?.() ?? 0,
        }));
    }

    async function loadSyncRecords(office, calls) {
        if (!calls.length) return new Map();
        const refs = calls.map((c) => syncCol.doc(`${office}_${c.callId}`));
        const snaps = await db.getAll(...refs);
        return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));
    }

    const mark = (office, callId, fields) =>
        syncCol.doc(`${office}_${callId}`).set({ office, mangoCallId: callId, updatedAt: ts(), ...fields }, { merge: true });

    /**
     * Sort the calls in a time range into work items. Returns
     * { items, pending, stats }: `items` need a recording fetched + transcribed,
     * `pending` counts calls that may still change (retry next run).
     */
    async function triage(office, calls, { now, giveUpUnmatched, countOnly }) {
        const stats = { listed: calls.length, eligible: 0, minutes: 0, hasTranscript: 0, unmatched: 0, ineligible: 0, missed: 0 };
        const items = [];
        let pending = 0;
        if (!calls.length) return { items, pending, stats };

        const starts = calls.map((c) => Date.parse(c.startedAt));
        const hubCalls = await loadHubCalls(Math.min(...starts) - MATCH_BEFORE_MS, Math.max(...starts) + MATCH_AFTER_MS + 3600e3);
        const records = countOnly ? new Map() : await loadSyncRecords(office, calls);

        for (const call of calls) {
            const rec = records.get(`${office}_${call.callId}`);
            if (rec && (FINAL_STATUSES.has(rec.status) || (rec.status === "error" && (rec.attempts || 0) >= MAX_ATTEMPTS))) continue;

            const endMs = call.endedAt ? Date.parse(call.endedAt) : Date.parse(call.startedAt);
            if (call.status !== "completed" && now - endMs < UNMATCHED_GIVE_UP_MS) { pending++; continue; }
            if (now - endMs < SETTLE_MS) { pending++; continue; }

            const reason = ineligibleReason(call);
            if (reason) {
                stats.ineligible++;
                if (!countOnly) await mark(office, call.callId, { status: "ineligible", reason });
                continue;
            }

            const hub = findHubMatch(call, office, hubCalls);
            if (!hub) {
                if (!giveUpUnmatched && now - endMs < UNMATCHED_GIVE_UP_MS) { pending++; continue; }
                stats.unmatched++;
                if (!countOnly) await mark(office, call.callId, { status: "unmatched", startedAt: call.startedAt });
                continue;
            }
            if (hub.data.transcript) {
                stats.hasTranscript++;
                if (!countOnly) await mark(office, call.callId, { status: "has_transcript", hubCallId: hub.id });
                continue;
            }
            // Claim the hub doc so a neighbouring call can't match it too.
            hub.data.mangoCallId = call.callId;
            const kind = callKind(call);
            if (kind === "missed") {
                stats.missed++;
            } else {
                stats.eligible++;
                stats.minutes += (call.durationSeconds || 0) / 60;
            }
            items.push({ office, call, hub, kind, attempts: rec?.attempts || 0 });
        }
        return { items, pending, stats };
    }

    /** A missed call with no voicemail: nothing to transcribe, so label it as a callback. */
    async function labelMissed(item, { isBackfill }) {
        const { office, call, hub } = item;
        const hangUp = (call.durationSeconds || 0) < HANGUP_SECONDS;
        const forwarded = !!call.externallyTransferredAt;
        const update = {
            mangoCallId: call.callId,
            callKind: hangUp ? "hangup" : "missed",
            reason: hangUp ? "Hung up" : "Missed call",
            summary: hangUp
                ? "Caller hung up right away — no voicemail."
                : forwarded
                    ? "Missed call — forwarded outside the office, no voicemail left. Call back."
                    : "Missed call — no voicemail left. Call back.",
        };
        // Live callbacks go to the top of the queue; don't reshuffle weeks-old calls.
        if (!hangUp && !isBackfill && !STAFF_STATUSES.includes(hub.data.status) && (hub.data.priority || "NORMAL") === "NORMAL") {
            update.priority = "TODAY";
        }
        await callsCol.doc(hub.id).set(update, { merge: true });
        await mark(office, call.callId, { status: "labeled", hubCallId: hub.id, kind: update.callKind });
        return "labeled";
    }

    /** Fetch a fresh recording URL and run the transcription pipeline for one item. */
    async function processItem(item, { apiKey, openAiKey, isBackfill }) {
        if (item.kind === "missed") return labelMissed(item, { isBackfill });
        const { office, call, hub } = item;
        const full = await mango(apiKey, MANGO_SESSIONS[office], "getCall", { callId: call.callId });
        if (!full?.recordingUrl) {
            await mark(office, call.callId, { status: "no_recording", hubCallId: hub.id });
            return "no_recording";
        }
        await callsCol.doc(hub.id).set({
            mangoCallId: call.callId,
            recordingSource: "zatanna-mango",
            ...(item.kind === "voicemail" ? { callKind: "voicemail" } : {}),
        }, { merge: true });
        const d = hub.data;
        const analysis = await processAudioAndAnalyze(
            hub.id, full.recordingUrl, openAiKey, null, d.toNumber || "", office, d.direction || call.direction,
            { autoResolve: !isBackfill, keepStatus: true, maxFetchAttempts: 2 },
        );
        if (analysis) {
            await mark(office, call.callId, { status: "done", hubCallId: hub.id, backfill: isBackfill });
            return "done";
        }
        await mark(office, call.callId, { status: "error", hubCallId: hub.id, attempts: item.attempts + 1 });
        return "error";
    }

    /**
     * An outbound call that connected for a while counts as returning any open
     * missed call / voicemail from that number at that office: resolve them.
     * Ongoing pass only, so the backfill never closes old calls in bulk.
     */
    async function resolveReturnedCalls(office, calls) {
        const outbound = calls.filter((c) => c.direction === "outbound" && !c.isMissed && c.status === "completed"
            && (c.durationSeconds || 0) >= RETURN_MIN_SECONDS && externalNumber(c));
        if (!outbound.length) return 0;
        const records = await loadSyncRecords(office, outbound);
        let resolved = 0;
        for (const call of outbound) {
            if (records.get(`${office}_${call.callId}`)?.returnChecked) continue;
            const startMs = Date.parse(call.startedAt);
            const snap = await callsCol.where("fromNumber", "==", `+1${externalNumber(call)}`).get();
            for (const doc of snap.docs) {
                const d = doc.data();
                const created = d.createdAt?.toMillis?.() ?? 0;
                if ((d.location || "glendale") !== office) continue;
                if (d.callKind !== "missed" && d.callKind !== "voicemail") continue;
                if (d.status === "Resolved" || created > startMs || created < startMs - RETURN_LOOKBACK_MS) continue;
                await doc.ref.set({
                    status: "Resolved",
                    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
                    resolvedBy: call.from?.userName ? `Returned call (${call.from.userName})` : "Returned call",
                    returnedByMangoCallId: call.callId,
                }, { merge: true });
                resolved++;
            }
            await mark(office, call.callId, { returnChecked: true });
        }
        return resolved;
    }

    /** Ongoing pass: recent calls for every office. */
    async function collectOngoing(apiKey, now) {
        const items = [];
        for (const office of Object.keys(MANGO_SESSIONS)) {
            try {
                const calls = await listCallsBetween(apiKey, MANGO_SESSIONS[office], now - ONGOING_LOOKBACK_MS, now);
                const returned = await resolveReturnedCalls(office, calls);
                if (returned) console.log(`[mango-sync] ${office}: resolved ${returned} missed call(s) that were called back`);
                const { items: found } = await triage(office, calls, { now, giveUpUnmatched: false, countOnly: false });
                items.push(...found);
            } catch (err) {
                console.warn(`[mango-sync] ongoing ${office} failed:`, err.message);
            }
        }
        return items;
    }

    /**
     * Backfill pass for one office: walk 6h windows forward from the stored
     * cursor. In "count" mode tally and advance; in "run" mode collect items and
     * only advance past a window once nothing in it is left to do.
     */
    async function backfillOffice(apiKey, office, { mode, sinceMs, untilMs, room, deadline, now }) {
        const stateRef = stateCol.doc(`${mode}_${office}`);
        const state = (await stateRef.get()).data() || {};
        let cursor = state.cursor ?? sinceMs;
        const totals = { listed: 0, eligible: 0, minutes: 0, hasTranscript: 0, unmatched: 0, ineligible: 0, missed: 0, ...(state.totals || {}) };
        const items = [];

        while (cursor < untilMs && Date.now() < deadline && items.length < room) {
            const windowEnd = Math.min(cursor + BACKFILL_WINDOW_MS, untilMs);
            const calls = await listCallsBetween(apiKey, MANGO_SESSIONS[office], cursor, windowEnd);
            const { items: found, pending, stats } = await triage(office, calls, { now, giveUpUnmatched: true, countOnly: mode === "count" });

            if (mode === "count") {
                for (const k of Object.keys(totals)) totals[k] += stats[k];
                cursor = windowEnd;
                continue;
            }
            // Only step past a window once a run finds nothing left to do in it.
            // Items queued now are marked done/error when processed, so the next
            // run re-lists this window, sees them as finished, and advances —
            // anything that didn't get processed (deadline, crash) is retried.
            if (found.length === 0 && pending === 0) {
                cursor = windowEnd;
                continue;
            }
            items.push(...found.slice(0, room - items.length));
            break;
        }

        const done = cursor >= untilMs;
        await stateRef.set({ cursor, done, totals, sinceMs, updatedAt: ts() }, { merge: true });
        if (mode === "count") {
            console.log(`[mango-sync] COUNT ${office}: ${done ? "complete" : "in progress"} through ${new Date(cursor).toISOString()} —`,
                JSON.stringify({ ...totals, minutes: Math.round(totals.minutes) }));
        }
        return { items, done, cursor };
    }

    /** One scheduled run. */
    async function run({ apiKey, openAiKey, mode = "off", sinceIso, maxItems = 30, budgetMs = 7.5 * 60e3 }) {
        const started = Date.now();
        const deadline = started + budgetMs;
        const now = started;

        const queue = (await collectOngoing(apiKey, now)).map((it) => ({ ...it, isBackfill: false }));

        if (mode === "count" || mode === "run") {
            const sinceMs = Date.parse(sinceIso);
            const untilMs = now - ONGOING_LOOKBACK_MS; // the ongoing pass owns the recent hours
            for (const office of Object.keys(MANGO_SESSIONS)) {
                const room = mode === "run" ? maxItems - queue.length : Infinity;
                if (room <= 0) break;
                try {
                    const { items } = await backfillOffice(apiKey, office, { mode, sinceMs, untilMs, room, deadline: deadline - 3 * 60e3, now });
                    queue.push(...items.map((it) => ({ ...it, isBackfill: true })));
                } catch (err) {
                    console.warn(`[mango-sync] backfill ${office} failed:`, err.message);
                }
            }
        }

        // Transcribe, a few at a time, stopping new work ~90s before the deadline.
        const results = { done: 0, labeled: 0, error: 0, no_recording: 0 };
        const work = queue.slice(0, maxItems);
        let next = 0;
        async function worker() {
            while (next < work.length && Date.now() < deadline - 90e3) {
                const item = work[next++];
                try {
                    results[await processItem(item, { apiKey, openAiKey, isBackfill: item.isBackfill })]++;
                } catch (err) {
                    results.error++;
                    console.warn(`[mango-sync] ${item.office} call ${item.call.callId} failed:`, err.message);
                    await mark(item.office, item.call.callId, { status: "error", hubCallId: item.hub.id, attempts: item.attempts + 1 }).catch(() => {});
                }
            }
        }
        await Promise.all([worker(), worker(), worker()]);
        console.log(`[mango-sync] run finished in ${Math.round((Date.now() - started) / 1000)}s:`,
            JSON.stringify({ queued: work.length, ...results, mode }));
        return { queued: work.length, ...results };
    }

    return { run, triage, processItem };
}

module.exports = {
    MANGO_SESSIONS,
    createMangoSync,
    ineligibleReason,
    callKind,
    externalNumber,
    findHubMatch,
    listCallsBetween,
};
