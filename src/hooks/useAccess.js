// -----------------------------------------------------------------------------
// useAccess.js (Custom React Hook)
// -----------------------------------------------------------------------------
// Anyone can create an account on the login screen, so signing in isn't
// enough to see practice data: the account must also be approved by an owner
// or payroll admin (Financials → Team → App Access), which sets
// `approved: true` on the user's `users/{uid}` profile. firestore.rules and
// the Cloud Functions enforce this; this hook just tells the app whether to
// show the hub or the "waiting for approval" screen.
//
// Returns status: 'loading' | 'approved' | 'pending'.
// -----------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { OWNER_EMAILS } from '../utils/payrollConstants';

export function useAccess(user) {
  // Tagged with the uid it belongs to, so a stale result from a previous
  // sign-in is never mistaken for the current user's.
  const [state, setState] = useState({ uid: null, profile: null });

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    let createdProfile = false;

    const unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists() && !createdProfile) {
        // Accounts made before sign-up saved a profile (or made in the
        // Firebase console) have no users doc, so admins couldn't see them to
        // approve them. Create a minimal one; firestore.rules lets a user
        // write their own profile but never their own approval.
        createdProfile = true;
        setDoc(ref, {
          uid: user.uid,
          ...(user.email ? { email: user.email } : {}),
          createdAt: serverTimestamp(),
        }, { merge: true }).catch((err) => console.error('Failed to create user profile:', err));
      }
      setState({ uid: user.uid, profile: snap.exists() ? snap.data() : null });
    }, (err) => {
      console.error('Access listener error:', err);
      setState({ uid: user.uid, profile: null });
    });

    return () => unsubscribe();
  }, [user]);

  if (!user) return { status: 'pending', profile: null };
  const profile = state.uid === user.uid ? state.profile : null;
  if (OWNER_EMAILS.includes(user.email)) return { status: 'approved', profile };
  if (state.uid !== user.uid) return { status: 'loading', profile: null };
  return { status: profile?.approved === true ? 'approved' : 'pending', profile };
}
