// One-off: recovers calls stuck in "Transcription Error" (e.g. after an
// OpenAI billing lapse) by re-running the same transcribe+analyze pipeline
// as functions/index.js's processAudioAndAnalyze, using each call's stored
// recordingUrl. Run locally (not deployed) so it doesn't depend on Cloud
// Functions IAM invoker permissions.
//
// Usage: TARGET_SA_KEY_PATH=../fds-operations-hub-key.json node recover-transcription-errors.js [--dry-run] [--limit N]
const admin = require('firebase-admin');
const FormData = require('form-data');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

// Minimal .env loader (dotenv isn't a dependency here) — only used locally.
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1');
    }
  }
}

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyIds = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
const limit = limitArg ? parseInt(limitArg.split('=')[1] || process.argv[process.argv.indexOf(limitArg) + 1], 10) : Infinity;

const keyPath = process.env.TARGET_SA_KEY_PATH;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MANGO_TOKEN = process.env.MANGO_TOKEN;
const APP_ID = 'fds-operations-hub';

if (!keyPath || !OPENAI_API_KEY) {
  console.error('Set TARGET_SA_KEY_PATH and ensure functions/.env has OPENAI_API_KEY.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();

async function processAudioAndAnalyze(callId, recordingUrl, toNumber, location, direction) {
  const callRef = db.collection('artifacts').doc(APP_ID).collection('public').doc('data').collection('calls').doc(callId);

  const fetchOptions = {};
  if (MANGO_TOKEN && !recordingUrl.includes('amazonaws.com')) {
    fetchOptions.headers = { Authorization: `Bearer ${MANGO_TOKEN}` };
  }

  const audioRes = await fetch(recordingUrl, fetchOptions);
  if (!audioRes.ok) {
    throw new Error(`Failed to fetch recording: ${audioRes.status} ${audioRes.statusText}`);
  }

  const arrayBuffer = await audioRes.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'call.mp3', contentType: 'audio/mpeg' });
  form.append('model', 'whisper-1');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, ...form.getHeaders() },
    body: form.getBuffer(),
  });
  if (!whisperRes.ok) {
    const errBody = await whisperRes.text();
    throw new Error(`Whisper API error ${whisperRes.status}: ${errBody.slice(0, 200)}`);
  }
  const whisperData = await whisperRes.json();
  const transcript = whisperData.text;
  if (!transcript || transcript.trim().length === 0) {
    throw new Error('Whisper returned empty transcript');
  }

  const glendaleStaff = 'Jen, Lisa, Jamie, Addison, Mariana, Brandy, Devin, Liz, Alessia, Marianne, Aubrey, Marah, Pam, Eylianna, Dan';
  const litchfieldStaff = 'Jen, Melia, Cynthia, Lupita, Rachel, Aron';
  const validStaff = location === 'litchfield' ? litchfieldStaff : glendaleStaff;

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

  const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: gptPrompt }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!gptRes.ok) {
    const errBody = await gptRes.text();
    throw new Error(`GPT API error ${gptRes.status}: ${errBody.slice(0, 200)}`);
  }
  const gptData = await gptRes.json();
  const analysis = JSON.parse(gptData.choices[0].message.content);

  if (dryRun) {
    console.log(`  [dry-run] would update ${callId}: priority=${analysis.priority}, assignment=${analysis.assignment}, transcript length=${transcript.length}`);
    return analysis;
  }

  await callRef.update({
    transcript,
    summary: analysis.summary || '',
    sentiment: analysis.sentiment || 'Neutral',
    priority: analysis.priority || 'NORMAL',
    assignment: analysis.assignment || 'Front Desk Supervisor',
    reason: analysis.reason || '',
    employeeName: analysis.employee_name || null,
    patientName: analysis.patient_name || null,
    isOutbound: analysis.is_outbound || false,
    isResolved: analysis.is_resolved || false,
    status: 'Waiting',
    errorLog: admin.firestore.FieldValue.delete(),
    errorAt: admin.firestore.FieldValue.delete(),
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (direction === 'outbound' && analysis.is_outbound && analysis.is_resolved && toNumber) {
    const callsRef = db.collection('artifacts').doc(APP_ID).collection('public').doc('data').collection('calls');
    const snapshot = await callsRef.where('fromNumber', '==', toNumber).where('status', '!=', 'Resolved').get();
    if (!snapshot.empty) {
      const batch = db.batch();
      snapshot.forEach((doc) => {
        batch.update(doc.ref, {
          status: 'Resolved',
          resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          resolvedBy: analysis.employee_name || 'Auto-Resolve',
        });
      });
      await batch.commit();
    }
  }

  return analysis;
}

async function run() {
  const callsRef = db.collection('artifacts').doc(APP_ID).collection('public').doc('data').collection('calls');
  let snapshotDocs = (await callsRef.where('status', '==', 'Transcription Error').get()).docs;
  if (onlyIds) snapshotDocs = snapshotDocs.filter((d) => onlyIds.includes(d.id));
  console.log(`${dryRun ? 'DRY RUN — ' : ''}Processing ${snapshotDocs.length} call(s).\n`);

  let recovered = 0;
  let failed = 0;
  let processedCount = 0;

  for (const docSnap of snapshotDocs) {
    if (processedCount >= limit) break;
    processedCount++;
    const data = docSnap.data();
    const recordingUrl = data.recordingUrl || data.recording_url;
    if (!recordingUrl) {
      console.log(`SKIP ${docSnap.id} (${data.fromName}): no recordingUrl`);
      failed++;
      continue;
    }
    try {
      await processAudioAndAnalyze(docSnap.id, recordingUrl, data.toNumber, data.location || 'glendale', data.direction || 'unknown');
      console.log(`OK   ${docSnap.id} (${data.fromName})`);
      recovered++;
    } catch (err) {
      console.log(`FAIL ${docSnap.id} (${data.fromName}): ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Recovered: ${recovered}, Failed: ${failed}, Total checked: ${processedCount}`);
}

run().catch((err) => { console.error(err); process.exit(1); });
