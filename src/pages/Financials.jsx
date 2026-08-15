// -----------------------------------------------------------------------------
// Financials.jsx
// -----------------------------------------------------------------------------
// Entry point for the "Financials & Payroll" sidebar link. Hosts three
// internal tabs (Overview, Schedule, Team) instead of separate routes, so the
// sidebar keeps its single link. Overview is admin-only (payroll rates/EBITDA).
// -----------------------------------------------------------------------------
import React, { useState, useEffect } from 'react';
import { Calculator, CalendarDays, Users } from 'lucide-react';
import { usePayrollRole } from '../hooks/usePayrollRole';
import FinancialsOverview from '../components/financials/FinancialsOverview';
import ScheduleGrid from '../components/financials/ScheduleGrid';
import TeamDirectory from '../components/financials/TeamDirectory';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Calculator, adminOnly: true },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'team', label: 'Team', icon: Users },
];

export default function Financials({ user, onToast }) {
  const { isPayrollAdmin, loading } = usePayrollRole(user);
  const [tab, setTab] = useState(null);

  useEffect(() => {
    if (!loading && tab === null) {
      setTab(isPayrollAdmin ? 'overview' : 'schedule');
    }
  }, [loading, isPayrollAdmin, tab]);

  if (loading || tab === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isPayrollAdmin);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200 w-fit no-print">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && isPayrollAdmin && <FinancialsOverview />}
      {tab === 'schedule' && <ScheduleGrid isPayrollAdmin={isPayrollAdmin} />}
      {tab === 'team' && <TeamDirectory user={user} isPayrollAdmin={isPayrollAdmin} onToast={onToast} />}
    </div>
  );
}
