// One-off migration: moves `rate` out of the already-migrated payroll_staff
// docs into the new payroll_staffRates collection, and strips `rate` from
// payroll_staff so it's no longer readable by every authenticated user.
//
// Usage: TARGET_SA_KEY_PATH=./fds-operations-hub-key.json node split-staff-rates.js [--dry-run]

const admin = require('firebase-admin');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');
const keyPath = process.env.TARGET_SA_KEY_PATH;

if (!keyPath) {
  console.error('Set TARGET_SA_KEY_PATH to the fds-operations-hub service account JSON key.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();

async function run() {
  const snapshot = await db.collection('payroll_staff').get();
  console.log(dryRun ? 'DRY RUN — no writes will be made.' : 'LIVE RUN — splitting rates out of payroll_staff.');
  console.log(`Found ${snapshot.size} staff doc(s).\n`);

  let moved = 0;
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (data.rate === undefined) continue;

    console.log(`${docSnap.id} (${data.name}): rate ${data.rate} -> payroll_staffRates/${docSnap.id}, stripped from payroll_staff`);
    if (!dryRun) {
      await db.collection('payroll_staffRates').doc(docSnap.id).set({ rate: data.rate });
      await db.collection('payroll_staff').doc(docSnap.id).update({ rate: admin.firestore.FieldValue.delete() });
    }
    moved++;
  }

  console.log(`\nDone. ${moved} rate(s) ${dryRun ? 'would be' : 'were'} split out.`);
}

run().catch((err) => {
  console.error('Split failed:', err);
  process.exit(1);
});
