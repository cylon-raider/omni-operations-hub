import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import QueueHeader from '../components/QueueHeader';
import CallCard from '../components/CallCard';
import QuickEntryForm from '../components/QuickEntryForm';
import QueueSection from '../components/QueueSection';
import OutboundLeaderboardCard from '../components/OutboundLeaderboardCard';

export default function LiveDispatch({ user, activeCalls, resolvedCalls, addCall, updateCall, resolveCall, deleteCall, onToast }) {
  const [filterQueue, setFilterQueue] = useState('all');

  const filteredActive = filterQueue === 'all'
    ? activeCalls
    : activeCalls.filter((c) => {
        const assigned = (c.assignment || '').toLowerCase();
        return assigned.includes(filterQueue);
      });

  const inboundCalls = filteredActive.filter((c) => {
    const n = (c.fromName || c.name || '').toLowerCase();
    return !n.includes('family dental');
  });

  const outboundCalls = filteredActive.filter((c) => {
    const n = (c.fromName || c.name || '').toLowerCase();
    return n.includes('family dental');
  });

  const allCalls = [...(activeCalls || []), ...(resolvedCalls || [])];

  const handleUpdate = (id, updates) => {
    updateCall(id, updates)
      .then(() => onToast('Call updated', 'success'))
      .catch(() => onToast('Failed to update call', 'error'));
  };

  const handleResolve = (id) => {
    resolveCall(id)
      .then(() => onToast('Call marked as resolved', 'success'))
      .catch(() => onToast('Failed to resolve call', 'error'));
  };

  const handleDelete = (id) => {
    deleteCall(id)
      .then(() => onToast('Call deleted', 'success'))
      .catch(() => onToast('Failed to delete call', 'error'));
  };

  return (
    <>
      {/* Queues */}
      <QueueHeader activeCalls={inboundCalls} />

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Filter:</span>
        {['all', 'front desk', 'pod 1', 'pod 2', 'pod 3', 'billing', 'clinical', 'treatment', 'hygiene'].map((f) => (
          <button
            key={f}
            onClick={() => setFilterQueue(f)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${
              filterQueue === f
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f === 'all' ? 'All Queues' : f}
          </button>
        ))}
      </div>

      {/* Outbound Leaderboard Card */}
      <OutboundLeaderboardCard calls={allCalls} />

      {/* Quick Callback Entry */}
      <QuickEntryForm
        onAddCall={addCall}
        onSuccess={(msg) => onToast(msg, 'success')}
        onError={(msg) => onToast(msg, 'error')}
      />

      {/* Queues Section */}
      <div className="space-y-6">
        <QueueSection
          title="Active Inbound"
          calls={inboundCalls}
          icon={PhoneIncoming}
          onUpdate={handleUpdate}
          onResolve={handleResolve}
          onDelete={handleDelete}
          user={user}
        />
        
        <QueueSection
          title="Active Outbound"
          calls={outboundCalls}
          icon={PhoneOutgoing}
          onUpdate={handleUpdate}
          onResolve={handleResolve}
          onDelete={handleDelete}
          user={user}
        />
        
        <QueueSection
          title="Resolved Today"
          calls={resolvedCalls}
          icon={CheckCircle2}
          defaultExpanded={false}
          emptyMessage="No calls resolved today yet."
          onUpdate={handleUpdate}
          onResolve={handleResolve}
          onDelete={handleDelete}
          user={user}
        />
      </div>

    </>
  );
}
