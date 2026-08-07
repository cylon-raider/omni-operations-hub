const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', '..', 'fds-operations-hub-firebase-adminsdk-hskle-a337ab5ee8.json');
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function run() {
    const start = new Date("2026-08-05T00:00:00-07:00");
    const end = new Date("2026-08-06T00:00:00-07:00");
    
    console.log("Fetching calls between", start, "and", end);

    const snapshot = await db.collection("artifacts/fds-operations-hub/public/data/calls")
        .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(start))
        .where("createdAt", "<", admin.firestore.Timestamp.fromDate(end))
        .get();
        
    const calls = [];
    snapshot.forEach(doc => calls.push({ id: doc.id, ...doc.data() }));
    
    console.log(`Total calls fetched for August 5: ${calls.length}`);

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
          if (n.includes('family dental') && !n.includes('provider')) {
            isOutbound = true;
          }
        }
      }

      return isOutbound;
    });
    
    console.log(`Total outbound calls: ${outboundCalls.length}`);

    const NAME_ALIASES = {
      'devon': 'DEVIN',
      'alacia': 'ALICIA',
      'iliana': 'EYLIANNA',
      'aliana': 'EYLIANNA',
      'eliana': 'EYLIANNA',
      'alicia': 'ALESSIA',
      'lisa': 'ALESSIA',
      'mara': 'MARAH',
      'mary ann': 'MARIANNE',
      'b': 'IGNORE',
      'bea': 'IGNORE',
      'tim': 'IGNORE'
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

    console.log("Tallies:", tallies);
    console.log("Missing/Blank names:", blankCount);
}

run().catch(console.error);
