// -----------------------------------------------------------------------------
// Huddle.jsx — Morning Huddle
// -----------------------------------------------------------------------------
// Everyone on today's (or tomorrow's) schedule with what the team should know
// before they arrive. Built from Dentrix at 5:30am and 12:30pm, or on demand.
// The tiles double as filters.
// -----------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import {
  Users, CalendarX, UserPlus, Wallet, ShieldAlert, ClipboardList, FlaskConical, Pill, TrendingUp,
  RefreshCw, Loader2, Sunrise,
} from 'lucide-react';
import SegmentedControl from '../components/SegmentedControl';
import { LOCATIONS } from '../utils/payrollConstants';
import { useHuddle } from '../hooks/useHuddle';

const REFRESH_URL =
  (import.meta.env.VITE_FUNCTIONS_BASE || 'https://us-central1-fds-operations-hub.cloudfunctions.net') + '/refreshHuddle';

const DAYS = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
];

const clinicDate = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const usd = (n, cents = false) =>
  (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 });

function wallTime(wall) {
  const m = wall && wall.match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function minutesAgo(ts) {
  const d = ts?.toDate?.();
  if (!d) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
}

function daysAgo(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400e3);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

// Each filter: tile + the predicate that decides which patients it shows.
const FILTERS = [
  { id: 'all', label: 'Patients', icon: Users, tone: 'text-gray-900', count: (t) => t.patients, test: () => true },
  { id: 'unconfirmed', label: 'Unconfirmed', icon: CalendarX, tone: 'text-amber-700', count: (t) => t.unconfirmed, test: (p) => !p.confirmed },
  { id: 'new', label: 'New patients', icon: UserPlus, tone: 'text-sky-700', count: (t) => t.newPatients, test: (p) => p.isNewPatient },
  { id: 'balance', label: 'Balance due', icon: Wallet, tone: 'text-red-700', count: (t) => t.balanceDue, sub: (t) => usd(t.balanceDueAmount), test: (p) => (p.balance?.patient || 0) > 0 },
  { id: 'insurance', label: 'Verify insurance', icon: ShieldAlert, tone: 'text-purple-700', count: (t) => t.insuranceToVerify, test: (p) => p.insurance?.needsVerification },
  { id: 'treatment', label: 'Unscheduled tx', icon: ClipboardList, tone: 'text-primary-700', count: (t) => t.unscheduledTreatment, sub: (t) => usd(t.unscheduledTreatmentAmount), test: (p) => (p.unscheduled?.count || 0) > 0 },
  { id: 'lab', label: 'Lab not back', icon: FlaskConical, tone: 'text-orange-700', count: (t) => t.labCasesNotBack, test: (p) => p.labCase?.notBack },
  { id: 'premed', label: 'Premed', icon: Pill, tone: 'text-rose-700', count: (t) => t.premed, test: (p) => p.premed },
];

function Chip({ className, children }) {
  return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${className}`}>{children}</span>;
}

function PatientRow({ p }) {
  const lines = [];
  if ((p.balance?.patient || 0) > 0) {
    lines.push(
      <span key="bal" className="text-red-700">
        <Wallet size={11} className="inline -mt-0.5" /> Patient owes {usd(p.balance.patient, true)}
        {p.balance.patientOver90 > 0 && <> ({usd(p.balance.patientOver90, true)} over 90 days)</>}
        {p.balance.insurance > 0 && <span className="text-gray-400"> · insurance {usd(p.balance.insurance, true)} pending</span>}
      </span>,
    );
  }
  if (p.insurance?.needsVerification) {
    lines.push(
      <span key="ins" className="text-purple-700">
        <ShieldAlert size={11} className="inline -mt-0.5" />{' '}
        {p.insurance.status !== 'ELIGIBLE' && p.insurance.status !== 'UNKNOWN'
          ? `Insurance status: ${p.insurance.status.replace(/_/g, ' ').toLowerCase()}`
          : `Insurance last verified ${daysAgo(p.insurance.verifiedAt) || 'never'} — re-verify`}
      </span>,
    );
  }
  if ((p.unscheduled?.count || 0) > 0) {
    const names = p.unscheduled.procedures.map((x) => (x.tooth ? `${x.description} (${x.tooth})` : x.description));
    lines.push(
      <span key="tx" className="text-primary-700">
        <ClipboardList size={11} className="inline -mt-0.5" /> Unscheduled treatment {usd(p.unscheduled.totalFee)}
        {p.unscheduled.totalPatientEstimate > 0 && <span className="text-gray-400"> (pt est. {usd(p.unscheduled.totalPatientEstimate)})</span>}
        : <span className="text-gray-500">{names.slice(0, 4).join(', ')}{names.length > 4 ? `, +${names.length - 4} more` : ''}</span>
      </span>,
    );
  }
  if (p.labCase) {
    lines.push(
      <span key="lab" className={p.labCase.notBack ? 'text-orange-700' : 'text-gray-400'}>
        <FlaskConical size={11} className="inline -mt-0.5" /> Lab case{p.labCase.lab ? ` (${p.labCase.lab})` : ''}: {(p.labCase.status || 'unknown').toLowerCase()}
        {p.labCase.dueDate && ` · due ${p.labCase.dueDate}`}
      </span>,
    );
  }

  return (
    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 flex flex-col sm:flex-row gap-2 sm:gap-3">
      <div className="w-20 shrink-0 text-sm font-black text-gray-900">{wallTime(p.wallStartTime)}</div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-gray-900 text-sm">{p.patientName}</span>
          {!p.confirmed && <Chip className="bg-amber-100 text-amber-800">Unconfirmed</Chip>}
          {p.isNewPatient && <Chip className="bg-sky-100 text-sky-700">New patient</Chip>}
          {p.premed && <Chip className="bg-rose-100 text-rose-700">Premed</Chip>}
          {p.asap && <Chip className="bg-gray-200 text-gray-600">ASAP list</Chip>}
        </div>
        <div className="text-xs text-gray-500 flex flex-wrap gap-x-2">
          {p.description && <span>{p.description}</span>}
          {p.provider && <span>· {p.provider}</span>}
          {p.operatory && <span>· {p.operatory}</span>}
        </div>
        {lines.length > 0 && <div className="text-xs space-y-0.5 flex flex-col">{lines}</div>}
      </div>
    </div>
  );
}

function BuildStatus({ building, stalled, error, startedAt, compact = false }) {
  const tone = building ? 'bg-sky-50 border-sky-200 text-sky-800' : 'bg-amber-50 border-amber-200 text-amber-800';
  const text = building
    ? `Building from Dentrix… started ${minutesAgo(startedAt) || 'just now'}. This usually takes 2–5 minutes; the page updates on its own.${compact ? ' Showing the previous build meanwhile.' : ''}`
    : stalled
      ? "The last build didn't finish. Click Refresh now to try again."
      : `The last build failed: ${error}. Click Refresh now to try again.`;
  return (
    <div className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-medium ${tone} ${compact ? '' : 'my-8'}`}>
      {building && <Loader2 size={14} className="animate-spin shrink-0" />}
      {text}
    </div>
  );
}

