// One-off read-only script: lists fds-operations-hub `users` docs for a
// manual name cross-check against the migrated payroll_staff roster.
const admin = require('firebase-admin');
const path = require('path');

const keyPath = process.env.TARGET_SA_KEY_PATH;
if (!keyPath) {
  console.error('Set TARGET_SA_KEY_PATH to the fds-operations-hub service account JSON key.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();

async function run() {
  const snapshot = await db.collection('users').get();
  console.log(`Found ${snapshot.size} user(s) in fds-operations-hub /users:\n`);
  snapshot.forEach((doc) => {
    const d = doc.data();
    const name = [d.firstName, d.lastName].filter(Boolean).join(' ') || '(no name)';
    console.log(`- ${name} <${d.email || 'no email'}> role=${d.role || '?'} payrollRole=${d.payrollRole || 'unset'} uid=${doc.id}`);
  });
}

run().catch((err) => { console.error(err); process.exit(1); });
