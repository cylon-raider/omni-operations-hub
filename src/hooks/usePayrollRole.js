// -----------------------------------------------------------------------------
// usePayrollRole.js (Custom React Hook)
// -----------------------------------------------------------------------------
// Reads (and bootstraps) the `payrollRole` field on the user's existing
// `users/{uid}` profile doc. This is separate from the doc's `role` field
// (job title, e.g. "Staff") so payroll access doesn't collide with it.
// -----------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { OWNER_EMAILS } from '../utils/payrollConstants';

export function usePayrollRole(user) {
  const [payrollRole, setPayrollRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPayrollRole(null);
      setLoading(false);
      return;
    }

    const userRef = doc(db, 'users', user.uid);

    // Bootstrap payrollRole once if it's missing, then subscribe for live changes
    // (so promotions/demotions from the Team → App Access tab apply immediately).
    (async () => {
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists() || snap.data().payrollRole === undefined) {
          const bootstrapRole = OWNER_EMAILS.includes(user.email) ? 'admin' : 'viewer';
          await setDoc(userRef, { payrollRole: bootstrapRole }, { merge: true });
        }
      } catch (err) {
        console.error('Failed to bootstrap payrollRole:', err);
      }
    })();

    const unsubscribe = onSnapshot(userRef, (snap) => {
      setPayrollRole(snap.data()?.payrollRole || 'viewer');
      setLoading(false);
    }, (err) => {
      console.error('payrollRole listener error:', err);
      setPayrollRole('viewer');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  return { payrollRole, isPayrollAdmin: payrollRole === 'admin', loading };
}
