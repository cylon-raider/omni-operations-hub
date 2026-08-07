// -----------------------------------------------------------------------------
// Firebase Cloud Functions (Backend)
// -----------------------------------------------------------------------------
// This file is our server. When someone calls the office, Mango Voice sends a
// message (a "Webhook") to this server. This code intercepts that message,
// saves it to our database, and even uses AI to transcribe and summarize the call!
// -----------------------------------------------------------------------------
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const FormData = require("form-data");
const fetch = require("node-fetch");
const { Buffer } = require("buffer");

// Initialize Firebase Admin (Required to talk to the database securely)
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// The specific database path we write to
const APP_ID = "fds-operations-hub";

// OPTIONAL: Paste your Google Apps Script Webhook URL here if you want Firebase to relay to Google Sheets
const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || "";

/**
 * ----------------------------------------------------------------------------
 * Mango Webhook Receiver
 * ----------------------------------------------------------------------------
 * This function creates a public URL on the internet. Mango Voice is configured
 * to send data to this URL every time a phone call happens.
 */
exports.mangoWebhook = onRequest({ timeoutSeconds: 300, invoker: "public" }, async (req, res) => {
    // A quick health-check. If you visit this URL in your browser (a GET request),
    // it will just say "Active & Online!"
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
            // Step 2: Process Audio with AI (OpenAI)
            // ----------------------------------------------------------------
            // If there is an audio recording, we send it to OpenAI to transcribe
            // it (Speech-to-Text), and then use ChatGPT to summarize it, guess
            // the priority, and assign it to a queue.
            const duration = data.duration_seconds || data.duration || 0;
            const skipTranscription = duration > 0 && duration < 15; // Don't transcribe super short calls (voicemails, hang-ups)

            if (recordingUrl && OPENAI_API_KEY && !skipTranscription) {
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
            } else if (skipTranscription) {
                // Instantly update to Waiting with a short call summary
                const target = event.payload ? event.payload : event;
                target.location = location;
                
                await callRef.set({
                    summary: `Short call (${duration}s). No AI transcript generated.`,
                    status: "Waiting",
                    location: location
                }, { merge: true });
            } else {
                // Fallback for missing recordings / test calls
                const target = event.payload ? event.payload : event;
                target.location = location;
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
async function processAudioAndAnalyze(callId, recordingUrl, openAiKey, mangoToken, toNumber, location, direction) {
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

        const glendaleStaff = "Jen, Lisa, Jamie, Addison, Mariana, Brandy, Devin, Liz, Alessia, Marianne, Aubrey, Marah, Pam, Eylianna, Dan";
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
6. "employee_name": The first name of the STAFF MEMBER / EMPLOYEE making the call. It MUST be the employee, NOT the patient. Valid staff members for this office are: ${validStaff}. If the employee is not one of these names, or if you only hear a name in the context of 'Is [Name] available?' or 'I'm calling for [Name]' (which is the patient), return null. Do NOT make up a name.
7. "is_outbound": true if this is an outbound call from the office to a patient.
8. "is_resolved": true if the caller's request was completed, false if they need a callback or follow-up.
9. "patient_name": The first and last name of the patient (or caller). Extract this from the transcript if mentioned, otherwise return null.

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
            patientName: analysis.patient_name || null,
            isOutbound: analysis.is_outbound || false,
            isResolved: analysis.is_resolved || false,
            status: "Waiting",
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If it's an outbound call that resolved the issue, auto-resolve any active inbound calls from that patient
        if (direction === 'outbound' && analysis.is_outbound && analysis.is_resolved && toNumber) {
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
exports.migrateDb = onRequest({ invoker: "public" }, async (req, res) => {
    try {
        const callsRef = db.collection("artifacts").doc(APP_ID).collection("public").doc("data").collection("calls");
        const snapshot = await callsRef.get();
        
        let count = 0;
        let batch = db.batch();
        
        for (const doc of snapshot.docs) {
            if (!doc.data().location) {
                batch.update(doc.ref, { location: "glendale" });
                count++;
                
                if (count % 400 === 0) {
                    await batch.commit();
                    batch = db.batch();
                }
            }
        }
        
        if (count % 400 !== 0) {
            await batch.commit();
        }
        
        res.json({ success: true, updated: count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

exports.reprocessFailed = onRequest({ invoker: "public", timeoutSeconds: 300 }, async (req, res) => {
    try {
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        const MANGO_TOKEN = process.env.MANGO_TOKEN;
        
        const limit = parseInt(req.query.limit) || 10;
        const callsRef = db.collection("artifacts").doc(APP_ID).collection("public").doc("data").collection("calls");
        
        // Find calls with Transcription Error
        const snapshot = await callsRef.where("status", "==", "Transcription Error").limit(limit).get();
        
        if (snapshot.empty) {
            return res.json({ success: true, message: "No failed calls found." });
        }
        
        const promises = snapshot.docs.map(async (docSnap) => {
            const data = docSnap.data();
            const location = data.location || "glendale";
            const toNumber = data.toNumber || "";
            const recordingUrl = data.recordingUrl || data.recording_url;
            
            if (recordingUrl && OPENAI_API_KEY) {
                const analysis = await processAudioAndAnalyze(docSnap.id, recordingUrl, OPENAI_API_KEY, MANGO_TOKEN, toNumber, location, data.direction || 'unknown');
                if (analysis) {
                    await docSnap.ref.set({
                        summary: analysis.summary || "Call processed",
                        sentiment: analysis.sentiment || "Neutral",
                        priority: analysis.priority || "NORMAL",
                        assignment: analysis.assignment || "Front Desk Supervisor",
                        employeeName: analysis.employee_name || null,
                        isResolved: analysis.is_resolved || false,
                        reason: analysis.reason || null,
                        status: "Waiting",
                        location: location
                    }, { merge: true });
                }
            }
        });
        
        await Promise.all(promises);
        
        res.json({ success: true, reprocessed: snapshot.size });
    } catch (e) {
        console.error("Reprocess error:", e);
        res.status(500).json({ error: e.message });
    }
});

exports.debugDb = require('./debug').debugDb;
exports.fixCalls = require('./debug').fixCalls;
