// -----------------------------------------------------------------------------
// TreatmentFollowUp.jsx — Unscheduled treatment call list
// -----------------------------------------------------------------------------
// Patients whose planned treatment in Dentrix has no appointment yet, biggest
// first. Built every evening (functions/treatment.js); a row disappears on its
// own once everything on it is booked in Dentrix.
// -----------------------------------------------------------------------------
import React, { useState } from 'react';
import { ClipboardList, Phone, Search } from 'lucide-react';
import SegmentedControl from '../components/SegmentedControl';
import OutreachControls from '../components/OutreachControls';
import { LOCATIONS } from '../utils/payrollConstants';
import { useTreatmentFollowUp } from '../hooks/useTreatmentFollowUp';

const SORTS = [
  { value: 'value', label: 'Biggest first' },
  { value: 'oldest', label: 'Oldest plan' },
  { value: 'recent', label: 'Seen recently' },
];

const usd = (n) => (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function shortDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function telHref(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  return digits ? `tel:${digits}` : null;
}

function Row({ row, onSet }) {
  const tel = telHref(row.phone);
  const procs = (row.procedures || []).map((p) => (p.tooth ? `${p.description} (${p.tooth})` : p.description));
  return (
    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 flex flex-col sm:flex-row gap-3">
      <div className="sm:w-28 shrink-0">
        <div className="text-lg font-black text-primary-700">{usd(row.totalFee)}</div>
        {row.totalPatientEstimate > 0 && (
          <div className="text-[10px] font-bold text-gray-400">pt est. {usd(row.totalPatientEstimate)}</div>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="font-bold text-gray-900 text-sm">{row.patientName}</div>
        <div className="text-xs text-gray-600">
          {procs.slice(0, 5).join(', ')}
          {procs.length > 5 && <span className="text-gray-400">, +{procs.length - 5} more</span>}
          {row.count > (row.procedures || []).length && <span className="text-gray-400"> ({row.count} procedures)</span>}
        </div>
        <div className="text-[11px] text-gray-400 flex flex-wrap gap-x-3">
          {row.oldestPlannedAt && <span>Planned {shortDate(row.oldestPlannedAt)}</span>}
          {row.lastSeen && <span>Last seen {shortDate(row.lastSeen)}</span>}
        </div>
      </div>
      <div className="flex flex-col sm:items-end gap-2 shrink-0">
        {tel ? (
          <a href={tel} className="flex items-center gap-1 text-xs font-bold text-primary-700 hover:text-primary-800">
            <Phone size={12} /> {row.phone}
          </a>
        ) : (
          <span className="text-xs text-gray-400">No phone on file</span>
        )}
        <OutreachControls row={row} onSet={onSet} />
      </div>
    </div>
  );
}

export default function TreatmentFollowUp({ user, onToast, officeLocation, setOfficeLocation }) {
  const { rows, loading, error, setOutreach } = useTreatmentFollowUp(user, officeLocation);
  const [sort, setSort] = useState('value');
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();
  const visible = rows
    .filter((r) => !q || r.patientName?.toLowerCase().includes(q) || (r.procedures || []).some((p) => p.description?.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort === 'oldest') return (a.oldestPlannedAt || '9999').localeCompare(b.oldestPlannedAt || '9999');
      if (sort === 'recent') return (b.lastSeen || '').localeCompare(a.lastSeen || '');
      return (b.totalFee || 0) - (a.totalFee || 0);
    });
  const total = rows.reduce((s, r) => s + (r.totalFee || 0), 0);

  const handleOutreach = async (rowId, status) => {
    try {
      await setOutreach(rowId, status);
    } catch {
      onToast?.('Could not save that — try again.', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedControl className="w-fit" options={LOCATIONS} value={officeLocation} onChange={setOfficeLocation} />
        {!loading && rows.length > 0 && (
          <div className="text-sm text-gray-600">
            <span className="font-black text-primary-700">{usd(total)}</span> unscheduled across{' '}
            <span className="font-bold">{rows.length}</span> patients
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Patients with planned treatment in Dentrix that isn't booked yet. Book it in Dentrix as usual — the patient
        drops off this list automatically (it's re-checked every evening). The list grows as the hub works back
        through past visits.
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient or procedure (e.g. crown)"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-primary-500"
          />
        </div>
        <SegmentedControl size="sm" className="w-fit" options={SORTS} value={sort} onChange={setSort} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !rows.length ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          <ClipboardList className="mx-auto mb-2" size={28} />
          Nothing here yet — the list is built each evening from the day's patients and past visits.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => <Row key={r.id} row={r} onSet={handleOutreach} />)}
          {!visible.length && <p className="text-sm text-gray-400 py-6 text-center">No matches for “{search}”.</p>}
        </div>
      )}
    </div>
  );
}
