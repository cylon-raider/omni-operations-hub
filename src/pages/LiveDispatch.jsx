// -----------------------------------------------------------------------------
// LiveDispatch.jsx (The Main Dashboard)
// -----------------------------------------------------------------------------
// This is the core page of the application. It brings together all the smaller
// components (QueueHeader, CallCard, QuickEntryForm) and manages the logic
// for filtering which calls should be shown on the screen.
// -----------------------------------------------------------------------------
import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import QueueHeader from '../components/QueueHeader';
import CallCard from '../components/CallCard';
import QuickEntryForm from '../components/QuickEntryForm';
import QueueSection from '../components/QueueSection';
import OutboundLeaderboardCard from '../components/OutboundLeaderboardCard';

export default function LiveDispatch({ user, calls, activeCalls, resolvedCalls, addCall, updateCall, resolveCall, deleteCall, onToast, officeLocation, setOfficeLocation }) {
  // --------------------------------------------------------------------------
  // UI State: Queue Filtering
  // --------------------------------------------------------------------------
  // Keeps track of which queue button the user clicked (e.g., 'front desk').
  // By default, it is 'all', which means show everything.
  const [filterQueue, setFilterQueue] = useState('all');

  // We take the master list of activeCalls and filter it down based on the button clicked.
  const filteredActive = filterQueue === 'all'
    ? activeCalls
    : activeCalls.filter((c) => {
        const assigned = (c.assignment || '').toLowerCase();
        return assigned.includes(filterQueue);
      });

  // --------------------------------------------------------------------------
  // Outbound Call Detection Logic
  // --------------------------------------------------------------------------
  // This is a complex helper function. Because data comes in from different sources
  // (like Zapier vs manual entry), we have to use several rules to figure out
  // if a call is "Outbound" (staff calling patients) vs "Inbound" (patients calling us).
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

  // --------------------------------------------------------------------------
  // Split the Calls
  // --------------------------------------------------------------------------
  // Now that we have a filtered list of calls, we split them into Inbound and Outbound
  // so we can render them in different sections on the screen.
  const inboundCalls = filteredActive.filter((c) => !isCallOutbound(c));
  const outboundCalls = filteredActive.filter((c) => isCallOutbound(c));

  // --------------------------------------------------------------------------
  // Action Handlers
  // --------------------------------------------------------------------------
  // These functions wrap our database functions (from useCalls.js) with "Toasts"
  // so that when a user clicks a button, a little popup says "Success!" or "Error!"

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

  // --------------------------------------------------------------------------
  // The User Interface (JSX)
  // --------------------------------------------------------------------------
  return (
    <>
      {/* 
        1. Top Visual Queue (QueueHeader)
        This is the row of colored boxes (Front Desk, Pod 1, Pod 2, etc.) at the top.
        When you click one, it expands into "Focus Mode".
      */}
      <QueueHeader 
        activeCalls={inboundCalls} 
        officeLocation={officeLocation}
        filterQueue={filterQueue}
        setFilterQueue={setFilterQueue}
        onUpdate={handleUpdate}
        onResolve={handleResolve}
        onDelete={handleDelete}
      />

      {/* 
        2. Filter Bar & Location Toggle
        This row contains the small gray filter buttons and the Glendale/Litchfield toggle.
      */}
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

      {/* 
        3. Outbound Leaderboard
        This component calculates who made the most outbound calls today/week/month.
      */}
      <OutboundLeaderboardCard calls={calls} officeLocation={officeLocation} />

      {/* 
        4. Manual Callback Form
        The small form where staff can manually type in a patient's name and number.
      */}
      <QuickEntryForm
        officeLocation={officeLocation}
        onAddCall={addCall}
        onSuccess={(msg) => onToast(msg, 'success')}
        onError={(msg) => onToast(msg, 'error')}
      />

      {/* 
        5. Master Call Lists (QueueSections)
        These are the big expandable sections ("ACTIVE INBOUND", "ACTIVE OUTBOUND", "RESOLVED CALLS").
        We hide the Active lists if the user clicked one of the focus queues at the top.
      */}
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
            officeLocation={officeLocation}
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
            officeLocation={officeLocation}
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
          officeLocation={officeLocation}
        />
      </div>

    </>
  );
}
