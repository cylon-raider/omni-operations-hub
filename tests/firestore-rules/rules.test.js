// Tests for firestore.rules — run with `npm test` in this folder (starts the
// Firestore emulator, which needs Java). They cover who can get in at all
// (account approval) and what staff may change on a call.
import { after, before, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp,
  setDoc, setLogLevel, updateDoc, where,
} from 'firebase/firestore';

// The SDK logs every rejected write as a warning; the rejections here are expected.
setLogLevel('silent');

const RULES = readFileSync(fileURLToPath(new URL('../../firestore.rules', import.meta.url)), 'utf8');
const CALLS = 'artifacts/fds-operations-hub/public/data/calls';
const CONFIRMATIONS = 'artifacts/fds-operations-hub/public/data/confirmations';
const HUDDLES = 'artifacts/fds-operations-hub/public/data/huddles';

// Accounts used throughout. `owner` has no users doc at all, which must still
// work (owners are approved by email).
const PEOPLE = {
  owner: { uid: 'owner', email: 'cmarkel@gmail.com' },
  admin: { uid: 'admin', email: 'manager@example.com', doc: { approved: true, payrollRole: 'admin' } },
  staff: { uid: 'staff', email: 'staff@example.com', doc: { approved: true, payrollRole: 'viewer' } },
  pending: { uid: 'pending', email: 'stranger@example.com', doc: { payrollRole: 'viewer' } },
  revokedAdmin: { uid: 'revokedAdmin', email: 'former@example.com', doc: { approved: false, payrollRole: 'admin' } },
};

let env;
const as = (who) => env.authenticatedContext(PEOPLE[who].uid, { email: PEOPLE[who].email }).firestore();
const callRef = (db, id = 'call1') => doc(db, CALLS, id);

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-fds-hub', firestore: { rules: RULES } });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const p of Object.values(PEOPLE)) {
      if (p.doc) await setDoc(doc(db, 'users', p.uid), { uid: p.uid, email: p.email, ...p.doc });
    }
    await setDoc(callRef(db), {
      fromName: 'Pat Patient', fromNumber: '6025550100', toNumber: '6235550199',
      assignment: 'Billing', priority: 'NORMAL', status: 'Waiting', location: 'glendale',
      direction: 'inbound', summary: 'Asked about a bill.', transcript: 'Hi…', createdAt: new Date(),
    });
    await setDoc(doc(db, CONFIRMATIONS, 'glendale_1'), { patientName: 'Pat', status: 'unconfirmed' });
    await setDoc(doc(db, HUDDLES, 'glendale_2026-11-21'), { patients: [] });
    await setDoc(doc(db, 'payroll_staff', 's1'), { name: 'Staff Person', email: 'staff@example.com' });
    await setDoc(doc(db, 'payroll_staffRates', 's1'), { rate: 25 });
  });
});

