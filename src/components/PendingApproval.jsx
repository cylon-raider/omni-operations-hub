// -----------------------------------------------------------------------------
// PendingApproval.jsx
// -----------------------------------------------------------------------------
// Shown to a signed-in account that hasn't been approved yet (see
// useAccess.js). Two steps:
//   1. Confirm the email address — the verification link sent at sign-up.
//      Once Firebase says it's verified, we record `emailVerified: true` on
//      the user's profile (firestore.rules only allows that when their
//      sign-in token agrees), which is what lets an admin approve them.
//   2. Wait for an owner or manager to approve the account. The page opens
//      the hub by itself once approved, because useAccess listens live.
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { CheckCircle2, Clock, LogOut, Mail, RefreshCw } from 'lucide-react';
import { db } from '../config/firebase';

function Step({ number, done, title, children }) {
  return (
    <div className="flex gap-3">
      <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-black ${done ? 'bg-primary-500/20 text-primary-300' : 'bg-white/10 text-gray-300'}`}>
        {done ? <CheckCircle2 size={16} /> : number}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className={`text-sm font-bold ${done ? 'text-primary-300' : 'text-white'}`}>{title}</h3>
        <div className="text-sm text-gray-300 leading-relaxed mt-1">{children}</div>
      </div>
    </div>
  );
}

export default function PendingApproval({ user, profile, onLogout }) {
  const [verifiedNow, setVerifiedNow] = useState(false);
  const [busy, setBusy] = useState(null); // 'check' | 'send' | null
  const [notice, setNotice] = useState(null); // { kind: 'info' | 'error', text }
  const verified = profile?.emailVerified === true || verifiedNow;

  // Ask Firebase whether the link has been clicked; if so, record it on the
  // profile. The token is refreshed first because the rules compare against
  // its email_verified claim, which is only updated on refresh.
  const checkVerified = useCallback(async ({ quiet = false } = {}) => {
    try {
      await user.reload();
      if (!user.emailVerified) {
        if (!quiet) setNotice({ kind: 'info', text: 'Not verified yet. Click the link in the email, then try again.' });
        return;
      }
      await user.getIdToken(true);
      await setDoc(doc(db, 'users', user.uid), { emailVerified: true }, { merge: true });
      setVerifiedNow(true);
      setNotice(null);
    } catch (err) {
      console.error('Verification check failed:', err);
      if (!quiet) setNotice({ kind: 'error', text: 'Couldn\'t check right now. Try again in a moment.' });
    }
  }, [user]);

  // Check when the page opens and whenever they come back to this tab
  // (typically right after clicking the link in their email).
  useEffect(() => {
    if (verified) return;
    const onFocus = () => { checkVerified({ quiet: true }); };
    const initial = setTimeout(onFocus, 0);
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(initial);
      window.removeEventListener('focus', onFocus);
    };
  }, [verified, checkVerified]);

  const handleCheck = async () => {
    setBusy('check');
    await checkVerified();
    setBusy(null);
  };

  const handleResend = async () => {
    setBusy('send');
    try {
      await sendEmailVerification(user);
      setNotice({ kind: 'info', text: `Sent a new link to ${user.email}. Check your spam folder if it isn't there in a minute.` });
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err.code === 'auth/too-many-requests'
          ? 'Too many emails sent. Wait a few minutes, then try again.'
          : 'Couldn\'t send the email. Try again in a moment.',
      });
    }
    setBusy(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-primary-900 flex items-center justify-center p-4">
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="FDS Logo" className="w-20 h-20 mx-auto rounded-2xl object-contain mb-4 shadow-lg shadow-black/20" />
          <h1 className="text-3xl font-black text-white tracking-tight">FDS HUB</h1>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          <div className="w-11 h-11 rounded-xl bg-primary-500/15 border border-primary-500/30 flex items-center justify-center mb-4">
            <Clock size={20} className="text-primary-300" />
          </div>
          <h2 className="text-lg font-black text-white mb-1">Almost there</h2>
          <p className="text-sm text-gray-400 mb-6">
            <span className="font-bold text-gray-200 break-all">{user?.email}</span> needs two things before it can see calls and patient information.
          </p>

          <div className="space-y-5">
            <Step number={1} done={verified} title={verified ? 'Email confirmed' : 'Confirm your email'}>
              {verified ? (
                'Thanks — your email address is confirmed.'
              ) : (
                <>
                  <p>We sent a link to your email. Click it, then come back to this page.</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={handleCheck}
                      disabled={busy !== null}
                      className="px-3 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5"
                    >
                      <RefreshCw size={14} className={busy === 'check' ? 'animate-spin' : ''} /> I've clicked the link
                    </button>
                    <button
                      onClick={handleResend}
                      disabled={busy !== null}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/10 text-gray-200 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5"
                    >
                      <Mail size={14} /> Send a new link
                    </button>
                  </div>
                  {notice && (
                    <p className={`text-xs mt-3 ${notice.kind === 'error' ? 'text-red-300' : 'text-gray-400'}`}>{notice.text}</p>
                  )}
                </>
              )}
            </Step>

            <Step number={2} done={false} title="Wait for approval">
              A practice owner or office manager approves new accounts under{' '}
              <span className="font-semibold text-gray-100">Financials → Team → App Access</span>
              {verified ? '. Let them know you\'ve signed up.' : ', once your email is confirmed.'}{' '}
              This page opens the hub by itself once you're approved.
            </Step>
          </div>

          <button
            onClick={onLogout}
            className="mt-8 w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
