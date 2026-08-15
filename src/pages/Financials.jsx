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
import SegmentedControl from '../components/SegmentedControl';

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
      <SegmentedControl
        className="w-fit no-print"
        options={visibleTabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && isPayrollAdmin && <FinancialsOverview />}
      {tab === 'schedule' && <ScheduleGrid isPayrollAdmin={isPayrollAdmin} onToast={onToast} />}
      {tab === 'team' && <TeamDirectory user={user} isPayrollAdmin={isPayrollAdmin} onToast={onToast} />}
    </div>
  );
}