describe('account approval', () => {
  test('a signed-in but unapproved account cannot read practice data', async () => {
    const db = as('pending');
    await assertFails(getDoc(callRef(db)));
    await assertFails(getDocs(query(collection(db, CALLS), where('location', '==', 'glendale'))));
    await assertFails(getDoc(doc(db, CONFIRMATIONS, 'glendale_1')));
    await assertFails(getDoc(doc(db, HUDDLES, 'glendale_2026-11-21')));
    await assertFails(getDoc(doc(db, 'payroll_staff', 's1')));
    await assertFails(getDoc(doc(db, 'users', 'staff')));
    await assertFails(getDocs(collection(db, 'users')));
  });

  test('an unapproved account cannot write practice data', async () => {
    const db = as('pending');
    await assertFails(updateDoc(callRef(db), { status: 'In Progress' }));
    await assertFails(updateDoc(doc(db, CONFIRMATIONS, 'glendale_1'), { outreach: { status: 'left_message' } }));
  });

  test('an account with no profile doc at all is not approved', async () => {
    const db = env.authenticatedContext('ghost', { email: 'ghost@example.com' }).firestore();
    await assertFails(getDoc(callRef(db)));
  });

  test('approved staff and owners (even without a profile doc) can read', async () => {
    for (const who of ['staff', 'admin', 'owner']) {
      const db = as(who);
      await assertSucceeds(getDoc(callRef(db)));
      await assertSucceeds(getDocs(query(collection(db, CALLS), where('location', '==', 'glendale'))));
      await assertSucceeds(getDoc(doc(db, HUDDLES, 'glendale_2026-11-21')));
      await assertSucceeds(getDoc(doc(db, 'payroll_staff', 's1')));
    }
  });

  test('signed-out visitors get nothing', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(callRef(db)));
    await assertFails(getDoc(doc(db, 'users', 'staff')));
  });

  test('a pending user can read only their own profile', async () => {
    const db = as('pending');
    await assertSucceeds(getDoc(doc(db, 'users', 'pending')));
    await assertFails(getDoc(doc(db, 'users', 'staff')));
  });

  test('a new sign-up can write its own profile (the register form)', async () => {
    const db = env.authenticatedContext('newbie', { email: 'newbie@example.com' }).firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'newbie'), {
      uid: 'newbie', email: 'newbie@example.com', firstName: 'New', lastName: 'Person',
      role: 'Staff', department: 'Unassigned', createdAt: new Date(),
    }, { merge: true }));
    // …and bootstrap its payroll role to viewer, like usePayrollRole.js does.
    await assertSucceeds(setDoc(doc(db, 'users', 'newbie'), { payrollRole: 'viewer' }, { merge: true }));
  });

  test('nobody can approve themselves', async () => {
    const fresh = env.authenticatedContext('sneaky', { email: 'sneaky@example.com' }).firestore();
    await assertFails(setDoc(doc(fresh, 'users', 'sneaky'), { uid: 'sneaky', email: 'sneaky@example.com', approved: true }));
    const db = as('pending');
    await assertFails(updateDoc(doc(db, 'users', 'pending'), { approved: true }));
    await assertFails(setDoc(doc(db, 'users', 'pending'), { approved: true }, { merge: true }));
    await assertFails(updateDoc(doc(db, 'users', 'pending'), { approvedBy: 'cmarkel@gmail.com' }));
  });

  test('a profile cannot claim someone else\'s email', async () => {
    const fresh = env.authenticatedContext('liar', { email: 'liar@example.com' }).firestore();
    await assertFails(setDoc(doc(fresh, 'users', 'liar'), { uid: 'liar', email: 'staff@example.com' }));
    await assertFails(updateDoc(doc(as('pending'), 'users', 'pending'), { email: 'cmarkel@gmail.com' }));
    // Same email in a different case is fine.
    await assertSucceeds(setDoc(doc(fresh, 'users', 'liar'), { uid: 'liar', email: 'Liar@Example.com' }));
  });

  test('payrollRole can only be bootstrapped to the computed value', async () => {
    const fresh = env.authenticatedContext('climber', { email: 'climber@example.com' }).firestore();
    await assertFails(setDoc(doc(fresh, 'users', 'climber'), { payrollRole: 'admin' }, { merge: true }));
    await assertFails(updateDoc(doc(as('staff'), 'users', 'staff'), { payrollRole: 'admin' }));
    const owner = as('owner');
    await assertSucceeds(setDoc(doc(owner, 'users', 'owner'), { payrollRole: 'admin' }, { merge: true }));
  });

  test('a payroll admin can approve and revoke accounts; plain staff cannot', async () => {
    await assertFails(updateDoc(doc(as('staff'), 'users', 'pending'), { approved: true }));
    const admin = as('admin');
    await assertSucceeds(updateDoc(doc(admin, 'users', 'pending'), {
      approved: true, approvedBy: 'manager@example.com', approvedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(callRef(as('pending'))));
    await assertSucceeds(updateDoc(doc(admin, 'users', 'pending'), { approved: false, payrollRole: 'viewer' }));
    await assertFails(getDoc(callRef(as('pending'))));
  });

  test('an owner with no profile doc yet can still approve accounts once bootstrapped as admin', async () => {
    const owner = as('owner');
    await assertSucceeds(setDoc(doc(owner, 'users', 'owner'), { uid: 'owner', email: 'cmarkel@gmail.com', payrollRole: 'admin' }, { merge: true }));
    await assertSucceeds(updateDoc(doc(owner, 'users', 'pending'), { approved: true }));
  });

  test('revoking approval also removes payroll-admin powers', async () => {
    const db = as('revokedAdmin');
    await assertFails(updateDoc(doc(db, 'users', 'pending'), { approved: true }));
    await assertFails(setDoc(doc(db, 'payroll_staff', 's2'), { name: 'X' }));
    await assertFails(getDoc(doc(db, 'payroll_staffRates', 's1')));
  });

  test('pay rates: own rate only, admins see all', async () => {
    await assertSucceeds(getDoc(doc(as('staff'), 'payroll_staffRates', 's1')));
    await assertSucceeds(getDoc(doc(as('admin'), 'payroll_staffRates', 's1')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'staff2'), { approved: true, email: 'other@example.com' });
    });
    const other = env.authenticatedContext('staff2', { email: 'other@example.com' }).firestore();
    await assertFails(getDoc(doc(other, 'payroll_staffRates', 's1')));
  });
});

