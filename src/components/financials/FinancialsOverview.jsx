// -----------------------------------------------------------------------------
// FinancialsOverview.jsx
// -----------------------------------------------------------------------------
// Admin-only tab (gated by the parent Financials page). Shows real-time labor
// cost tracking based on scheduled hours, production targets needed to hit
// overhead goals, and EBITDA vs daily/weekly/monthly collections.
// -----------------------------------------------------------------------------
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { Calculator, Clock, ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';
import { db } from '../../config/firebase';
import SegmentedControl from '../SegmentedControl';
import { getWeekDays, getMonthDays, formatWeekRange, formatDate } from '../../utils/payrollDate';
import { calculateStaffCost, calculateProductionNeeded, formatCurrency, calculateHoursFromTimes } from '../../utils/payrollCalculations';
import { TARGETS } from '../../utils/payrollConstants';

export default function FinancialsOverview() {
  const [timeframe, setTimeframe] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const [staff, setStaff] = useState([]);
  const [ratesById, setRatesById] = useState({});
  const [schedule, setSchedule] = useState({});
  const [dailyLogs, setDailyLogs] = useState({});
  const [localCollections, setLocalCollections] = useState('');

  useEffect(() => {
    const unsubStaff = onSnapshot(collection(db, 'payroll_staff'), (s) =>
      setStaff(s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => a.name.localeCompare(b.name)))
    );
    // Rates are split out of payroll_staff (see firestore.rules) — this page
    // is admin-gated by the parent, so a full-collection read is allowed.
    const unsubRates = onSnapshot(collection(db, 'payroll_staffRates'), (s) => {
      const map = {};
      s.docs.forEach((d) => (map[d.id] = d.data().rate));
      setRatesById(map);
    });
    const unsubSched = onSnapshot(collection(db, 'payroll_schedule'), (s) => {
      const data = {};
      s.docs.forEach((d) => (data[d.id] = d.data()));
      setSchedule(data);
    });
    const unsubLogs = onSnapshot(collection(db, 'payroll_dailyLogs'), (s) => {
      const data = {};
      s.docs.forEach((d) => (data[d.id] = d.data()));
      setDailyLogs(data);
    });
    return () => { unsubStaff(); unsubRates(); unsubSched(); unsubLogs(); };
  }, []);

  useEffect(() => {
    if (timeframe === 'daily') {
      setLocalCollections((dailyLogs[selectedDate]?.collections || '').toString());
    } else {
      setLocalCollections('');
    }
  }, [selectedDate, dailyLogs, timeframe]);

  const handleCollectionsChange = async (val) => {
    setLocalCollections(val);
    if (timeframe === 'daily') {
      const num = parseFloat(val);
      await setDoc(doc(db, 'payroll_dailyLogs', selectedDate), { collections: isNaN(num) ? 0 : num }, { merge: true });
    }
  };

  const parseHours = (val) => {
    if (!val) return 0;
    if (val.includes('-')) {
      const [s, e] = val.split('-');
      return calculateHoursFromTimes(s, e);
    }
    return parseFloat(val) || 0;
  };

  const financials = useMemo(() => {
    let dates = [];
    if (timeframe === 'daily') dates = [selectedDate];
    else if (timeframe === 'weekly') dates = getWeekDays(selectedDate);
    else if (timeframe === 'monthly') dates = getMonthDays(selectedDate);

    let staffCost = 0;
    let drCost = 0;
    const deptCosts = {};
    const staffHours = {};

    staff.forEach((member) => {
      let totalH = 0;
      dates.forEach((d) => {
        totalH += parseHours(schedule[d]?.[member.id]);
      });
      staffHours[member.id] = totalH;

      const cost = calculateStaffCost(totalH, ratesById[member.id] || 0);
      if (member.department === 'Dr' || member.role.toLowerCase().includes('doctor')) {
        drCost += cost;
      } else {
        staffCost += cost;
      }

      const dept = member.department || 'Other';
      deptCosts[dept] = (deptCosts[dept] || 0) + cost;
    });

    const staffProdNeeded = calculateProductionNeeded(staffCost, TARGETS.STAFF_OVERHEAD);
    const drProdNeeded = calculateProductionNeeded(drCost, TARGETS.DOCTOR_OVERHEAD);

    return { staffCost, drCost, staffProdNeeded, drProdNeeded, deptCosts, staffHours };
  }, [staff, ratesById, schedule, selectedDate, timeframe]);

  const collectionsVal = parseFloat(localCollections) || 0;
  const ebitda = collectionsVal - (financials.staffCost + financials.drCost);
  const ebitdaPercent = collectionsVal > 0 ? (ebitda / collectionsVal) * 100 : 0;

  const shiftDate = (dir) => {
    const d = new Date(selectedDate);
    if (timeframe === 'monthly') d.setMonth(d.getMonth() + dir);
    else if (timeframe === 'weekly') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const getDateLabel = () => {
    if (timeframe === 'daily') return formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' });
    if (timeframe === 'weekly') return formatWeekRange(selectedDate);
    if (timeframe === 'monthly') return formatDate(selectedDate, { month: 'long', year: 'numeric' });
    return selectedDate;
  };

  return (
    <div className="space-y-6">
      {/* Timeframe + Date Navigator */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <SegmentedControl
          options={[
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ]}
          value={timeframe}
          onChange={setTimeframe}
        />
        <div className="flex items-center gap-3">
          <button onClick={() => shiftDate(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <span className="font-black text-gray-800 text-sm min-w-[180px] text-center">{getDateLabel()}</span>
          <button onClick={() => shiftDate(1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Staff Cost</div>
              <div className="text-3xl font-black text-gray-900">{formatCurrency(financials.staffCost)}</div>
              <div className="text-[10px] text-primary-700 mt-2 font-bold bg-primary-50 border border-primary-100 w-fit px-2 py-0.5 rounded-full uppercase tracking-wider">Target: 25%</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Production Needed</div>
              <div className="text-lg font-black text-gray-700">{formatCurrency(financials.staffProdNeeded)}</div>
            </div>
          </div>
          <div className="w-full bg-gray-100 h-2 rounded-full mt-5 overflow-hidden">
            <div className="bg-primary-500 h-full rounded-full" style={{ width: '25%' }} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Doctor Cost</div>
              <div className="text-3xl font-black text-gray-900">{formatCurrency(financials.drCost)}</div>
              <div className="text-[10px] text-blue-700 mt-2 font-bold bg-blue-50 border border-blue-100 w-fit px-2 py-0.5 rounded-full uppercase tracking-wider">Target: 28%</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Production Needed</div>
              <div className="text-lg font-black text-gray-700">{formatCurrency(financials.drProdNeeded)}</div>
            </div>
          </div>
          <div className="w-full bg-gray-100 h-2 rounded-full mt-5 overflow-hidden">
            <div className="bg-blue-500 h-full rounded-full" style={{ width: '28%' }} />
          </div>
        </div>
      </div>

      {/* EBITDA + Department Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h3 className="font-black text-gray-800 text-xs uppercase tracking-wider mb-5 flex items-center gap-2">
            <Calculator size={16} className="text-primary-600" /> EBITDA Calculator
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500">Collections</span>
              <div className="relative w-40">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs">$</span>
                <input
                  type="number"
                  disabled={timeframe !== 'daily'}
                  placeholder="0.00"
                  value={localCollections}
                  onChange={(e) => handleCollectionsChange(e.target.value)}
                  className="w-full p-2.5 pl-6 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 transition-colors text-right font-bold disabled:opacity-50"
                />
              </div>
            </div>
            <div className="h-px bg-gray-100" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500">Payroll Expense</span>
              <span className="text-xs font-bold text-gray-700">- {formatCurrency(financials.staffCost + financials.drCost)}</span>
            </div>
            <div className="flex items-center justify-between pt-3 bg-gray-50 p-4 rounded-xl border border-gray-100">
              <span className="font-black text-gray-800 text-sm">EBITDA</span>
              <div className="text-right">
                <div className="text-2xl font-black text-gray-900">{formatCurrency(ebitda)}</div>
                <div className={`text-[10px] font-bold mt-0.5 uppercase tracking-wider ${ebitdaPercent > 0 ? 'text-primary-600' : 'text-red-500'}`}>
                  {ebitdaPercent.toFixed(1)}% Margin
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h3 className="font-black text-gray-800 text-xs uppercase tracking-wider mb-5 flex items-center gap-2">
            <TrendingUp size={16} className="text-gray-400" /> Department Breakdown
          </h3>
          <div className="space-y-1">
            {Object.entries(financials.deptCosts).map(([dept, cost]) => (
              <div key={dept} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary-500" />
                  <span className="text-xs font-semibold text-gray-600">{dept}</span>
                </div>
                <span className="text-xs font-black text-gray-900">{formatCurrency(cost)}</span>
              </div>
            ))}
            {Object.keys(financials.deptCosts).length === 0 && (
              <div className="text-center text-gray-400 py-8 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                <p className="text-xs font-semibold">No payroll data for this period.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scheduled Hours Breakdown */}
      {(timeframe === 'daily' || timeframe === 'weekly') && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-black text-gray-800 text-xs uppercase tracking-wider flex items-center gap-2">
              <Clock size={16} className="text-primary-600" /> Scheduled Hours Breakdown
            </h3>
            <span className="text-[10px] font-bold text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
              {timeframe === 'weekly' ? 'Weekly Totals' : 'Daily Totals'}
            </span>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {staff.map((member) => (
              <div key={member.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200/80">
                <div>
                  <div className="font-bold text-xs text-gray-800">{member.name}</div>
                  <div className="text-[10px] text-gray-500 font-medium">{member.role}</div>
                </div>
                <div className="flex items-baseline gap-1 bg-white px-2.5 py-1 rounded-lg border border-gray-200">
                  <span className="text-sm font-black text-gray-800">{financials.staffHours[member.id]?.toFixed(1) || '0.0'}</span>
                  <span className="text-[9px] font-bold text-gray-400 uppercase">hrs</span>
                </div>
              </div>
            ))}
            {staff.length === 0 && <div className="col-span-full text-center py-8 text-gray-400 text-xs font-semibold">No staff found.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
