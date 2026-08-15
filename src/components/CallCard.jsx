// -----------------------------------------------------------------------------
// CallCard.jsx
// -----------------------------------------------------------------------------
// This component represents a single "Ticket" or "Call" on the dashboard.
// It handles displaying the call data, as well as providing the UI for editing,
// claiming (In Progress), resolving, or deleting the call.
// -----------------------------------------------------------------------------
import React, { useState } from 'react';
import { Phone, Clock, Edit3, CheckCircle, Trash2, X, ChevronUp, AlertTriangle } from 'lucide-react';
import { OWNER_EMAILS } from '../utils/payrollConstants';

const PRIORITY_STYLES = {
  URGENT: 'bg-red-100 text-red-700',
  ESCALATED: 'bg-red-100 text-red-700',
  TODAY: 'bg-amber-100 text-amber-800',
  NORMAL: 'bg-primary-100 text-primary-800',
};

const STATUS_STYLES = {
  Waiting: 'bg-amber-50 text-amber-700 border-amber-200',
  'In Progress': 'bg-blue-50 text-blue-700 border-blue-200',
  Processing: 'bg-purple-50 text-purple-700 border-purple-200',
  Resolved: 'bg-primary-50 text-primary-700 border-primary-200',
  'Transcription Error': 'bg-red-50 text-red-700 border-red-200',
};

const QUEUES = [
  'Front Desk Supervisor',
  'Pod 1',
  'Pod 2',
  'Pod 3',
  'Billing',
  'Clinical / Labs',
  'Hygiene',
  'Treatment Coordinator',
];

const PRIORITIES = ['NORMAL', 'TODAY', 'URGENT', 'ESCALATED'];

// A helper function to turn timestamps into human-readable text (e.g. "5m ago")
function timeAgo(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp.toDate().getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function CallCard({ call, onUpdate, onResolve, onDelete, user, officeLocation = 'glendale' }) {
  // --------------------------------------------------------------------------
  // Component State
  // --------------------------------------------------------------------------
  // We use local state to track if the user has clicked "Edit" or "Resolve",
  // so we can show them the appropriate forms/confirmation menus.
  const [editing, setEditing] = useState(false);
  const [editAssign, setEditAssign] = useState(call.assignment || 'Front Desk Supervisor');
  const [editPriority, setEditPriority] = useState(call.priority || 'NORMAL');
  const [confirming, setConfirming] = useState(null); // Can be 'resolve', 'delete', or null

  // --------------------------------------------------------------------------
  // Admin Check
  // --------------------------------------------------------------------------
  // Hardcoded admins who are allowed to see the "Delete" button.
  const isAdmin = OWNER_EMAILS.includes(user?.email);

  // Helper variables to ensure we always have something to display
  // even if the database is missing some fields.
  const displayName = call.fromName || call.name || 'Unknown Caller';
  const displayPhone = call.fromNumber || call.phone || 'No phone provided';
  const displayPriority = call.priority || 'NORMAL';
  const displayAssignment = call.assignment || 'Unassigned';
  const displayStatus = call.status || 'Waiting';

  // --------------------------------------------------------------------------
  // Action Handlers
  // --------------------------------------------------------------------------
  const handleSaveEdit = async () => {
    // We call the `onUpdate` function that was passed down from LiveDispatch
    await onUpdate(call.id, { assignment: editAssign, priority: editPriority });
    setEditing(false); // Close the edit form
  };

  const handleStatusAdvance = () => {
    if (displayStatus === 'Waiting') {
      onUpdate(call.id, { status: 'In Progress' });
    }
  };

  return (
    <div className="p-4 bg-gray-50 hover:bg-gray-100/80 transition-colors rounded-xl border border-gray-200/80 group">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        {/* Main Info */}
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-gray-900 text-sm">{displayName}</span>
            {call.reason && (
              <span className="text-[10px] font-bold bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">
                {call.reason}
              </span>
            )}
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLES[displayStatus] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
              {displayStatus}
            </span>
          </div>

          <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1"><Phone size={12} /> {displayPhone}</span>
            <span>•</span>
            <span className="font-medium text-primary-700">{displayAssignment}</span>
            {call.createdAt && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1 text-gray-400">
                  <Clock size={11} /> {timeAgo(call.createdAt)}
                </span>
              </>
            )}
          </div>

          {call.summary && (
            <p className="text-xs text-gray-600 mt-2 bg-white p-2 rounded-lg border border-gray-200/60 italic">
              "{call.summary}"
            </p>
          )}

          {call.transcript && !call.summary && (
            <p className="text-xs text-gray-500 mt-2 bg-white p-2 rounded-lg border border-gray-200/60 line-clamp-2">
              {call.transcript}
            </p>
          )}
        </div>

        {/* Priority Badge + Actions */}
        <div className="flex items-center gap-2 self-end sm:self-start shrink-0">
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider ${PRIORITY_STYLES[displayPriority] || PRIORITY_STYLES.NORMAL}`}>
            {displayPriority}
          </span>
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <div className="mt-3 pt-3 border-t border-gray-200 flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Assign To</label>
            <select
              value={editAssign}
              onChange={(e) => setEditAssign(e.target.value)}
              className="w-full p-2 border border-gray-200 rounded-lg text-xs bg-white outline-none focus:border-primary-500"
            >
              {QUEUES.filter(q => officeLocation === 'litchfield' ? !q.toLowerCase().startsWith('pod') : true).map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Priority</label>
            <select
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value)}
              className="w-full p-2 border border-gray-200 rounded-lg text-xs bg-white outline-none focus:border-primary-500 font-bold"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveEdit}
              className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-lg text-xs transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Bar */}
      {confirming && (
        <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
          <p className="text-xs font-medium text-gray-600">
            {confirming === 'delete' ? 'Delete this call permanently?' : 'Mark this call as resolved?'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                confirming === 'delete' ? onDelete(call.id) : onResolve(call.id);
                setConfirming(null);
              }}
              className={`px-3 py-1.5 font-bold rounded-lg text-xs transition-colors ${
                confirming === 'delete'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-primary-600 hover:bg-primary-700 text-white'
              }`}
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirming(null)}
              className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons - visible on hover or always on mobile */}
      {!editing && !confirming && (
        <div className="mt-3 pt-3 border-t border-gray-200/60 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-100 sm:group-hover:opacity-100">
          {displayStatus === 'Waiting' && (
            <button
              onClick={handleStatusAdvance}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-colors"
            >
              <ChevronUp size={12} /> Start
            </button>
          )}
          <button
            onClick={() => setConfirming('resolve')}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-primary-50 hover:bg-primary-100 text-primary-700 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-colors"
          >
            <CheckCircle size={12} /> Complete
          </button>
          <button
            onClick={() => {
              setEditAssign(call.assignment || 'Front Desk Supervisor');
              setEditPriority(call.priority || 'NORMAL');
              setEditing(true);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-colors"
          >
            <Edit3 size={12} /> Edit
          </button>
          {displayPriority !== 'ESCALATED' && (
            <button
              onClick={() => onUpdate(call.id, { priority: 'ESCALATED', status: 'Waiting' })}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-colors"
            >
              <AlertTriangle size={12} /> Escalate
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setConfirming('delete')}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 hover:bg-red-50 text-gray-400 hover:text-red-500 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-colors ml-auto"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
