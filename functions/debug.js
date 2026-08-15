// One-off admin/debug HTTP functions. Deliberately NOT `invoker: "public"` —
// Cloud Functions v2 defaults to requiring an authenticated IAM invoker, so
// these can only be triggered by someone with Cloud Functions Invoker
// permission on this project (e.g. via `gcloud functions call` or an
// identity token), never by an anonymous URL visit.
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

exports.debugDb = onRequest(async (req, res) => {
    try {
        const snapshot = await db.collection("artifacts").doc("fds-operations-hub").collection("public").doc("data").collection("calls")
            .orderBy("createdAt", "desc")
            .limit(500)
            .get();
            
        let internalCount = 0;
        const internalExamples = [];
        
        snapshot.forEach(doc => {
            const c = doc.data();
            const fromLen = (c.fromNumber || "").replace(/[^0-9]/g, '').length;
            const toLen = (c.toNumber || "").replace(/[^0-9]/g, '').length;
            
            if ((fromLen > 0 && fromLen <= 4) || (toLen > 0 && toLen <= 4)) {
                internalCount++;
                if (internalExamples.length < 5) {
                    internalExamples.push({
                        from: c.fromNumber,
                        to: c.toNumber,
                        date: c.createdAt ? c.createdAt.toDate().toISOString() : "unknown",
                        summary: c.summary,
                        direction: c.direction
                    });
                }
            }
        });
        
        res.json({ checked: snapshot.size, internalCount, internalExamples });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

exports.realTally = onRequest(async (req, res) => {
    try {
        const start = new Date("2026-08-05T00:00:00-07:00");
        const end = new Date("2026-08-06T00:00:00-07:00");
        
        const snapshot = await db.collection("artifacts").doc("fds-operations-hub").collection("public").doc("data").collection("calls")
            .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(start))
            .where("createdAt", "<", admin.firestore.Timestamp.fromDate(end))
            .get();
            
        const calls = [];
        snapshot.forEach(doc => calls.push({ id: doc.id, ...doc.data() }));
        
        const outboundCalls = calls.filter((c) => {
          let isOutbound = false;
          if (c.direction === 'outbound') {
            isOutbound = true;
          } else if (c.direction === 'inbound') {
            return false;
          }
          if (!isOutbound && c.rawEvent && typeof c.rawEvent === 'string') {
            const match = c.rawEvent.match(/"direction"\s*:\s*"([^"]+)"/i);
            if (match && match[1]) {
              const dir = match[1].toLowerCase();
              if (dir === 'outbound') isOutbound = true;
              else if (dir === 'inbound') return false;
            }
          }
          if (!isOutbound) {
            if (c.isOutbound === true) {
              isOutbound = true;
            } else {
              const n = (c.fromName || c.name || '').toLowerCase();
              if ((n.includes('family dental') || n.includes('chewy dental')) && !n.includes('provider')) {
                isOutbound = true;
              }
            }
          }
          return isOutbound;
        });

        const NAME_ALIASES = {
          'devon': 'DEVIN', 'alacia': 'ALICIA', 'iliana': 'EYLIANNA',
          'aliana': 'EYLIANNA', 'eliana': 'EYLIANNA', 'alicia': 'ALESSIA',
          'lisa': 'ALESSIA', 'mara': 'MARAH', 'mary ann': 'MARIANNE',
          'b': 'IGNORE', 'bea': 'IGNORE', 'tim': 'IGNORE'
        };

        const tallies = {};
        let blankCount = 0;
        
        outboundCalls.forEach(c => {
          const rawName = (c.employeeName || '').toLowerCase().trim();
          if (!rawName || rawName === 'unknown') {
              blankCount++;
              return;
          }
          let empName = rawName;
          if (NAME_ALIASES[rawName]) {
            if (NAME_ALIASES[rawName] === 'IGNORE') return;
            empName = NAME_ALIASES[rawName].toLowerCase();
          }
          tallies[empName] = (tallies[empName] || 0) + 1;
        });

        res.json({ total: calls.length, outbound: outboundCalls.length, tallies, blankCount });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

exports.fixCalls = onRequest(async (req, res) => {
    try {
        const callsRef = db.collection("artifacts").doc("fds-operations-hub").collection("public").doc("data").collection("calls");
        
        // Find outbound calls that were wrongly resolved by the AI.
        const snapshot = await callsRef.where("direction", "==", "outbound").where("status", "==", "Resolved").get();
        let count = 0;
        let batch = db.batch();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.resolvedBy && data.resolvedBy.length < 20) { // e.g. "Marah", "Devin", "Auto-Resolve"
                batch.update(doc.ref, {
                    status: "Waiting",
                    isResolved: false,
                    resolvedBy: admin.firestore.FieldValue.delete(),
                    resolvedAt: admin.firestore.FieldValue.delete()
                });
                count++;
            }
        });
        await batch.commit();
        res.json({ success: true, fixedCount: count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

exports.clearErrors = onRequest(async (req, res) => {
    try {
        const callsRef = db.collection("artifacts").doc("fds-operations-hub").collection("public").doc("data").collection("calls");
        const snapshot = await callsRef.where("status", "==", "Transcription Error").get();
        console.log(`Found ${snapshot.size} calls to resolve`);
        let count = 0;
        let batch = db.batch();
        for (const doc of snapshot.docs) {
            batch.update(doc.ref, {
                status: "Resolved",
                isResolved: true,
                summary: "Transcription Error - Auto-resolved"
            });
            count++;
            if (count % 400 === 0) {
                await batch.commit();
                console.log(`Committed ${count} updates...`);
                batch = db.batch();
            }
        }
        if (count % 400 !== 0) {
            await batch.commit();
            console.log(`Committed final updates... total: ${count}`);
        }
        res.json({ success: true, clearedCount: count });
    } catch (e) {
        console.error("Error in clearErrors:", e);
        res.status(500).json({ error: e.message });
    }
});
