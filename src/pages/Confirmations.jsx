// -----------------------------------------------------------------------------
// Confirmations.jsx
// -----------------------------------------------------------------------------
// Call list of upcoming appointments that aren't confirmed in Dentrix yet.
// Staff confirm in Dentrix as usual; the hub re-reads Dentrix every 15 minutes
// (or on "Refresh now") and the row moves to "Confirmed" on its own. Here staff
// only log what happened when they called (left message, no answer, ...).
// -----------------------------------------------------------------------------
import React, { useState } from 'react';
import {
  CalendarCheck, Phone, RefreshCw, Loader2, MessageSquare, CheckCircle2, XCircle, ChevronDown, ChevronRight,
} from 'lucide-react';
import SegmentedControl from '../components/SegmentedControl';
import { LOCATIONS } from '../utils/payrollConstants';
import { useConfirmations } from '../hooks/useConfirmations';
import OutreachControls from '../components/OutreachControls';

const REFRESH_URL =
  (import.meta.env.VITE_FUNCTIONS_BASE || 'https://us-central1-fds-operations-hub.cloudfunctions.net') +
  '/refreshConfirmations';

const CLINIC_TZ = 'America/Phoenix';
const clinicDate = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function dayLabel(date, today, tomorrow) {
  if (date === today) return 'Today';
  if (date === tomorrow) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// "2026-11-21T07:30:00" (clinic wall time) -> "7:30 AM", independent of the viewer's time zone.
function wallTime(wall) {
  const m = wall && wall.match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function minutesAgo(date) {
  if (!date) return null;
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
}

function telHref(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  return digits ? `tel:${digits}` : null;
}

function AppointmentRow({ row, onSet }) {
  const tel = telHref(row.phone);
  return (
    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="w-20 shrink-0 text-sm font-black text-gray-900">{wallTime(row.wallStartTime)}</div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-gray-900 text-sm">{row.patientName}</span>
          {row.isNewPatient && (
            <span className="text-[9px] font-bold bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full">NEW PATIENT</span>
          )}
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          {row.description && <span>{row.description}</span>}
          {row.provider && <span>· {row.provider}</span>}
          {row.operatory && <span>· {row.operatory}</span>}
          {row.textsSent > 0 && (
            <span className="flex items-center gap-1 text-gray-400">
              · <MessageSquare size={11} /> {row.textsSent} text{row.textsSent === 1 ? '' : 's'} sent
            </span>
          )}
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

function Collapsible({ title, count, icon: Icon, tone, children }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)} className={`flex items-center gap-1.5 text-xs font-bold ${tone}`}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} <Icon size={13} /> {title} ({count})
      </button>
      {open && <div className="mt-2 space-y-1 pl-5">{children}</div>}
    </div>
  );
}

export default function Confirmations({ user, onToast, officeLocation, setOfficeLocation }) {
  const { rows, lastSyncedAt, loading, error, setOutreach } = useConfirmations(user, officeLocation);
  const [selected, setSelected] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const now = new Date();
  const today = clinicDate(now);
  const tomorrow = clinicDate(new Date(now.getTime() + 86400e3));

  // Upcoming days only, with counts of what's still unconfirmed.
  const days = (() => {
    const byDate = new Map();
    for (const r of rows) {
      if (r.date < today) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, open: [], confirmed: [], gone: [] });
      const bucket = byDate.get(r.date);
      if (r.gone) bucket.gone.push(r);
      else if (r.confirmed) bucket.confirmed.push(r);
      else bucket.open.push(r);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  })();

  const activeDate = (selected && days.some((d) => d.date === selected) ? selected : null)
    || days.find((d) => d.open.length)?.date
    || days[0]?.date
    || null;
  const day = days.find((d) => d.date === activeDate);

  const handleOutreach = async (rowId, status) => {
    try {
      await setOutreach(rowId, status);
    } catch {
      onToast?.('Could not save that — try again.', 'error');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${REFRESH_URL}?office=${encodeURIComponent(officeLocation)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Refresh failed (${res.status}).`);
      onToast?.(data.throttled ? 'Already up to date.' : 'Refreshed from Dentrix.', 'success');
    } catch (err) {
      onToast?.(err.message || 'Refresh failed.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedControl className="w-fit" options={LOCATIONS} value={officeLocation} onChange={setOfficeLocation} />
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {lastSyncedAt ? `Updated from Dentrix ${minutesAgo(lastSyncedAt)}` : 'Waiting for first sync from Dentrix'}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-lg text-xs transition-colors disabled:opacity-60"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh now
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Appointments not yet confirmed in Dentrix. Confirm them in Dentrix as usual — they move to "Confirmed" here
        automatically. Use the buttons to note what happened when you called.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !days.length ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          <CalendarCheck className="mx-auto mb-2" size={28} />
          Nothing to confirm right now.
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
            {days.map((d) => (
              <button
                key={d.date}
                onClick={() => setSelected(d.date)}
                className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                  d.date === activeDate ? 'bg-white border-primary-300 shadow-sm' : 'bg-gray-50 border-gray-200 hover:bg-white'
                }`}
              >
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{dayLabel(d.date, today, tomorrow)}</div>
                <div className={`text-lg font-black ${d.open.length ? 'text-amber-700' : 'text-primary-700'}`}>
                  {d.open.length}
                  <span className="text-[10px] font-bold text-gray-400 ml-1">to confirm</span>
                </div>
              </button>
            ))}
          </div>

          {day && (
            <div>
              {day.open.length ? (
                <div className="space-y-2">
                  {day.open.map((r) => <AppointmentRow key={r.id} row={r} onSet={handleOutreach} />)}
                </div>
              ) : (
                <p className="text-sm text-primary-700 font-bold flex items-center gap-1.5">
                  <CheckCircle2 size={16} /> Everyone on {dayLabel(day.date, today, tomorrow)} is confirmed.
                </p>
              )}
              <Collapsible title="Confirmed since listed" count={day.confirmed.length} icon={CheckCircle2} tone="text-primary-700">
                {day.confirmed.map((r) => (
                  <div key={r.id} className="text-xs text-gray-500">
                    {wallTime(r.wallStartTime)} · {r.patientName}
                  </div>
                ))}
              </Collapsible>
              <Collapsible title="Cancelled or moved" count={day.gone.length} icon={XCircle} tone="text-gray-500">
                {day.gone.map((r) => (
                  <div key={r.id} className="text-xs text-gray-400 line-through">
                    {wallTime(r.wallStartTime)} · {r.patientName}
                  </div>
                ))}
              </Collapsible>
            </div>
          )}
        </>
      )}
    </div>
  );
}
