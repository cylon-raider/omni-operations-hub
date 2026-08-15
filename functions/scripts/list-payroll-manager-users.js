// One-off read-only script: lists fds-payroll's `users` docs (old
// PayrollManager admin/viewer accounts) so admin status can be manually
// cross-referenced against fds-operations-hub accounts.
const admin = require('firebase-admin');
const path = require('path');

const keyPath = process.env.SOURCE_SA_KEY_PATH;
if (!keyPath) {
  console.error('Set SOURCE_SA_KEY_PATH to the fds-payroll service account JSON key.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();

async function run() {
  const snapshot = await db.collection('users').get();
  console.log(`Found ${snapshot.size} user(s) in fds-payroll /users:\n`);
  snapshot.forEach((doc) => {
    const d = doc.data();
    console.log(`- <${d.email || 'no email'}> role=${d.role || '?'} uid=${doc.id}`);
  });
}

run().catch((err) => { console.error(err); process.exit(1); });
