const admin = require('firebase-admin');
const path = require('path');

const keyPath = process.env.TARGET_SA_KEY_PATH;
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();

async function run() {
  const snapshot = await db.collection('payroll_staffRates').get();
  console.log(`Found ${snapshot.size} rate doc(s):\n`);
  snapshot.forEach((d) => {
    const data = d.data();
    console.log(`${d.id}: rate=${JSON.stringify(data.rate)} typeof=${typeof data.rate}`);
  });
}

run().catch((err) => { console.error(err); process.exit(1); });