export default function Huddle({ user, onToast, officeLocation, setOfficeLocation }) {
  const [day, setDay] = useState('today');
  const [filter, setFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  // Ticks every 30s so build status and "x min ago" stay current.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30e3);
    return () => clearInterval(t);
  }, []);

  // Clinic dates are fixed when the page opens (reading the clock during render isn't allowed).
  const [dates] = useState(() => ({ today: clinicDate(new Date()), tomorrow: clinicDate(new Date(Date.now() + 86400e3)) }));
  const date = dates[day];
  const { huddle, loading, error } = useHuddle(user, officeLocation, date);
  const totals = huddle?.totals;
  // A build runs in the background for a few minutes; treat one that started
  // over 10 minutes ago as abandoned (the worker timed out or crashed).
  const buildStartedMs = huddle?.buildStartedAt?.toMillis?.() ?? null;
  const building = !!huddle?.building && (buildStartedMs == null || nowMs - buildStartedMs < 10 * 60e3);
  const buildStalled = !!huddle?.building && !building;
  const active = FILTERS.find((f) => f.id === filter) || FILTERS[0];
  const patients = (huddle?.patients || []).filter(active.test);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${REFRESH_URL}?office=${encodeURIComponent(officeLocation)}&day=${day}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Refresh failed (${res.status}).`);
      onToast?.(
        data.throttled ? 'Built moments ago — already up to date.'
          : data.alreadyBuilding ? 'Already building — this page updates when it finishes.'
            : 'Building from Dentrix — this page updates in a few minutes.',
        'success',
      );
    } catch (err) {
      onToast?.(err.message || 'Refresh failed.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <SegmentedControl className="w-fit" options={LOCATIONS} value={officeLocation} onChange={setOfficeLocation} />
          <SegmentedControl className="w-fit" options={DAYS} value={day} onChange={(v) => { setDay(v); setFilter('all'); }} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {huddle?.generatedAt ? `Built from Dentrix ${minutesAgo(huddle.generatedAt)}` : 'Not built yet'}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing || building}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-lg text-xs transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            {refreshing || building ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {building ? 'Building…' : 'Refresh now'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (building || buildStalled || huddle?.buildError) && !totals ? (
        <BuildStatus building={building} stalled={buildStalled} error={huddle?.buildError} startedAt={huddle?.buildStartedAt} />
      ) : !huddle || !totals ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          <Sunrise className="mx-auto mb-2" size={28} />
          No huddle for {day} yet — it builds at 5:30am and 12:30pm, or click Refresh now.
        </div>
      ) : (
        <>
          {(building || buildStalled || huddle.buildError) && (
            <BuildStatus building={building} stalled={buildStalled} error={huddle.buildError} startedAt={huddle.buildStartedAt} compact />
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id === filter ? 'all' : f.id)}
                className={`p-2.5 rounded-xl border text-left transition-colors ${
                  f.id === filter ? 'bg-white border-primary-300 shadow-sm' : 'bg-gray-50 border-gray-200 hover:bg-white'
                }`}
              >
                <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  <f.icon size={11} /> {f.label}
                </div>
                <div className={`text-xl font-black ${f.count(totals) ? f.tone : 'text-gray-300'}`}>{f.count(totals)}</div>
                {f.sub && f.count(totals) > 0 && <div className="text-[10px] font-bold text-gray-500">{f.sub(totals)}</div>}
              </button>
            ))}
          </div>

          {totals.scheduledProduction > 0 && (
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <TrendingUp size={13} /> Scheduled production: <span className="font-bold text-gray-700">{usd(totals.scheduledProduction)}</span>
            </p>
          )}

          <div className="space-y-2">
            {patients.length ? (
              patients.map((p) => <PatientRow key={p.patientId} p={p} />)
            ) : (
              <p className="text-sm text-gray-400 py-6 text-center">No patients match “{active.label}”.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
