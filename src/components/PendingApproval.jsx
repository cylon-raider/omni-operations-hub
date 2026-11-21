// -----------------------------------------------------------------------------
// PendingApproval.jsx
// -----------------------------------------------------------------------------
// Shown to a signed-in account that hasn't been approved yet (see
// useAccess.js). Opens the hub by itself the moment an admin approves it,
// because useAccess listens to the user's profile live.
// -----------------------------------------------------------------------------
import React from 'react';
import { Clock, LogOut } from 'lucide-react';

export default function PendingApproval({ user, onLogout }) {
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
          <h2 className="text-lg font-black text-white mb-2">Waiting for approval</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Your account <span className="font-bold text-white break-all">{user?.email}</span> has been created,
            but a practice owner or office manager needs to approve it before you can see calls and patient information.
          </p>
          <p className="text-sm text-gray-400 leading-relaxed mt-3">
            Let them know you've signed up. They approve accounts under <span className="font-semibold text-gray-200">Financials → Team → App Access</span>.
            This page opens the hub by itself once you're approved.
          </p>

          <button
            onClick={onLogout}
            className="mt-6 w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