describe('calls: what staff can change', () => {
  test('the Live Dispatch buttons all still work', async () => {
    const db = as('staff');
    // "Mark In Progress"
    await assertSucceeds(updateDoc(callRef(db), { status: 'In Progress', updatedAt: serverTimestamp() }));
    // Edit queue + priority
    await assertSucceeds(updateDoc(callRef(db), { assignment: 'Hygiene', priority: 'URGENT', updatedAt: serverTimestamp() }));
    // "Escalate"
    await assertSucceeds(updateDoc(callRef(db), { priority: 'ESCALATED', status: 'Waiting', updatedAt: serverTimestamp() }));
    // "Resolve" (useCalls.resolveCall)
    await assertSucceeds(updateDoc(callRef(db), { status: 'Resolved', resolvedAt: serverTimestamp(), resolvedBy: 'staff' }));
  });

  test('staff cannot rewrite what the functions recorded', async () => {
    const db = as('staff');
    await assertFails(updateDoc(callRef(db), { summary: 'Nothing to see here' }));
    await assertFails(updateDoc(callRef(db), { transcript: '' }));
    await assertFails(updateDoc(callRef(db), { fromNumber: '0000000000' }));
    await assertFails(updateDoc(callRef(db), { location: 'litchfield' }));
    await assertFails(updateDoc(callRef(db), { dentrix: { status: 'none' } }));
    await assertFails(updateDoc(callRef(db), { recordingUrl: 'https://example.com/a.mp3' }));
  });

  test('staff cannot set nonsense values on the fields they can change', async () => {
    const db = as('staff');
    await assertFails(updateDoc(callRef(db), { status: 'Processing' }));
    await assertFails(updateDoc(callRef(db), { priority: 'LOW' }));
    await assertFails(updateDoc(callRef(db), { assignment: '' }));
    await assertFails(updateDoc(callRef(db), { status: 'Resolved', resolvedBy: 'someone-else' }));
    await assertFails(updateDoc(callRef(db), { status: 'Resolved', resolvedAt: new Date(2020, 0, 1) }));
  });

  const callback = (overrides = {}) => ({
    fromName: 'Pat Patient', fromNumber: '6025550100', assignment: 'Front Desk Supervisor',
    priority: 'TODAY', reason: 'Wants a cleaning', location: 'glendale', status: 'Waiting',
    createdAt: serverTimestamp(), createdBy: 'staff', ...overrides,
  });

  test('staff can log a manual callback (Quick Entry)', async () => {
    await assertSucceeds(setDoc(doc(as('staff'), CALLS, 'manual1'), callback()));
    const { reason, ...noReason } = callback();
    void reason;
    await assertSucceeds(setDoc(doc(as('staff'), CALLS, 'manual2'), noReason));
  });

  test('manual callbacks cannot carry fabricated call data', async () => {
    const db = as('staff');
    await assertFails(setDoc(doc(db, CALLS, 'm1'), callback({ summary: 'Fake AI summary' })));
    await assertFails(setDoc(doc(db, CALLS, 'm2'), callback({ status: 'Resolved' })));
    await assertFails(setDoc(doc(db, CALLS, 'm3'), callback({ createdBy: 'admin' })));
    await assertFails(setDoc(doc(db, CALLS, 'm4'), callback({ location: 'phoenix' })));
    await assertFails(setDoc(doc(db, CALLS, 'm5'), callback({ createdAt: new Date(2020, 0, 1) })));
    await assertFails(setDoc(doc(db, CALLS, 'm6'), callback({ fromName: 'x'.repeat(101) })));
    await assertFails(setDoc(doc(as('pending'), CALLS, 'm7'), callback({ createdBy: 'pending' })));
  });

  test('only owners can delete calls', async () => {
    await assertFails(deleteDoc(callRef(as('staff'))));
    await assertFails(deleteDoc(callRef(as('admin'))));
    await assertSucceeds(deleteDoc(callRef(as('owner'))));
  });
});

describe('outreach boards', () => {
  test('approved staff can log outreach but not edit the Dentrix data', async () => {
    const db = as('staff');
    await assertSucceeds(updateDoc(doc(db, CONFIRMATIONS, 'glendale_1'), {
      outreach: { status: 'left_message', note: '', by: 'Staff', at: serverTimestamp() },
    }));
    await assertFails(updateDoc(doc(db, CONFIRMATIONS, 'glendale_1'), { status: 'confirmed' }));
  });
});
