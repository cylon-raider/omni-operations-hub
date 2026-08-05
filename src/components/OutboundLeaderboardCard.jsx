import React, { useState, useMemo } from 'react';
import { Trophy, Calendar, CalendarDays, CalendarCheck2, History, X } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';

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

const getLocalToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getCurrentWeek = () => {
  const d = new Date();
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const week = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
};

const getCurrentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function OutboundLeaderboardCard({ calls }) {
  const [timeframe, setTimeframe] = useState('day');
  const [selectedDate, setSelectedDate] = useState(getLocalToday());
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeek());
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [selectedEmployeeForModal, setSelectedEmployeeForModal] = useState(null);

  // Compute filteredCalls so it can be used by both leaderboard and modal
  const filteredCalls = useMemo(() => {
    const now = new Date();

    // First, filter for outbound calls only
    const outboundCalls = (calls || []).filter((c) => {
      let isOutbound = false;

      // 1. Check for explicit direction field (new backend update)
      if (c.direction === 'outbound') {
        isOutbound = true;
      } else if (c.direction === 'inbound') {
        return false;
      }

      // 2. Check rawEvent
      if (!isOutbound && c.rawEvent && typeof c.rawEvent === 'string') {
        const match = c.rawEvent.match(/"direction"\s*:\s*"([^"]+)"/i);
        if (match && match[1]) {
          const dir = match[1].toLowerCase();
          if (dir === 'outbound') isOutbound = true;
          else if (dir === 'inbound') return false;
        }
      }

      // 3. AI flag & Ultimate fallback
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
        const empName = (c.employeeName || '').toLowerCase().trim();
        const validNames = [
          'jen', 'lisa', 'jamie', 'addison', 'mariana', 'brandy',
          'devin', 'liz', 'alessia', 'marianne', 'aubrey', 'marah',
          'pam', 'eylianna', 'dan'
        ];

        // Strict whitelist: Only allow calls from known valid employees
        if (!empName || !validNames.includes(empName)) return false;
        return true;
      }
      return false;
    });

    // Then filter by timeframe
    return outboundCalls.filter((c) => {
      if (!c.createdAt) return false;
      const callTime = c.createdAt.toMillis ? c.createdAt.toMillis() : 0;
      const callDate = new Date(callTime);

      const diffTime = Math.abs(now - callDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      switch (timeframe) {
        case 'day': {
          if (!selectedDate) return diffDays <= 1;
          const [y, m, d] = selectedDate.split('-');
          return callDate.getFullYear() === parseInt(y, 10) &&
            callDate.getMonth() === parseInt(m, 10) - 1 &&
            callDate.getDate() === parseInt(d, 10);
        }
        case 'week': {
          if (!selectedWeek) return diffDays <= 7;
          const [yw, ww] = selectedWeek.split('-W');
          const year = parseInt(yw, 10);
          const week = parseInt(ww, 10);

          const d = new Date(callDate.getTime());
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
          const week1 = new Date(d.getFullYear(), 0, 4);
          const callW = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);

          return d.getFullYear() === year && callW === week;
        }
        case 'month': {
          if (!selectedMonth) return diffDays <= 30;
          const [ym, mm] = selectedMonth.split('-');
          return callDate.getFullYear() === parseInt(ym, 10) &&
            callDate.getMonth() === parseInt(mm, 10) - 1;
        }
        case 'all':
          return true; // All historical data
        default:
          return true;
      }
    });
  }, [calls, timeframe, selectedDate, selectedWeek, selectedMonth]);

  // Compute leaderboard from filteredCalls
  const leaderboard = useMemo(() => {
    // Tally by employee, excluding "Unknown" or missing names
    const tally = filteredCalls.reduce((acc, call) => {
      if (!call.employeeName || call.employeeName.toLowerCase().trim() === 'unknown') return acc;

      const rawName = call.employeeName.trim();
      let empName = rawName.toUpperCase();
      const lowerName = rawName.toLowerCase();

      if (NAME_ALIASES[lowerName]) {
        if (NAME_ALIASES[lowerName] === 'IGNORE') return acc;
        empName = NAME_ALIASES[lowerName];
      }

      acc[empName] = (acc[empName] || 0) + 1;
      return acc;
    }, {});

    // Sort highest to lowest
    return Object.entries(tally).sort((a, b) => b[1] - a[1]);
  }, [filteredCalls]);

  return (
    <div className="bg-white rounded-2xl border border-blue-200 p-6 shadow-sm relative overflow-hidden mb-6">
      {/* Background Accent */}
      <div className="absolute -top-16 -right-16 w-32 h-32 bg-blue-50 rounded-full blur-2xl opacity-60"></div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="bg-blue-100 p-2 rounded-xl">
            <Trophy size={20} className="text-blue-600" />
          </div>
          <div>
            <h3 className="font-black text-gray-800 text-sm uppercase tracking-wide">Outbound Leaderboard</h3>
            <p className="text-xs text-gray-500 font-medium">Track team callback performance</p>
          </div>
        </div>

        {/* Timeframe Filters */}
        <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100">
          <div className="flex items-center">
            <button
              onClick={() => setTimeframe('day')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${timeframe === 'day' ? 'bg-white text-blue-600 shadow-sm border border-gray-200 rounded-r-none border-r-0' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <Calendar size={14} /> Day
            </button>
            {timeframe === 'day' && (
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white text-blue-600 border border-gray-200 rounded-r-lg px-2 py-1 text-xs font-bold shadow-sm outline-none cursor-pointer h-[30px]"
              />
            )}
          </div>
          <div className="flex items-center">
            <button
              onClick={() => setTimeframe('week')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${timeframe === 'week' ? 'bg-white text-blue-600 shadow-sm border border-gray-200 rounded-r-none border-r-0' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <CalendarDays size={14} /> Week
            </button>
            {timeframe === 'week' && (
              <input
                type="week"
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                className="bg-white text-blue-600 border border-gray-200 rounded-r-lg px-2 py-1 text-xs font-bold shadow-sm outline-none cursor-pointer h-[30px]"
              />
            )}
          </div>
          <div className="flex items-center">
            <button
              onClick={() => setTimeframe('month')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${timeframe === 'month' ? 'bg-white text-blue-600 shadow-sm border border-gray-200 rounded-r-none border-r-0' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <CalendarCheck2 size={14} /> Month
            </button>
            {timeframe === 'month' && (
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-white text-blue-600 border border-gray-200 rounded-r-lg px-2 py-1 text-xs font-bold shadow-sm outline-none cursor-pointer h-[30px]"
              />
            )}
          </div>
          <button
            onClick={() => setTimeframe('all')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${timeframe === 'all' ? 'bg-white text-blue-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            <History size={14} /> All Time
          </button>
        </div>
      </div>

      {/* Leaderboard Results */}
      <div className="flex flex-wrap gap-3 relative z-10">
        {leaderboard.length === 0 ? (
          <div className="w-full text-center py-6 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
            <span className="text-sm font-semibold text-gray-500">No outbound calls recorded for this timeframe.</span>
          </div>
        ) : (
          leaderboard.map(([emp, count], index) => {
            const isFirst = index === 0;
            return (
              <div
                key={emp}
                onClick={() => setSelectedEmployeeForModal(emp)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-sm cursor-pointer ${isFirst
                  ? 'bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200'
                  : 'bg-white border-gray-200'
                  }`}
              >
                <div className="flex flex-col">
                  <span className={`text-xs font-black uppercase tracking-widest ${isFirst ? 'text-blue-700' : 'text-gray-700'}`}>
                    {emp}
                  </span>
                  {isFirst && <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">Top Caller</span>}
                </div>
                <div className={`flex items-center justify-center min-w-[28px] h-7 rounded-lg ${isFirst ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}>
                  <span className="text-sm font-black">{count}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal for Employee Calls */}
      {selectedEmployeeForModal && (
        <ErrorBoundary>
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4" onClick={() => setSelectedEmployeeForModal(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <Trophy size={18} className="text-blue-600" />
                  <h3 className="font-bold text-gray-800 uppercase tracking-wide">
                    {selectedEmployeeForModal}'s Calls
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedEmployeeForModal(null)}
                  className="text-xs font-bold text-gray-500 hover:text-gray-800 transition-colors"
                >
                  CLOSE
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <div className="space-y-3">
                  {filteredCalls
                    .filter(c => {
                      const rawName = String(c.employeeName || '').trim();
                      if (!rawName || rawName.toLowerCase() === 'unknown') return false;
                      const lowerName = rawName.toLowerCase();
                      let empName = rawName.toUpperCase();
                      if (NAME_ALIASES[lowerName]) {
                        if (NAME_ALIASES[lowerName] === 'IGNORE') return false;
                        empName = NAME_ALIASES[lowerName];
                      }
                      return empName === selectedEmployeeForModal;
                    })
                    .map((call, idx) => (
                      <div key={call.callId || idx} className="p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-medium text-gray-700 flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-md">{call.fromNumber}</span>
                          <span className="text-xs text-gray-400 font-medium">
                            {typeof call.createdAt?.toDate === 'function' ? call.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500 font-mono bg-white p-1.5 rounded border border-gray-100 truncate">ID: {call.callId}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </ErrorBoundary>
      )}
    </div>
  );
}
