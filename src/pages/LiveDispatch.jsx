import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import QueueHeader from '../components/QueueHeader';
import CallCard from '../components/CallCard';
import QuickEntryForm from '../components/QuickEntryForm';
import QueueSection from '../components/QueueSection';
import OutboundLeaderboardCard from '../components/OutboundLeaderboardCard';

export default function LiveDispatch({ user, calls, activeCalls, resolvedCalls, addCall, updateCall, resolveCall, deleteCall, onToast, officeLocation, setOfficeLocation }) {
  const [filterQueue, setFilterQueue] = useState('all');

  const filteredActive = filterQueue === 'all'
    ? activeCalls
    : activeCalls.filter((c) => {
        const assigned = (c.assignment || '').toLowerCase();
        return assigned.includes(filterQueue);
      });

  const isCallOutbound = (c) => {
    let isOutbound = false;

    if (c.direction === 'outbound') {
      isOutbound = true;
    } else if (c.direction === 'inbound') {
      return false;
    }

    if (!isOutbound && c.rawEvent && typeof c.rawEvent === 'string') {
      const match = c.rawEvent.match(/"direction"\s*:\s*"([^"]+)"/i);
      if (match && match[1]) {
        const dir = match[1].toLowerCase();
        if (dir === 'outbound') isOutbound = true;
        else if (dir === 'inbound') return false;
      }
    }

    if (!isOutbound) {
      if (c.isOutbound === true) {
        isOutbound = true;
      } else {
        const n = (c.fromName || c.name || '').toLowerCase();
        if (n.includes('family dental') && !n.includes('provider')) {
          isOutbound = true;
        }
      }
    }

    if (isOutbound) {
      const NAME_ALIASES = {
        'devon': 'DEVIN',
        'alacia': 'ALICIA',
        'iliana': 'EYLIANNA',
        'aliana': 'EYLIANNA',
        'eliana': 'EYLIANNA',
        'alicia': 'ALESSIA',
        'lisa': 'ALESSIA',
        'mara': 'MARAH',
        'mary ann': 'MARIANNE',
        'b': 'IGNORE',
        'bea': 'IGNORE',
        'tim': 'IGNORE'
      };

      const rawName = (c.employeeName || '').toLowerCase().trim();
      let empName = rawName;
      
      if (NAME_ALIASES[rawName]) {
        if (NAME_ALIASES[rawName] === 'IGNORE') return false;
        empName = NAME_ALIASES[rawName].toLowerCase();
      }

      const glendaleStaff = ['jen', 'lisa', 'jamie', 'addison', 'mariana', 'brandy', 'devin', 'liz', 'alessia', 'marianne', 'aubrey', 'marah', 'pam', 'eylianna', 'dan'];
      const litchfieldStaff = ['jen', 'melia', 'cynthia', 'lupita', 'rachel', 'aron'];
      const validNames = officeLocation === 'litchfield' ? litchfieldStaff : glendaleStaff;
      
      return true;
    }
    return false;
  };

  const inboundCalls = filteredActive.filter((c) => !isCallOutbound(c));
  const outboundCalls = filteredActive.filter((c) => isCallOutbound(c));

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
      <QueueHeader 
        activeCalls={inboundCalls} 
        officeLocation={officeLocation}
        filterQueue={filterQueue}
        setFilterQueue={setFilterQueue}
        onUpdate={handleUpdate}
        onResolve={handleResolve}
        onDelete={handleDelete}
      />

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Filter:</span>
          {['all', 'front desk', 'pod 1', 'pod 2', 'pod 3', 'billing', 'clinical', 'treatment', 'hygiene']
            .filter(f => officeLocation === 'litchfield' ? !f.startsWith('pod') : true)
            .map((f) => (
            <button
            key={f}
            onClick={() => setFilterQueue(f)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${
              filterQueue === f
                ? 'bg-primary-100 text-primary-700 border border-primary-200'
                : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f === 'all' ? 'All Queues' : f}
          </button>
        ))}
        </div>
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200">
          <button
            onClick={() => setOfficeLocation('glendale')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
              officeLocation === 'glendale'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            Glendale
          </button>
          <button
            onClick={() => setOfficeLocation('litchfield')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
              officeLocation === 'litchfield'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            Litchfield
          </button>
        </div>
      </div>

      {/* Outbound Leaderboard Card */}
      <OutboundLeaderboardCard calls={calls} officeLocation={officeLocation} />

      {/* Quick Callback Entry */}
      <QuickEntryForm
        onAddCall={addCall}
        onSuccess={(msg) => onToast(msg, 'success')}
        onError={(msg) => onToast(msg, 'error')}
      />

      {/* Queues Section */}
      <div className="space-y-6">
      {/* Active Inbound & Outbound Sections - Hidden if filtering */}
      {filterQueue === 'all' && (
        <>
          <QueueSection
            title="ACTIVE INBOUND"
            calls={inboundCalls}
            icon={PhoneIncoming}
            onUpdate={handleUpdate}
            onResolve={handleResolve}
            onDelete={handleDelete}
            defaultExpanded={true}
            user={user}
          />

          <QueueSection
            title="ACTIVE OUTBOUND"
            calls={outboundCalls}
            icon={PhoneOutgoing}
            onUpdate={handleUpdate}
            onResolve={handleResolve}
            onDelete={handleDelete}
            defaultExpanded={false}
            user={user}
          />
        </>
      )}
        
        <QueueSection
          title="RESOLVED CALLS"
          calls={resolvedCalls}
          icon={CheckCircle2}
          defaultExpanded={false}
          emptyMessage="No calls resolved yet."
          onUpdate={handleUpdate}
          onResolve={handleResolve}
          onDelete={handleDelete}
          user={user}
        />
      </div>

    </>
  );
}
