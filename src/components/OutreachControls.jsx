// -----------------------------------------------------------------------------
// OutreachControls.jsx
// -----------------------------------------------------------------------------
// "Left message / No answer / Will call back / Wrong number" buttons used on
// call lists (Confirmations, Treatment Follow-up). Shows who logged the current
// outcome with an Undo. `onSet(rowId, status | null)` persists it.
// -----------------------------------------------------------------------------
import React, { useState } from 'react';

const OUTREACH = [
  { value: 'left_message', label: 'Left message', style: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'no_answer', label: 'No answer', style: 'bg-amber-50 text-amber-800 border-amber-200' },
  { value: 'will_call_back', label: 'Will call back', style: 'bg-purple-50 text-purple-700 border-purple-200' },
  { value: 'wrong_number', label: 'Wrong number', style: 'bg-red-50 text-red-700 border-red-200' },
];
const OUTREACH_BY_VALUE = Object.fromEntries(OUTREACH.map((o) => [o.value, o]));

export default function OutreachControls({ row, onSet }) {
  const current = row.outreach?.status ? OUTREACH_BY_VALUE[row.outreach.status] : null;
  const [busy, setBusy] = useState(false);
  const set = async (value) => {
    setBusy(true);
    try { await onSet(row.id, value); } finally { setBusy(false); }
  };

  if (current) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${current.style}`}>{current.label}</span>
        {row.outreach?.by && <span className="text-[10px] text-gray-400">by {row.outreach.by}</span>}
        <button disabled={busy} onClick={() => set(null)} className="text-[10px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-wider">
          Undo
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {OUTREACH.map((o) => (
        <button
          key={o.value}
          disabled={busy}
          onClick={() => set(o.value)}
          className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-colors disabled:opacity-60"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
