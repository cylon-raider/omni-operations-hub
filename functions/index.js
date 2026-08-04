const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const FormData = require("form-data");
const fetch = require("node-fetch");
const { Buffer } = require("buffer");

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// Standard App ID across frontend and backend
const APP_ID = "fds-operations-hub";

// OPTIONAL: Paste your Google Apps Script Webhook URL here if you want Firebase to relay to Google Sheets
const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || "";

/**
 * Mango Webhook Receiver (Gen 2)
 * Handles incoming webhooks, updates Firestore, and optionally forwards to Google Sheets.
 */
exports.mangoWebhook = onRequest({ timeoutSeconds: 300, invoker: "public" }, async (req, res) => {
    // Allow GET for quick browser health-checks
    if (req.method === "GET") {
        return res.status(200).send("Mango Webhook Endpoint is Active & Online!");
    }

    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
    }

    try {
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        const MANGO_TOKEN = process.env.MANGO_TOKEN;

        const rawBody = req.body;
        console.log("=== MANGO WEBHOOK RECEIVED ===", JSON.stringify(rawBody, null, 2));

        // Validate payload is present
        if (!rawBody || (typeof rawBody === "object" && Object.keys(rawBody).length === 0)) {
            console.warn("Empty webhook payload received");
            return res.status(400).json({ ok: false, error: "Empty payload" });
        }

        // Handle single object or array payloads
        const events = Array.isArray(rawBody) ? rawBody : [rawBody];
        let processed = 0;
        let skipped = 0;
        const processedEvents = [];

        for (const event of events) {
            // Filter out line_extension events to prevent duplicate rows in Google Sheets
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

            // 1. Write call record to Firestore (Instant Web App update)
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
                assignment: manualAssignment,
                priority: manualPriority,
                summary: manualSummary,
                status: recordingUrl ? "Processing" : callStatus,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                recordingUrl: recordingUrl,
                rawEvent: truncatedRawEvent,
                importedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // 2. Process Audio with OpenAI Whisper & GPT-4o if recording is present
            // IMPORTANT: Awaited so Cloud Functions doesn't terminate before completion
            if (recordingUrl && OPENAI_API_KEY) {
                const analysis = await processAudioAndAnalyze(callId, recordingUrl, OPENAI_API_KEY, MANGO_TOKEN, toNumber);
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
                    target.isOutbound = analysis.is_outbound;
                    target.isResolved = analysis.is_resolved;

                    // Update Firestore with the completed AI analysis
                    await callRef.set({
                        summary: analysis.summary,
                        assignment: analysis.assignment,
                        priority: analysis.priority,
                        status: "Waiting"
                    }, { merge: true });
                }
            }

            processedEvents.push(event);
            processed++;
            console.log(`Processed call ${callId} (recording: ${!!recordingUrl})`);
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
async function processAudioAndAnalyze(callId, recordingUrl, openAiKey, mangoToken, toNumber) {
    const callRef = db.collection("artifacts")
        .doc(APP_ID)
        .collection("public")
        .doc("data")
        .collection("calls")
        .doc(callId);

    try {
        // Fetch the audio file from Mango. If it's an S3 presigned URL, AWS will return 400 if we add an Authorization header.
        const fetchOptions = {};
        if (mangoToken && !recordingUrl.includes("amazonaws.com")) {
            fetchOptions.headers = { "Authorization": `Bearer ${mangoToken}` };
        }
        
        let audioRes;
        for (let attempt = 1; attempt <= 12; attempt++) {
            audioRes = await fetch(recordingUrl, fetchOptions);
            if (audioRes.ok) break;
            if (audioRes.status !== 404 && audioRes.status !== 403) break;
            console.log(`[Call ${callId}] Attempt ${attempt}: Recording not ready (${audioRes.status}), waiting 10s...`);
            await new Promise(r => setTimeout(r, 10000));
        }

        if (!audioRes || !audioRes.ok) {
            throw new Error(`Failed to fetch recording: ${audioRes ? audioRes.status : 'Unknown'} ${audioRes ? audioRes.statusText : ''}`);
        }

        // Convert to Buffer (Node.js-compatible, not browser Blob)
        const arrayBuffer = await audioRes.arrayBuffer();
        const audioBuffer = Buffer.from(arrayBuffer);

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

        // Analyze with GPT-4o-mini
        const gptPrompt = `
Analyze this dental office call transcript.
Return a JSON object with:
1. "summary": A 1-2 sentence summary.
2. "sentiment": "Positive", "Neutral", "Negative", or "Angry".
3. "priority": "NORMAL", "TODAY", "URGENT", or "ESCALATED". (CRITICAL: If the transcript mentions "prescription" or "prescriptions", priority MUST be "URGENT")
4. "assignment": Route to one of ["Front Desk Supervisor", "Clinical / Labs", "Treatment Coordinator", "Billing", "Hygiene", "Pod 1", "Pod 2", "Pod 3"]. (CRITICAL: If the transcript mentions "payment plan", assignment MUST be "Treatment Coordinator")
5. "reason": A short 3-4 word reason for the call.
6. "employee_name": The first name of the STAFF MEMBER / EMPLOYEE making the call. It MUST be the employee, NOT the patient. If the employee does not explicitly state their own name, return null. Do NOT return the patient's name here.
7. "is_outbound": true if this is an outbound call from the office to a patient.
8. "is_resolved": true if the patient's issue or complaint was fully resolved during this call.

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

        await callRef.update({
            transcript,
            summary: analysis.summary || "",
            sentiment: analysis.sentiment || "Neutral",
            priority: analysis.priority || "NORMAL",
            assignment: analysis.assignment || "Front Desk Supervisor",
            reason: analysis.reason || "",
            employeeName: analysis.employee_name || null,
            isOutbound: analysis.is_outbound || false,
            isResolved: analysis.is_resolved || false,
            status: "Waiting",
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If it's an outbound call that resolved the issue, auto-resolve any active inbound calls from that patient
        if (analysis.is_outbound && analysis.is_resolved && toNumber) {
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
            status: "Transcription Error",
            errorLog: err.message,
            errorAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
}
exports.debugDb = require('./debug').debugDb;
