// One-off, for rolling out account approval (see firestore.rules → isApproved).
// Run it BEFORE deploying the new rules so existing staff aren't locked out.
//
// Lists every sign-in account with its approval state. Nothing is changed
// unless you pass --approve-all or --approve <email...>.
//
//   TARGET_SA_KEY_PATH=./fds-operations-hub-key.json node approve-existing-users.js
//   TARGET_SA_KEY_PATH=... node approve-existing-users.js --approve-all
//   TARGET_SA_KEY_PATH=... node approve-existing-users.js --approve jane@x.com bob@y.com
//
// Read the list first: anyone could have created an account, so only approve
// the people you recognize (anyone left out can be approved later in
// Financials → Team → App Access).
const admin = require('firebase-admin');
const path = require('path');

const OWNER_EMAILS = ['luckyj5521@gmail.com', 'cmarkel@gmail.com'];

const keyPath = process.env.TARGET_SA_KEY_PATH;
const args = process.argv.slice(2);
const approveAll = args.includes('--approve-all');
const approveIdx = args.indexOf('--approve');
const approveEmails = approveIdx >= 0 ? args.slice(approveIdx + 1).map((e) => e.toLowerCase()) : [];

if (!keyPath && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Usage: TARGET_SA_KEY_PATH=... node approve-existing-users.js [--approve-all | --approve <email...>]');
  process.exit(1);
}
admin.initializeApp(keyPath
  ? { credential: admin.credential.cert(require(path.resolve(keyPath))) }
  : { projectId: process.env.GCLOUD_PROJECT || 'demo-fds-hub' });
const db = admin.firestore();

const fmt = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');

(async () => {
  const accounts = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    accounts.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  const rows = [];
  for (const u of accounts) {
    const snap = await db.collection('users').doc(u.uid).get();
    const profile = snap.exists ? snap.data() : null;
    const email = (u.email || '').toLowerCase();
    const status = OWNER_EMAILS.includes(email) ? 'owner' : profile?.approved === true ? 'approved' : 'PENDING';
    rows.push({ u, email, profile, status });
  }
  rows.sort((a, b) => a.status.localeCompare(b.status) || a.email.localeCompare(b.email));

  console.log(`${accounts.length} accounts:\n`);
  console.log('STATUS    EMAIL                                   NAME                      CREATED     LAST SIGN-IN');
  for (const { u, email, profile, status } of rows) {
    const name = u.displayName || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || '';
    console.log(`${status.padEnd(9)} ${(email || '(no email) ' + u.uid).padEnd(39)} ${name.slice(0, 25).padEnd(25)} ${fmt(u.metadata.creationTime)}  ${fmt(u.metadata.lastSignInTime)}`);
  }

  const toApprove = rows.filter(({ email, status }) =>
    status === 'PENDING' && (approveAll || approveEmails.includes(email)));
  const unknown = approveEmails.filter((e) => !rows.some((r) => r.email === e));
  if (unknown.length) console.log(`\nNo account found for: ${unknown.join(', ')}`);
  if (!approveAll && !approveEmails.length) {
    console.log('\nNothing changed. Re-run with --approve-all or --approve <email...> to approve.');
    return;
  }

  for (const { u, email } of toApprove) {
    await db.collection('users').doc(u.uid).set({
      uid: u.uid,
      ...(email ? { email } : {}),
      approved: true,
      approvedBy: 'approve-existing-users script',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`Approved ${email || u.uid}`);
  }
  console.log(`\nDone: approved ${toApprove.length} account(s).`);
})().catch((err) => { console.error(err); process.exit(1); });
