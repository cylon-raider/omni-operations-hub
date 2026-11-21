// -----------------------------------------------------------------------------
// Firebase Cloud Functions (Backend)
// -----------------------------------------------------------------------------
// This file is our server. When someone calls the office, Mango Voice sends a
// message (a "Webhook") to this server. This code intercepts that message,
// saves it to our database, and even uses AI to transcribe and summarize the call!
// -----------------------------------------------------------------------------
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const FormData = require("form-data");
const fetch = require("node-fetch");
const { Buffer } = require("buffer");
const { randomUUID } = require("crypto");
const { defineSecret } = require("firebase-functions/params");
const { ZATANNA_API_KEY, enrichCallWithDentrix } = require("./dentrix");
const { requireApprovedUser, webhookKeyMatches } = require("./access");

// Shared secret Mango must send with every webhook (as `&key=` on the URL
// configured in Mango). Set with: firebase functions:secrets:set MANGO_WEBHOOK_SECRET
const MANGO_WEBHOOK_SECRET = defineSecret("MANGO_WEBHOOK_SECRET");

// Initialize Firebase Admin (Required to talk to the database securely)
// storageBucket is explicit rather than relying on auto-detection - see the
// call-recording cache below, which needs it.
if (!admin.apps.length) {
    admin.initializeApp({ storageBucket: "fds-operations-hub.firebasestorage.app" });
}
const db = admin.firestore();

// The specific database path we write to
const APP_ID = "fds-operations-hub";

// processAudioAndAnalyze is a hoisted function declaration further down.
const mangoSync = require("./mango").createMangoSync({ db, appId: APP_ID, processAudioAndAnalyze });
const confirmationsSync = require("./confirmations").createConfirmationsSync({ db, appId: APP_ID });
const huddleSync = require("./huddle").createHuddleSync({ db, appId: APP_ID });
const treatmentSync = require("./treatment").createTreatmentSync({ db, appId: APP_ID });

// Call recordings are cached here on first fetch so a later retry (e.g.
// after an OpenAI outage/billing lapse) doesn't depend on Mango's recording
// URL still being valid - it's a short-lived (~15min) presigned S3 link.
// Storage lifecycle rule auto-deletes these after 7 days.
const RECORDINGS_PREFIX = "call-recordings";

async function getCachedRecording(callId) {
    try {
        const file = admin.storage().bucket().file(`${RECORDINGS_PREFIX}/${callId}.mp3`);
        const [exists] = await file.exists();
        if (!exists) return null;
        const [buffer] = await file.download();
        console.log(`[Call ${callId}] Using cached recording from Storage.`);
        return buffer;
    } catch (err) {
        console.warn(`[Call ${callId}] Could not read cached recording:`, err.message);
        return null;
    }
}

async function cacheRecording(callId, buffer) {
    try {
        const file = admin.storage().bucket().file(`${RECORDINGS_PREFIX}/${callId}.mp3`);
        // Set a firebaseStorageDownloadTokens value so the Firebase Console's
        // file browser (and getDownloadURL()) can open/play this file
        // directly - the Admin SDK doesn't set one automatically the way an
        // upload through the Console or client SDK would.
        await file.save(buffer, {
            contentType: "audio/mpeg",
            metadata: { metadata: { firebaseStorageDownloadTokens: randomUUID() } },
        });
    } catch (err) {
        console.warn(`[Call ${callId}] Could not cache recording:`, err.message);
    }
}

// OPTIONAL: Paste your Google Apps Script Webhook URL here if you want Firebase to relay to Google Sheets
const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || "";

/**
 * ----------------------------------------------------------------------------
 * Mango Webhook Receiver
 * ----------------------------------------------------------------------------
 * This function creates a public URL on the internet. Mango Voice is configured
 * to send data to this URL every time a phone call happens. Because the URL is
 * public, every POST must carry MANGO_WEBHOOK_SECRET (see functions/access.js);
 * anything else is rejected before it can create calls or spend OpenAI and
 * Dentrix requests.
 */
