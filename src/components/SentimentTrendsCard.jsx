import React, { useState, useMemo, useEffect } from 'react';
import { Gauge, Calendar, CalendarDays, CalendarCheck2, History, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, APP_ID } from '../config/firebase';
import { getSentimentScore, getSentimentLabel, getSentimentBucket } from '../utils/sentiment';
import SentimentGauge from './SentimentGauge';

const CALLS_PATH = `artifacts/${APP_ID}/public/data/calls`;

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

// Same ISO-week definition used by getCurrentWeek above, applied to an
// arbitrary call date so a call can be matched against a selected week.
function getCallIsoWeek(callDate) {
  const d = new Date(callDate.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Monday of a given ISO week string, per the same ISO-week definition as
// getCallIsoWeek above (ISO week 1 is whichever week contains Jan 4).
function getWeekMonday(weekStr) {
  const [yw, ww] = weekStr.split('-W');
  const year = parseInt(yw, 10);
  const week = parseInt(ww, 10);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  return monday;
}

// Operates on an actual date (Monday minus 7 days) rather than decrementing
// the week number directly — late-December/early-January weeks don't
// consistently belong to the calendar year their number suggests (e.g.
// 2025-12-29 is ISO week 2026-W01), so date arithmetic is what's robust
// across year boundaries, not the week-number arithmetic itself.
function getPreviousWeekString(weekStr) {
  const monday = getWeekMonday(weekStr);
  monday.setDate(monday.getDate() - 7);
  return getCallIsoWeek(monday);
}

const BUCKET_STYLES = {
  negative: { color: 'bg-red-500', label: 'Negative' },
  neutral: { color: 'bg-amber-500', label: 'Neutral' },
  positive: { color: 'bg-green-500', label: 'Positive' },
};

export default function SentimentTrendsCard({ calls = [], officeLocation }) {
  const [timeframe, setTimeframe] = useState('day');
  const [selectedDate, setSelectedDate] = useState(getLocalToday());
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeek());
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());

  // `calls` (from useCalls.js) is bounded to the last 90 days for
  // performance — "All Time" needs the full history, fetched on demand only
  // when that tab is actually selected. Mirrors OutboundLeaderboardCard.jsx.
  const [allTimeCalls, setAllTimeCalls] = useState(null);
  const [allTimeFetchFailed, setAllTimeFetchFailed] = useState(false);
  const allTimeLoading = timeframe === 'all' && allTimeCalls === null && !allTimeFetchFailed;

  useEffect(() => {
    if (timeframe !== 'all' || !officeLocation) return;
    let cancelled = false;
    const q = query(collection(db, CALLS_PATH), where('location', '==', officeLocation));
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        setAllTimeCalls(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      })
      .catch((err) => {
        console.error('Failed to fetch all-time calls for sentiment:', err);
        if (!cancelled) setAllTimeFetchFailed(true);
      });
    return () => { cancelled = true; };
  }, [timeframe, officeLocation]);

  const timeframeCalls = useMemo(() => {
    const sourceCalls = timeframe === 'all' ? (allTimeCalls || []) : calls;
    if (timeframe === 'all') return sourceCalls;

    return sourceCalls.filter((c) => {
      if (!c.createdAt?.toMillis) return false;
      const callDate = new Date(c.createdAt.toMillis());
      switch (timeframe) {
        case 'day': {
          const [y, m, d] = selectedDate.split('-');
          return callDate.getFullYear() === parseInt(y, 10) &&
            callDate.getMonth() === parseInt(m, 10) - 1 &&
            callDate.getDate() === parseInt(d, 10);
        }
        case 'week':
          return getCallIsoWeek(callDate) === selectedWeek;
        case 'month': {
          const [ym, mm] = selectedMonth.split('-');
          return callDate.getFullYear() === parseInt(ym, 10) &&
            callDate.getMonth() === parseInt(mm, 10) - 1;
        }
        default:
          return true;
      }
    });
  }, [calls, allTimeCalls, timeframe, selectedDate, selectedWeek, selectedMonth]);

  const scores = useMemo(() => timeframeCalls
    .map((c) => getSentimentScore(c))
    .filter((s) => s !== null), [timeframeCalls]);

  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const distribution = useMemo(() => {
    const buckets = { negative: 0, neutral: 0, positive: 0 };
    scores.forEach((s) => { buckets[getSentimentBucket(s)]++; });
    return buckets;
  }, [scores]);

  // Week-over-week comparison — only meaningful while looking at a specific
  // week, so it's hidden on the other tabs. Uses the bounded `calls` list
  // (not All Time), matching the same 90-day window the Week tab itself uses.
  const weekOverWeek = useMemo(() => {
    if (timeframe !== 'week' || avgScore === null) return null;
    const prevWeek = getPreviousWeekString(selectedWeek);
    const prevScores = calls
      .filter((c) => c.createdAt?.toMillis && getCallIsoWeek(new Date(c.createdAt.toMillis())) === prevWeek)
      .map((c) => getSentimentScore(c))
      .filter((s) => s !== null);
    if (prevScores.length === 0) return null;
    const prevAvg = prevScores.reduce((a, b) => a + b, 0) / prevScores.length;
    return { prevAvg, delta: avgScore - prevAvg };
  }, [timeframe, selectedWeek, calls, avgScore]);

  const totalScored = scores.length;

  return (
    <div className="bg-white rounded-2xl border border-primary-200 p-6 shadow-sm relative overflow-hidden mb-6">
      <div className="absolute -top-16 -left-16 w-32 h-32 bg-primary-50 rounded-full blur-2xl opacity-60"></div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="bg-primary-100 p-2 rounded-xl">
            <Gauge size={20} className="text-primary-600" />
          </div>
          <div>
            <h3 className="font-black text-gray-800 text-sm uppercase tracking-wide">Caller Sentiment</h3>
            <p className="text-xs text-gray-500 font-medium">AI-assessed mood across analyzed calls</p>
          </div>
        </div>

        {/* Timeframe Filters */}
        <div className="flex items-center flex-wrap md:flex-nowrap gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 w-full md:w-auto">
          <div className="flex items-center">
            <button
              onClick={() => setTimeframe('day')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${timeframe === 'day' ? 'bg-white text-primary-600 shadow-sm border border-gray-200 rounded-r-none border-r-0' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <Calendar size={14} /> Day
            </button>
            {timeframe === 'day' && (
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white text-primary-600 border border-gray-200 rounded-r-lg px-2 py-1 text-xs font-bold shadow-sm outline-none cursor-pointer h-[30px]"
              />
            )}
          </div>
          <div className="flex items-center">
            <button
              onClick={() => setTimeframe('week')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${timeframe === 'week' ? 'bg-white text-primary-600 shadow-sm border border-gray-200 rounded-r-none border-r-0' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <CalendarDays size={14} /> Week
            </button>
            {timeframe === 'week' && (
              <input
                type="week"
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                className="bg-white text-primary-600 border border-gray-200 rounded-r-lg px-2 py-1 text-xs font-bold shadow-sm outline-none cursor-pointer h-[30px]"
              />
            )}
          </div>
          <div className="flex items-center">
            <button
              onClick={() => setTimeframe('month')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${timeframe === 'month' ? 'bg-white text-primary-600 shadow-sm border border-gray-200 rounded-r-none border-r-0' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <CalendarCheck2 size={14} /> Month
            </button>
            {timeframe === 'month' && (
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-white text-primary-600 border border-gray-200 rounded-r-lg px-2 py-1 text-xs font-bold shadow-sm outline-none cursor-pointer h-[30px]"
              />
            )}
          </div>
          <button
            onClick={() => setTimeframe('all')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${timeframe === 'all' ? 'bg-white text-primary-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            <History size={14} /> All Time
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="relative z-10">
        {timeframe === 'all' && allTimeLoading ? (
          <div className="w-full text-center py-6 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
            <span className="text-sm font-semibold text-gray-500">Loading all-time history…</span>
          </div>
        ) : totalScored === 0 ? (
          <div className="w-full text-center py-6 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
            <span className="text-sm font-semibold text-gray-500">No analyzed calls for this timeframe.</span>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="flex flex-col items-center shrink-0">
              <SentimentGauge score={avgScore} size="lg" />
              <span className="text-sm font-black text-gray-800 -mt-1">{getSentimentLabel(avgScore)}</span>
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{totalScored} call{totalScored === 1 ? '' : 's'} analyzed</span>
            </div>

            <div className="flex-1 w-full space-y-3">
              {/* Distribution bar */}
              <div>
                <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
                  {(['negative', 'neutral', 'positive']).map((key) => {
                    const pct = totalScored > 0 ? (distribution[key] / totalScored) * 100 : 0;
                    if (pct === 0) return null;
                    return <div key={key} className={BUCKET_STYLES[key].color} style={{ width: `${pct}%` }} />;
                  })}
                </div>
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  {(['negative', 'neutral', 'positive']).map((key) => (
                    <span key={key} className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                      <span className={`w-2 h-2 rounded-full ${BUCKET_STYLES[key].color}`} />
                      {BUCKET_STYLES[key].label} ({distribution[key]})
                    </span>
                  ))}
                </div>
              </div>

              {/* Week-over-week */}
              {weekOverWeek && (
                <div className={`flex items-center gap-2 w-fit px-3 py-1.5 rounded-lg border text-xs font-bold ${
                  weekOverWeek.delta > 0.02 ? 'bg-green-50 border-green-200 text-green-700' :
                  weekOverWeek.delta < -0.02 ? 'bg-red-50 border-red-200 text-red-700' :
                  'bg-gray-50 border-gray-200 text-gray-600'
                }`}>
                  {weekOverWeek.delta > 0.02 ? <TrendingUp size={14} /> : weekOverWeek.delta < -0.02 ? <TrendingDown size={14} /> : <Minus size={14} />}
                  {weekOverWeek.delta >= 0 ? '+' : ''}{weekOverWeek.delta.toFixed(2)} vs last week ({weekOverWeek.prevAvg.toFixed(2)})
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
