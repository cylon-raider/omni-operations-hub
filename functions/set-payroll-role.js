// One-off: manually set payrollRole for a given user UID.
// Usage: TARGET_SA_KEY_PATH=./fds-operations-hub-key.json node set-payroll-role.js <uid> <admin|viewer>
const admin = require('firebase-admin');
const path = require('path');

const keyPath = process.env.TARGET_SA_KEY_PATH;
const [, , uid, role] = process.argv;

if (!keyPath || !uid || !['admin', 'viewer'].includes(role)) {
  console.error('Usage: TARGET_SA_KEY_PATH=... node set-payroll-role.js <uid> <admin|viewer>');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();

db.collection('users').doc(uid).update({ payrollRole: role })
  .then(() => console.log(`Set payrollRole=${role} for ${uid}`))
  .catch((err) => { console.error(err); process.exit(1); });