exports.mangoWebhook = onRequest({ timeoutSeconds: 300, invoker: "public", secrets: [ZATANNA_API_KEY, MANGO_WEBHOOK_SECRET] }, async (req, res) => {
    // A quick health-check. If you visit this URL in your browser (a GET request),
    // it will just say "Active & Online!"
    if (req.method === "GET") {
        return res.status(200).send("Mango Webhook Endpoint is Active & Online!");
    }

    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
    }

    if (!webhookKeyMatches(req, MANGO_WEBHOOK_SECRET.value())) {
        console.warn("Rejected mango webhook without a valid key");
        return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    try {
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        const MANGO_TOKEN = process.env.MANGO_TOKEN;

        const rawBody = req.body;
        // Log only non-PII metadata — rawBody contains caller names/phone
        // numbers, which we don't want sitting in Cloud Logging in full.
        const eventTypes = (Array.isArray(rawBody) ? rawBody : [rawBody]).map((e) => e?.type || "unknown");
        console.log("=== MANGO WEBHOOK RECEIVED ===", { eventCount: eventTypes.length, eventTypes });

        // Validate payload is present
        if (!rawBody || (typeof rawBody === "object" && Object.keys(rawBody).length === 0)) {
            console.warn("Empty webhook payload received");
            return res.status(400).json({ ok: false, error: "Empty payload" });
        }

        // Mango sometimes sends multiple events at once (an Array), so we loop through them.
        const events = Array.isArray(rawBody) ? rawBody : [rawBody];
        let processed = 0;
        let skipped = 0;
        const processedEvents = [];

        for (const event of events) {
            // Only process call logs or call summaries. Skip everything else.
            if (event.type && !event.type.startsWith("call_log") && !event.type.startsWith("call_summary")) {
                console.log(`Skipping non-call-log event type: ${event.type}`);
                skipped++;
                continue;
            }

            const data = event.payload || event;

            // Extract call details across Mango v1 and v2 formats
            const callId = data.call_main_uuid || data.callId || data.uuid || event.id || `call-${Date.now()}`;
            if (!callId) {
                console.warn("Skipping event with no identifiable callId:", JSON.stringify(event).slice(0, 200));
                skipped++;
                continue;
            }

            const recordingUrl = data.recording_url || data.recordingUrl || data.audio_url || null;
            const fromNumber = data.source_number_e164 || data.source_number || data.caller_id_number || data.phone || "(555) 000-0000";
            const fromName = data.source_name || data.caller_id_name || data.name || "Unknown Caller";
            const toNumber = data.destination_number_e164 || data.destination_number || data.to_number || "";

            const manualAssignment = data.assignment || "Front Desk Supervisor";
            const manualPriority = data.priority || "NORMAL";
            const manualSummary = data.summary || "Inbound call recorded via Mango Voice.";
            const callStatus = data.disposition || data.status || "Waiting";

            // Truncate rawEvent to prevent unbounded document sizes (Firestore 1MB limit)
            const truncatedRawEvent = JSON.stringify(data).slice(0, 5000);

            // We get the location parameter from the URL (e.g. ?location=glendale)
            const location = (req.query.location || "glendale").toLowerCase();

            // ----------------------------------------------------------------
            // Step 1: Write Initial Record to Firestore
            // ----------------------------------------------------------------
            // We write the call to the database immediately so it pops up on the
            // dashboard right away, even if the AI takes 30 seconds to transcribe it.
            const callRef = db.collection("artifacts")
                .doc(APP_ID)
                .collection("public")
                .doc("data")
                .collection("calls")
                .doc(callId);

            await callRef.set({
                callId,
                fromNumber,
                fromName,
                toNumber,
                location: location,
                direction: data.direction || 'unknown',
                assignment: manualAssignment,
                priority: manualPriority,
                summary: manualSummary,
                status: recordingUrl ? "Processing" : callStatus,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                recordingUrl: recordingUrl,
                rawEvent: truncatedRawEvent,
                importedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // ----------------------------------------------------------------
            // Step 1b: Look the caller up in Dentrix Ascend (read-only)
            // ----------------------------------------------------------------
            // Runs alongside the AI step below rather than before it, and is
            // awaited at the end of this loop iteration. enrichCallWithDentrix
            // never throws for lookup failures; the .catch is for Firestore.
            const dentrixLookup = enrichCallWithDentrix(callRef, ZATANNA_API_KEY.value(), {
                location,
                direction: data.direction || 'unknown',
                fromNumber,
                toNumber,
            }).catch((err) => console.warn(`[Call ${callId}] Dentrix enrichment failed:`, err.message));

            // ----------------------------------------------------------------
            // Step 2: Process Audio with AI (OpenAI)
            // ----------------------------------------------------------------
            // If there is an audio recording, we send it to OpenAI to transcribe
            // it (Speech-to-Text), and then use ChatGPT to summarize it, guess
            // the priority, and assign it to a queue.
            const duration = data.duration_seconds || data.duration || 0;
            const skipTranscription = duration > 0 && duration < 25; // Don't transcribe super short calls (voicemails, hang-ups)
            const isInternal = data.direction === 'internal';

            if (recordingUrl && OPENAI_API_KEY && !skipTranscription && !isInternal) {
                const analysis = await processAudioAndAnalyze(callId, recordingUrl, OPENAI_API_KEY, MANGO_TOKEN, toNumber, location, data.direction || 'unknown');
                if (analysis) {
                    // Attach AI analysis back to the payload
                    const target = event.payload ? event.payload : event;
                    target.transcript = analysis.transcript;
                    target.summary = analysis.summary;
                    target.priority = analysis.priority;
                    target.assignment = analysis.assignment;
                    target.sentiment = analysis.sentiment;
                    target.reason = analysis.reason;
                    target.employeeName = analysis.employee_name;
                    target.patientName = analysis.patient_name;
                    target.isOutbound = analysis.is_outbound;
                    target.isResolved = analysis.is_resolved;
                    target.location = location;

                    // Update Firestore with the completed AI analysis
                    await callRef.set({
                        summary: analysis.summary,
                        assignment: analysis.assignment,
                        priority: analysis.priority,
                        employeeName: analysis.employee_name || null,
                        patientName: analysis.patient_name || null,
                        isResolved: analysis.is_resolved || false,
                        reason: analysis.reason || null,
                        status: "Waiting",
                        location: location
                    }, { merge: true });
                }
            } else if (skipTranscription || isInternal) {
                // Instantly update to Waiting with a short summary
                const target = event.payload ? event.payload : event;
                target.location = location;
                
                const summaryMsg = isInternal 
                    ? "Internal office call. No AI transcript generated."
                    : `Short call (${duration}s). No AI transcript generated.`;
                
                await callRef.set({
                    summary: summaryMsg,
                    status: "Waiting",
                    location: location
                }, { merge: true });
            } else {
                // Fallback for missing recordings / test calls
                const target = event.payload ? event.payload : event;
                target.location = location;

                // Since 2026-10-13 Mango stopped including recording_url in
                // call_log events, so real calls land here too. Without this
                // they'd keep Mango's raw status ("answered", "hangup") and
                // the generic default summary. Test payloads carry their own
                // summary, so leave those alone.
                if (!recordingUrl && !data.summary) {
                    const noRecordingMsg = "No recording received from Mango Voice — transcript unavailable.";
                    target.summary = noRecordingMsg;
                    await callRef.set({
                        summary: noRecordingMsg,
                        status: "Waiting",
                        location: location
                    }, { merge: true });
                }
            }

            await dentrixLookup;

            processedEvents.push(event);
            processed++;
            console.log(`Processed call ${callId} (recording: ${!!recordingUrl})`);
        }

        // Mango no longer sends recordings, but every call still triggers this
        // webhook — use it to fetch the recording through Zatanna right away
        // instead of waiting for the 2-minute syncMangoRecordings run.
        const touchedOffices = [...new Set(processedEvents
            .filter((e) => (e.payload || e).direction !== "internal")
            .map((e) => (e.payload || e).location || (req.query.location || "glendale").toLowerCase()))];
        if (touchedOffices.length && OPENAI_API_KEY && ZATANNA_API_KEY.value()) {
            await mangoSync.syncNow({ apiKey: ZATANNA_API_KEY.value(), openAiKey: OPENAI_API_KEY, offices: touchedOffices })
                .catch((err) => console.warn("[mango-sync] immediate sync failed:", err.message));
        }

        // 3. Relay payload to Google Sheet if Webhook URL is set
        if (GOOGLE_SHEET_WEBHOOK_URL && processedEvents.length > 0) {
            try {
                // If original payload was a single object, forward a single object.
                const payloadToForward = (processedEvents.length === 1 && !Array.isArray(rawBody)) ? processedEvents[0] : processedEvents;
                await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payloadToForward)
                });
            } catch (sheetErr) {
                console.error("Error forwarding to Google Sheet:", sheetErr.message);
            }
        }

        console.log(`Webhook complete: ${processed} processed, ${skipped} skipped`);
        return res.status(200).json({ ok: true, processed, skipped });
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * Process call recording with OpenAI Whisper (transcription) & GPT-4o (analysis).
 * Uses Node.js-compatible APIs (Buffer, form-data package).
 */
// Statuses staff set by hand. When `keepStatus` is on (recordings recovered
// later via Zatanna), a transcript arriving must not reopen a call someone has
// already started or resolved.
const STAFF_STATUSES = ["In Progress", "Resolved"];

/**
 * options:
 *   autoResolve       (default true)  outbound "resolved" calls close that patient's open inbound calls.
 *                                     Off for the backfill so weeks-old calls aren't closed in bulk.
 *   keepStatus        (default false) keep an In Progress / Resolved status instead of resetting to Waiting.
 *   maxFetchAttempts  (default 12)    retries while the recording URL 403/404s (Mango's webhook URLs
 *                                     need time to appear; Zatanna's signed URLs are ready immediately).
 */
async function processAudioAndAnalyze(callId, recordingUrl, openAiKey, mangoToken, toNumber, location, direction, options = {}) {
    const { autoResolve = true, keepStatus = false, maxFetchAttempts = 12 } = options;
    const callRef = db.collection("artifacts")
        .doc(APP_ID)
        .collection("public")
        .doc("data")
        .collection("calls")
        .doc(callId);

    let previousStatus = null;
    if (keepStatus) {
        const snap = await callRef.get();
        previousStatus = snap.exists ? snap.data().status : null;
    }
    const finalStatus = (fallback) => (keepStatus && STAFF_STATUSES.includes(previousStatus)) ? previousStatus : fallback;

    try {
        // Prefer a cached copy from a previous attempt over re-fetching from
        // Mango - its recording URLs are short-lived presigned links, so a
        // retry (e.g. after an OpenAI outage) needs the cache once that
        // window has passed.
        let audioBuffer = await getCachedRecording(callId);

        if (!audioBuffer) {
            // Fetch the audio file from Mango. If it's an S3 presigned URL, AWS will return 400 if we add an Authorization header.
            const fetchOptions = {};
            if (mangoToken && !recordingUrl.includes("amazonaws.com")) {
                fetchOptions.headers = { "Authorization": `Bearer ${mangoToken}` };
            }

            let audioRes;
            for (let attempt = 1; attempt <= maxFetchAttempts; attempt++) {
                audioRes = await fetch(recordingUrl, fetchOptions);
                if (audioRes.ok) break;
                if (audioRes.status !== 404 && audioRes.status !== 403) break;
                if (attempt === maxFetchAttempts) break;
                console.log(`[Call ${callId}] Attempt ${attempt}: Recording not ready (${audioRes.status}), waiting 10s...`);
                await new Promise(r => setTimeout(r, 10000));
            }

            if (!audioRes || !audioRes.ok) {
                throw new Error(`Failed to fetch recording: ${audioRes ? audioRes.status : 'Unknown'} ${audioRes ? audioRes.statusText : ''}`);
            }

            // Convert to Buffer (Node.js-compatible, not browser Blob)
            const arrayBuffer = await audioRes.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuffer);

            // Cache it so a retry doesn't depend on this same short-lived URL.
            await cacheRecording(callId, audioBuffer);
        }

        // Build multipart form using the form-data package (not browser FormData)
        const form = new FormData();
        form.append("file", audioBuffer, {
            filename: "call.mp3",
            contentType: "audio/mpeg",
        });
        form.append("model", "whisper-1");

        // Transcribe with OpenAI Whisper
        // NOTE: Must use form.getBuffer() — built-in fetch can't consume npm form-data streams directly
        const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openAiKey}`,
                ...form.getHeaders(),
            },
            body: form.getBuffer(),
        });

        if (!whisperRes.ok) {
            const errBody = await whisperRes.text();
            throw new Error(`Whisper API error ${whisperRes.status}: ${errBody.slice(0, 200)}`);
        }

        const whisperData = await whisperRes.json();
        const transcript = whisperData.text;

        if (!transcript || transcript.trim().length === 0) {
            throw new Error("Whisper returned empty transcript");
        }

        // Devin no longer works here — removed so she can't still be
        // recognized as a valid employee_name match on new calls.
        const glendaleStaff = "Jen, Lisa, Jamie, Addison, Mariana, Brandy, Liz, Alessia, Marianne, Aubrey, Marah, Pam, Eylianna, Dan";
        const litchfieldStaff = "Jen, Melia, Cynthia, Lupita, Rachel, Aron";
        const validStaff = location === 'litchfield' ? litchfieldStaff : glendaleStaff;

        // Analyze with GPT-4o-mini
        const gptPrompt = `
Analyze this dental office call.
Return a JSON object with the following properties:
1. "summary": A concise 1-2 sentence summary of the patient's request or issue.
2. "sentiment": A brief assessment of the caller's mood (e.g. "Frustrated", "Neutral", "Happy", "Urgent").
3. "priority": "NORMAL", "TODAY", "URGENT", or "ESCALATED". (CRITICAL: If the transcript mentions "prescription" or "prescriptions", priority MUST be "URGENT")
4. "assignment": Route to one of ["Front Desk Supervisor", "Clinical / Labs", "Treatment Coordinator", "Billing", "Hygiene", "Pod 1", "Pod 2", "Pod 3"]. (CRITICAL: If the transcript mentions "payment plan", assignment MUST be "Treatment Coordinator")
5. "reason": A short 3-4 word reason for the call.
6. "employee_name": The first name of the STAFF MEMBER / EMPLOYEE making the call, ONLY if they explicitly say their own name somewhere in the transcript (e.g. "Hi, this is Devin calling from Family Dental Station..."). Most calls — especially short appointment-confirmation voicemails — do NOT include this. If no staff member states their own name anywhere in the transcript, you MUST return null; do not guess, and do not infer a name just because it fits the situation. Valid staff members for this office are: ${validStaff} — this list exists ONLY to confirm a name you already heard self-identified is a real employee and not a mishearing, it is NOT a menu to pick from when no name was said. It MUST be the employee, NOT the patient — if a name is only mentioned in the context of "Is [Name] available?" or "I'm calling for [Name]" (which is the patient), that is NOT the employee; return null.
7. "is_outbound": true if this is an outbound call from the office to a patient.
8. "is_resolved": true if the caller's request was completed, false if they need a callback or follow-up.
9. "patient_name": The first and last name of the patient (or caller). Extract this from the transcript if mentioned, otherwise return null.
10. "sentiment_score": A number from -1.0 (very negative/upset) to 1.0 (very positive/happy) rating the caller's overall mood on a continuous scale, where 0.0 is neutral. Use the full range to reflect nuance — e.g. a caller who is mostly fine but mildly annoyed might be -0.3, not a flat -1.0.

Transcript: "${transcript}"
`;

        const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openAiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: gptPrompt }],
                response_format: { type: "json_object" }
            })
        });

        if (!gptRes.ok) {
            const errBody = await gptRes.text();
            throw new Error(`GPT API error ${gptRes.status}: ${errBody.slice(0, 200)}`);
        }

        const gptData = await gptRes.json();
        const analysis = JSON.parse(gptData.choices[0].message.content);

        // Deterministic backstop against the AI naming an employee who was
        // never actually mentioned, or misreading a PATIENT's name as the
        // employee's. The prompt above discourages both, but GPT-4o-mini
        // still does it occasionally — e.g. an ambiguously-punctuated
        // Whisper transcript like "this message is for Dwyane calling from
        // Family Dental Station" (missing the sentence break after the
        // patient's name) reads as if the patient were the one calling.
        //
        // An earlier version of this check required the name to match a
        // hardcoded valid-staff list (the same one used in the prompt
        // above). That turned out to be actively harmful: the list was
        // missing several real, currently-active callers (confirmed against
        // payroll_staff and by dozens of consistent, identical
        // self-introductions each), so it was rejecting genuine calls just
        // as often as it caught bad ones. A hardcoded roster will always
        // drift out of sync with who's actually calling.
        //
        // What actually distinguishes "the employee speaking" from "the
        // employee addressing the patient by name" is the grammar, not
        // whether the name is on a list: self-identification ("this is X",
        // "it's X", "I'm X", "my name is X") near our own practice name,
        // vs. any other mention. This requires no roster to maintain and
        // correctly handles both failure modes above.
        if (analysis.employee_name) {
            const escapedName = analysis.employee_name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const selfIdPattern = new RegExp(`\\b(?:this is|it'?s|i'?m|my name is)\\s+${escapedName}\\b(?:[^.!?]{0,70})?(?:family dental|dr\\.?\\s*marr)`, 'i');
            if (!selfIdPattern.test(transcript)) {
                console.warn(`Discarding unsupported employee_name "${analysis.employee_name}" for ${callId} — no self-identification near the practice name found in transcript`);
                analysis.employee_name = null;
            }
        }

        await callRef.update({
            transcript,
            summary: analysis.summary || "",
            sentiment: analysis.sentiment || "Neutral",
            sentimentScore: (typeof analysis.sentiment_score === 'number' && !isNaN(analysis.sentiment_score))
                ? Math.max(-1, Math.min(1, analysis.sentiment_score))
                : null,
            priority: analysis.priority || "NORMAL",
            assignment: analysis.assignment || "Front Desk Supervisor",
            reason: analysis.reason || "",
            employeeName: analysis.employee_name || null,
            patientName: analysis.patient_name || null,
            isOutbound: analysis.is_outbound || false,
            isResolved: analysis.is_resolved || false,
            status: finalStatus("Waiting"),
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If it's an outbound call that resolved the issue, auto-resolve any active inbound calls from that patient
        if (autoResolve && direction === 'outbound' && analysis.is_outbound && analysis.is_resolved && toNumber) {
            try {
                const callsRef = db.collection("artifacts").doc(APP_ID).collection("public").doc("data").collection("calls");
                const q = callsRef.where("fromNumber", "==", toNumber)
                    .where("status", "!=", "Resolved");
                const snapshot = await q.get();

                if (!snapshot.empty) {
                    const batch = db.batch();
                    snapshot.forEach(doc => {
                        batch.update(doc.ref, {
                            status: "Resolved",
                            resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
                            resolvedBy: analysis.employee_name || "Auto-Resolve"
                        });
                    });
                    await batch.commit();
                    console.log(`Auto-resolved ${snapshot.size} inbound calls for ${toNumber}`);
                }
            } catch (resolveErr) {
                console.error("Error auto-resolving inbound calls:", resolveErr);
            }
        }

        console.log(`Audio analysis complete for ${callId}: priority=${analysis.priority}, assignment=${analysis.assignment}`);
        return analysis;

    } catch (err) {
        console.error(`Processing error for ${callId}:`, err.message);
        await callRef.update({
            status: finalStatus("Transcription Error"),
            errorLog: err.message,
            errorAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
}
/**
 * ----------------------------------------------------------------------------
 * Manual Recording Upload (staff-facing fallback)
 * ----------------------------------------------------------------------------
 * Since 2026-10-13 Mango stopped sending recording_url to our (customer-built,
 * non-"verified") webhook, so new calls arrive with no audio to transcribe.
 * The recordings still exist in Mango's web app, where a human can click
 * "Download audio". This endpoint lets a signed-in hub user attach that
 * downloaded file to the matching call: we cache the bytes under the callId and
 * run the exact same transcribe -> analyze pipeline the webhook uses.
 *
 * It relies on processAudioAndAnalyze reading the Storage cache *before* it
 * fetches any URL, so the uploaded bytes are used directly and the recordingUrl
 * argument below is an unused placeholder.
 *
 * Auth: requires a valid Firebase ID token (the same login the SPA uses). The
 * raw request body is the audio file; callId comes in as a query param.
 */
exports.uploadRecording = onRequest({ timeoutSeconds: 300, memory: "512MiB", invoker: "public" }, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

    try {
        // Only approved hub users may upload.
        const uploader = await requireApprovedUser(req, res);
        if (!uploader) return;

        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        if (!OPENAI_API_KEY) return res.status(500).json({ ok: false, error: "OpenAI key not configured." });

        const rawCallId = Array.isArray(req.query.callId) ? req.query.callId[0] : req.query.callId;
        const callId = (rawCallId || "").toString().trim();
        if (!callId) return res.status(400).json({ ok: false, error: "Missing callId." });

        const audioBuffer = req.rawBody;
        if (!audioBuffer || audioBuffer.length === 0) {
            return res.status(400).json({ ok: false, error: "No audio data received." });
        }
        if (audioBuffer.length > 25 * 1024 * 1024) {
            return res.status(413).json({ ok: false, error: "Audio exceeds the 25 MB limit (OpenAI's cap)." });
        }

        const callRef = db.collection("artifacts").doc(APP_ID).collection("public").doc("data").collection("calls").doc(callId);
        const snap = await callRef.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: `No call found with id ${callId}.` });

        const data = snap.data();
        const location = data.location || "glendale";
        const toNumber = data.toNumber || "";
        const direction = data.direction || "unknown";

        // Mark it processing + record who supplied the audio (for the audit trail).
        await callRef.set({
            status: "Processing",
            recordingSource: "manual-upload",
            recordingUploadedBy: uploader.email || uploader.uid,
            recordingUploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Cache the uploaded bytes under this callId. processAudioAndAnalyze reads
        // the cache first, so it transcribes these bytes directly — the
        // "manual-upload" recordingUrl below is never actually fetched.
        await cacheRecording(callId, audioBuffer);

        const analysis = await processAudioAndAnalyze(callId, "manual-upload", OPENAI_API_KEY, null, toNumber, location, direction);
        if (!analysis) {
            return res.status(502).json({ ok: false, error: "Transcription failed — the call is marked Transcription Error." });
        }

        return res.status(200).json({
            ok: true,
            callId,
            summary: analysis.summary,
            priority: analysis.priority,
            assignment: analysis.assignment,
        });
    } catch (e) {
        console.error("uploadRecording error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * ----------------------------------------------------------------------------
 * Dentrix lookup on demand (staff-facing)
 * ----------------------------------------------------------------------------
 * The webhook looks every new call up in Dentrix automatically. This endpoint
 * lets a signed-in hub user (re)run that lookup for one call — for calls
 * logged before the integration existed, or after a failed lookup. Read-only
 * against Dentrix; it only writes the `dentrix` field on our own call doc.
 */
exports.lookupDentrix = onRequest({ timeoutSeconds: 60, invoker: "public", secrets: [ZATANNA_API_KEY] }, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

    try {
        if (!(await requireApprovedUser(req, res))) return;

        const apiKey = ZATANNA_API_KEY.value();
        if (!apiKey) return res.status(500).json({ ok: false, error: "Dentrix (Zatanna) key not configured." });

        const rawCallId = Array.isArray(req.query.callId) ? req.query.callId[0] : req.query.callId;
        const callId = (rawCallId || "").toString().trim();
        if (!callId) return res.status(400).json({ ok: false, error: "Missing callId." });

        const callRef = db.collection("artifacts").doc(APP_ID).collection("public").doc("data").collection("calls").doc(callId);
        const snap = await callRef.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: `No call found with id ${callId}.` });
        const data = snap.data();

        const dentrix = await enrichCallWithDentrix(callRef, apiKey, {
            location: data.location || "glendale",
            direction: data.direction || "unknown",
            fromNumber: data.fromNumber || "",
            toNumber: data.toNumber || "",
        });
        if (!dentrix) return res.status(400).json({ ok: false, error: "Internal calls aren't looked up in Dentrix." });
        if (dentrix.status === "error") return res.status(502).json({ ok: false, error: dentrix.reason });
        return res.status(200).json({ ok: true, status: dentrix.status, matchCount: dentrix.matchCount || 0 });
    } catch (e) {
        console.error("lookupDentrix error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * ----------------------------------------------------------------------------
 * Mango recordings via Zatanna (scheduled)
 * ----------------------------------------------------------------------------
 * Every 2 minutes: pull recent Mango calls through Zatanna, match each to the
 * call doc the webhook created, and transcribe it with the same pipeline as
 * before. Optionally also works through the backlog since the Oct 13 outage —
 * set MANGO_BACKFILL in functions/.env to "count" (tally only, see logs) or
 * "run" (transcribe), then redeploy. See functions/mango.js.
 */
exports.syncMangoRecordings = onSchedule({
    schedule: "every 2 minutes",
    timeZone: "America/Phoenix",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [ZATANNA_API_KEY],
}, async () => {
    const apiKey = ZATANNA_API_KEY.value();
    const openAiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || !openAiKey) {
        console.error("[mango-sync] missing ZATANNA_API_KEY or OPENAI_API_KEY; skipping.");
        return;
    }

    // Recent calls: every run, no global lock needed — each call is claimed
    // individually, so overlapping runs (or the webhook path) never double up.
    await mangoSync.run({ apiKey, openAiKey, mode: "off", budgetMs: 210e3 })
        .catch((err) => console.warn("[mango-sync] recent-calls pass failed:", err.message));

    const mode = (process.env.MANGO_BACKFILL || "off").toLowerCase();
    if (mode !== "count" && mode !== "run") return;

    // Backfill: one at a time (it advances a shared cursor), so a slow backfill
    // run never blocks the recent-calls pass above.
    const lockRef = db.collection("mango_sync_state").doc("lock");
    const owner = randomUUID();
    const leaseMs = 9.5 * 60e3;
    const gotLock = await db.runTransaction(async (t) => {
        const snap = await t.get(lockRef);
        if (snap.exists && snap.data().expiresAt > Date.now()) return false;
        t.set(lockRef, { owner, expiresAt: Date.now() + leaseMs });
        return true;
    });
    if (!gotLock) return;

    try {
        await mangoSync.run({
            apiKey,
            openAiKey,
            mode,
            includeOngoing: false,
            budgetMs: 5 * 60e3, // + up to 3.5 min recent pass, within the 9-min timeout
            sinceIso: process.env.MANGO_BACKFILL_SINCE || "2026-10-13T00:00:00-07:00",
        });
    } finally {
        await db.runTransaction(async (t) => {
            const snap = await t.get(lockRef);
            if (snap.exists && snap.data().owner === owner) t.delete(lockRef);
        }).catch(() => {});
    }
});

/**
 * ----------------------------------------------------------------------------
 * Appointment confirmations board
 * ----------------------------------------------------------------------------
 * Every 15 minutes during office hours, re-read today + the next 3 days of
 * appointments from Dentrix (read-only) and keep the unconfirmed ones in
 * Firestore for the Confirmations page. See functions/confirmations.js.
 */
exports.syncConfirmations = onSchedule({
    schedule: "*/15 6-18 * * *",
    timeZone: "America/Phoenix",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [ZATANNA_API_KEY],
}, async () => {
    const apiKey = ZATANNA_API_KEY.value();
    if (!apiKey) return console.error("[confirmations] ZATANNA_API_KEY not configured; skipping.");
    await confirmationsSync.run(apiKey);
});

// "Refresh now" button on the Confirmations page (signed-in users only).
// Throttled per office so repeated clicks can't hammer Dentrix.
exports.refreshConfirmations = onRequest({ timeoutSeconds: 120, memory: "512MiB", invoker: "public", secrets: [ZATANNA_API_KEY] }, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    try {
        if (!(await requireApprovedUser(req, res))) return;
        const office = String(req.query.office || "").toLowerCase();
        if (!["glendale", "litchfield"].includes(office)) return res.status(400).json({ ok: false, error: "Unknown office." });

        const stateRef = db.collection("confirmations_state").doc(office);
        const last = (await stateRef.get()).data()?.lastSyncedAt?.toMillis?.() ?? 0;
        if (Date.now() - last < 60e3) return res.status(200).json({ ok: true, throttled: true });

        const [result] = await confirmationsSync.run(ZATANNA_API_KEY.value(), [office]);
        if (result.error) return res.status(502).json({ ok: false, error: result.error });
        return res.status(200).json({ ok: true, ...result });
    } catch (e) {
        console.error("refreshConfirmations error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * ----------------------------------------------------------------------------
 * Morning huddle (functions/huddle.js)
 * ----------------------------------------------------------------------------
 * A build takes a few minutes (several Dentrix lookups per patient), so nothing
 * waits on it directly: the schedule and the "Refresh now" button both just
 * queue a request in huddle_requests/, and processHuddleRequest does the work
 * in the background with a full 9 minutes. One request per office, so the two
 * offices build in parallel without doubling the load on either Dentrix session.
 */
const huddleRequests = () => db.collection("huddle_requests");
const huddleDoc = (office, date) =>
    db.collection("artifacts").doc(APP_ID).collection("public").doc("data").collection("huddles").doc(`${office}_${date}`);

// 5:30am and 12:30pm: today + tomorrow for both offices.
exports.buildHuddle = onSchedule({
    schedule: "30 5,12 * * *",
    timeZone: "America/Phoenix",
}, async () => {
    const dates = huddleSync.upcomingDates();
    for (const office of ["glendale", "litchfield"]) {
        await huddleRequests().add({ office, dates, source: "schedule", requestedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
});

exports.processHuddleRequest = onDocumentCreated({
    document: "huddle_requests/{requestId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [ZATANNA_API_KEY],
}, async (event) => {
    const req = event.data?.data();
    await event.data?.ref.delete().catch(() => {});
    const apiKey = ZATANNA_API_KEY.value();
    if (!req || !apiKey || !Array.isArray(req.dates)) return;
    await huddleSync.buildDays(apiKey, req.office, req.dates);
});

// "Refresh now" on the huddle page (signed-in users): queue a rebuild and return.
exports.refreshHuddle = onRequest({ timeoutSeconds: 30, invoker: "public" }, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    try {
        const user = await requireApprovedUser(req, res);
        if (!user) return;
        const office = String(req.query.office || "").toLowerCase();
        if (!["glendale", "litchfield"].includes(office)) return res.status(400).json({ ok: false, error: "Unknown office." });
        const [today, tomorrow] = huddleSync.upcomingDates();
        const date = req.query.day === "tomorrow" ? tomorrow : today;

        const current = (await huddleDoc(office, date).get()).data() || {};
        const startedMs = current.buildStartedAt?.toMillis?.() ?? 0;
        if (current.building && Date.now() - startedMs < 10 * 60e3) return res.status(200).json({ ok: true, alreadyBuilding: true });
        const builtMs = current.generatedAt?.toMillis?.() ?? 0;
        if (Date.now() - builtMs < 2 * 60e3) return res.status(200).json({ ok: true, throttled: true });

        // Mark it building right away so the page reacts before the worker starts.
        await huddleDoc(office, date).set({ office, date, building: true, buildStartedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await huddleRequests().add({ office, dates: [date], source: "refresh", requestedBy: user.email || user.uid, requestedAt: admin.firestore.FieldValue.serverTimestamp() });
        return res.status(202).json({ ok: true, queued: true });
    } catch (e) {
        console.error("refreshHuddle error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * ----------------------------------------------------------------------------
 * Unscheduled treatment follow-up list (functions/treatment.js)
 * ----------------------------------------------------------------------------
 * Evenings: check today's patients, re-check rows older than a week, then keep
 * working backwards through past visits (TREATMENT_BACKFILL_DAYS, default 180).
 */
exports.syncTreatmentFollowUp = onSchedule({
    schedule: "0 20,22 * * *",
    timeZone: "America/Phoenix",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [ZATANNA_API_KEY],
}, async () => {
    const apiKey = ZATANNA_API_KEY.value();
    if (!apiKey) return console.error("[treatment] ZATANNA_API_KEY not configured; skipping.");
    await treatmentSync.run(apiKey, { backfillDays: parseInt(process.env.TREATMENT_BACKFILL_DAYS, 10) || 180 });
});
