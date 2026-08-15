// One-time migration: copies staff/schedule/daily_logs from the old
// PayrollManager Firebase project (fds-payroll) into this project
// (fds-operations-hub) under payroll_staff / payroll_schedule / payroll_dailyLogs.
//
// This only ever ADDS documents to fds-operations-hub — it never touches
// calls/users or anything Live Dispatch depends on, and never writes back
// to fds-payroll.
//
// Usage:
//   SOURCE_SA_KEY_PATH=./fds-payroll-key.json TARGET_SA_KEY_PATH=./fds-operations-hub-key.json node migrate-payroll-data.js --dry-run
//   SOURCE_SA_KEY_PATH=./fds-payroll-key.json TARGET_SA_KEY_PATH=./fds-operations-hub-key.json node migrate-payroll-data.js
//
// Service account keys: Firebase Console → Project Settings → Service Accounts
// → Generate new private key, for each of the two projects. Do NOT commit
// these key files (see functions/.gitignore).

const admin = require('firebase-admin');
const path = require('path');

const dryRun = process.argv.includes('--dry-run');

const sourceKeyPath = process.env.SOURCE_SA_KEY_PATH;
const targetKeyPath = process.env.TARGET_SA_KEY_PATH;

if (!sourceKeyPath || !targetKeyPath) {
  console.error('Set SOURCE_SA_KEY_PATH (fds-payroll) and TARGET_SA_KEY_PATH (fds-operations-hub) env vars to service account JSON key files.');
  process.exit(1);
}

const sourceApp = admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(sourceKeyPath))),
}, 'source');

const targetApp = admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(targetKeyPath))),
}, 'target');

const sourceDb = sourceApp.firestore();
const targetDb = targetApp.firestore();

const COLLECTIONS = [
  { from: 'staff', to: 'payroll_staff' },
  { from: 'schedule', to: 'payroll_schedule' },
  { from: 'daily_logs', to: 'payroll_dailyLogs' },
];

async function migrateCollection(from, to) {
  const snapshot = await sourceDb.collection(from).get();
  console.log(`\n${from} -> ${to}: ${snapshot.size} document(s)`);

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (dryRun) {
      console.log(`  [dry-run] would write ${to}/${docSnap.id}:`, JSON.stringify(data));
    } else {
      await targetDb.collection(to).doc(docSnap.id).set(data, { merge: true });
      console.log(`  wrote ${to}/${docSnap.id}`);
    }
  }
  return snapshot.size;
}

async function run() {
  console.log(dryRun ? 'DRY RUN — no writes will be made.' : 'LIVE RUN — writing to fds-operations-hub.');
  let total = 0;
  for (const { from, to } of COLLECTIONS) {
    total += await migrateCollection(from, to);
  }
  console.log(`\nDone. ${total} document(s) ${dryRun ? 'would be' : 'were'} migrated.`);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
