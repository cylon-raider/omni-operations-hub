// -----------------------------------------------------------------------------
// ScheduleGrid.jsx
// -----------------------------------------------------------------------------
// Interactive weekly/monthly schedule. Calendar Grid view shows a month at a
// glance; Employee View shows a spreadsheet of hours per staff member per day.
// Editing (adding/removing shifts, copying weeks) is restricted to payroll admins.
// -----------------------------------------------------------------------------
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, setDoc, doc, updateDoc, deleteField } from 'firebase/firestore';
import { ChevronLeft, ChevronRight, Copy, Calendar, Trash2, Plus, X, CalendarDays, Users, Printer } from 'lucide-react';
import { db } from '../../config/firebase';
import SegmentedControl from '../SegmentedControl';
import { getWeekDays, formatWeekRange } from '../../utils/payrollDate';
import { calculateHoursFromTimes, formatSmartTime } from '../../utils/payrollCalculations';
import { JOB_ROLES } from '../../utils/payrollConstants';

const getMonthCalendarWeeks = (year, month) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const weeks = [];
  const curr = new Date(firstDay);

  let dayDiff = curr.getDay() - 1;
  if (curr.getDay() === 0) dayDiff = 6;
  curr.setDate(curr.getDate() - dayDiff);

  while (curr <= lastDay || curr.getDay() !== 1) {
    const week = [];
    for (let i = 0; i < 6; i++) {
      week.push(new Date(curr).toISOString().split('T')[0]);
      curr.setDate(curr.getDate() + 1);
    }
    weeks.push(week);
    curr.setDate(curr.getDate() + 1);
  }
  return weeks;
};

const getShortRole = (role) => {
  if (role === 'Hygienist') return 'RDH';
  if (role === 'Hygiene Assistant') return 'RDH Asst';
  if (role === 'OS Assistant') return 'OS Asst';
  if (role === 'Sterilization Tech') return 'Steril Tech';
  return role;
};

const formatShiftTimeShorthand = (timeRange) => {
  const str = typeof timeRange === 'string' ? timeRange : String(timeRange || '');
  if (!str || !str.includes('-')) return str;
  const [start, end] = str.split('-');

  const formatSingleTime = (t) => {
    let clean = t.trim();
    const isPM = clean.toUpperCase().includes('PM');
    const isAM = clean.toUpperCase().includes('AM');
    let timePart = clean.replace(/[ap]m/i, '').trim();
    let [hours, minutes] = timePart.split(':');
    let h = parseInt(hours, 10);
    let m = minutes ? parseInt(minutes, 10) : 0;

    let mStr = m > 0 ? `:${m.toString().padStart(2, '0')}` : '';
    let suffix = isPM ? 'p' : isAM ? 'a' : '';
    return `${h}${mStr}${suffix}`;
  };

  return `${formatSingleTime(start)}-${formatSingleTime(end)}`;
};

const isShiftInTab = (key, val, tab, staffList) => {
  if (tab === 'all') return true;

  const valStr = typeof val === 'string' ? val : String(val || '');
  const isNeed = key.startsWith('need_') || valStr.toLowerCase().startsWith('need');

  if (isNeed) {
    const text = valStr.toLowerCase();
    if (tab === 'rdh') return text.includes('rdh') || text.includes('hygiene') || text.includes('hygienist');
    if (tab === 'assistants') return text.includes('assistant') || text.includes('tech') || text.includes('float') || text.includes('efda');
    if (tab === 'front') return text.includes('front') || text.includes('desk') || text.includes('receptionist') || text.includes('scheduler') || text.includes('concierge');
    if (tab === 'doctor') return text.includes('dr') || text.includes('doctor') || text.includes('dentist');
    return false;
  } else {
    const member = staffList.find((s) => s.id === key);
    if (!member) return false;
    const role = member.role;
    const dept = member.department;
    if (tab === 'rdh') return JOB_ROLES.Hygiene.includes(role);
    if (tab === 'assistants') return JOB_ROLES.Assistants.includes(role);
    if (tab === 'front') return JOB_ROLES['Front Desk'].includes(role) || dept === 'Front Desk';
    if (tab === 'doctor') return JOB_ROLES.Doctor.includes(role) || dept === 'Dr';
    return false;
  }
};

const ScheduleCell = ({ date, memberId, schedule, onUpdate, isPayrollAdmin }) => {
  const rawValue = schedule[date]?.[memberId] || '';
  const [dbStart, dbEnd] = rawValue.includes('-') ? rawValue.split('-') : ['', ''];

  const [start, setStart] = useState(dbStart);
  const [end, setEnd] = useState(dbEnd);

  useEffect(() => {
    const val = schedule[date]?.[memberId] || '';
    if (val.includes('-')) {
      const [s, e] = val.split('-');
      setStart(s);
      setEnd(e);
    } else {
      setStart('');
      setEnd('');
    }
  }, [schedule, date, memberId]);

  const handleBlur = () => {
    if (!isPayrollAdmin) return;
    const formattedStart = formatSmartTime(start);
    const formattedEnd = formatSmartTime(end, true);

    setStart(formattedStart);
    setEnd(formattedEnd);

    if (formattedStart || formattedEnd) {
      onUpdate(date, memberId, `${formattedStart}-${formattedEnd}`);
    } else {
      onUpdate(date, memberId, '');
    }
  };

  const hours = calculateHoursFromTimes(start, end);

  return (
    <div className="flex flex-col bg-gray-50 rounded-xl p-1.5 border border-gray-200 items-center justify-center min-w-[100px] transition-colors hover:border-primary-200">
      <div className="flex flex-col items-center gap-0.5 w-full mb-1">
        <input
          disabled={!isPayrollAdmin}
          type="text"
          className={`w-full text-center text-[11px] font-bold text-gray-700 bg-transparent outline-none placeholder:text-gray-300 p-0 focus:text-primary-700 ${!isPayrollAdmin ? 'cursor-not-allowed opacity-80' : ''}`}
          placeholder="Start"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onBlur={handleBlur}
        />
        <div className="w-8 h-[1px] bg-gray-200" />
        <input
          disabled={!isPayrollAdmin}
          type="text"
          className={`w-full text-center text-[11px] font-bold text-gray-700 bg-transparent outline-none placeholder:text-gray-300 p-0 focus:text-primary-700 ${!isPayrollAdmin ? 'cursor-not-allowed opacity-80' : ''}`}
          placeholder="End"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={handleBlur}
        />
      </div>
      <div className={`text-[10px] font-bold px-2 py-0.5 rounded-md mt-1 ${hours > 0 ? 'bg-primary-100 text-primary-700' : 'text-gray-300'}`}>
        {hours > 0 ? hours : '-'}
      </div>
    </div>
  );
};

export default function ScheduleGrid({ isPayrollAdmin }) {
  const [viewMode, setViewMode] = useState('calendar');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [calendarTab, setCalendarTab] = useState('all');
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());

  const [staff, setStaff] = useState([]);
  const [schedule, setSchedule] = useState({});

  const [selectedDayForModal, setSelectedDayForModal] = useState(null);
  const [newShiftType, setNewShiftType] = useState('employee');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const [vacantRole, setVacantRole] = useState('RDH');
  const [vacantTime, setVacantTime] = useState('9-5');

  useEffect(() => {
    const unsubStaff = onSnapshot(collection(db, 'payroll_staff'), (s) =>
      setStaff(s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => {
        if (a.role !== b.role) return a.role.localeCompare(b.role);
        return a.name.localeCompare(b.name);
      }))
    );
    const unsubSched = onSnapshot(collection(db, 'payroll_schedule'), (s) => {
      const data = {};
      s.forEach((d) => (data[d.id] = d.data()));
      setSchedule(data);
    });
    return () => { unsubStaff(); unsubSched(); };
  }, []);

  const weekDays = getWeekDays(selectedDate);

  const handleUpdate = async (date, staffId, val) => {
    if (!isPayrollAdmin) return;
    const dayData = schedule[date] || {};
    await setDoc(doc(db, 'payroll_schedule', date), { ...dayData, [staffId]: val }, { merge: true });
  };

  const handleDeleteShift = async (date, key) => {
    if (!isPayrollAdmin) return;
    try {
      await updateDoc(doc(db, 'payroll_schedule', date), { [key]: deleteField() });
    } catch (error) {
      console.error('Error deleting shift:', error);
    }
  };

  const handleAddShift = async (e) => {
    e.preventDefault();
    if (!isPayrollAdmin || !selectedDayForModal) return;

    const dayData = schedule[selectedDayForModal] || {};

    if (newShiftType === 'employee') {
      if (!selectedStaffId) return;
      const formattedStart = formatSmartTime(shiftStart);
      const formattedEnd = formatSmartTime(shiftEnd, true);

      if (formattedStart && formattedEnd) {
        await setDoc(doc(db, 'payroll_schedule', selectedDayForModal), {
          ...dayData,
          [selectedStaffId]: `${formattedStart}-${formattedEnd}`,
        }, { merge: true });
        setSelectedStaffId('');
        setShiftStart('');
        setShiftEnd('');
      } else {
        alert('Please enter a valid start and end time (e.g. 9a-5p).');
      }
    } else {
      const uniqueId = `need_${Date.now()}`;
      const timeText = vacantTime.trim() || '9-5';
      const val = `need ${vacantRole} ${timeText}`;
      await setDoc(doc(db, 'payroll_schedule', selectedDayForModal), { ...dayData, [uniqueId]: val }, { merge: true });
      setVacantTime('9-5');
    }
  };

  const copyLastWeek = async () => {
    if (!isPayrollAdmin) return;
    if (!confirm("Copy schedule from the previous week? This will overwrite the current week's schedule.")) return;

    const currentWeekStart = new Date(weekDays[0]);
    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    for (let i = 0; i < 7; i++) {
      const srcDate = new Date(lastWeekStart);
      srcDate.setDate(srcDate.getDate() + i);
      const targetDate = new Date(currentWeekStart);
      targetDate.setDate(targetDate.getDate() + i);

      const srcStr = srcDate.toISOString().split('T')[0];
      const targetStr = targetDate.toISOString().split('T')[0];

      const srcData = schedule[srcStr];
      if (srcData) {
        const currentData = schedule[targetStr] || {};
        await setDoc(doc(db, 'payroll_schedule', targetStr), { ...currentData, ...srcData }, { merge: true });
      }
    }
    alert('Schedule copied successfully!');
  };

  const copyWeekRow = async (rowDays) => {
    if (!isPayrollAdmin) return;
    if (!confirm('Copy schedule from the previous week for this week? This will overwrite existing shifts for these dates.')) return;

    for (let i = 0; i < 6; i++) {
      const targetStr = rowDays[i];
      const targetDate = new Date(targetStr);
      const srcDate = new Date(targetDate);
      srcDate.setDate(srcDate.getDate() - 7);
      const srcStr = srcDate.toISOString().split('T')[0];

      const srcData = schedule[srcStr];
      if (srcData) {
        const currentData = schedule[targetStr] || {};
        await setDoc(doc(db, 'payroll_schedule', targetStr), { ...currentData, ...srcData }, { merge: true });
      }
    }
    alert('Week schedule copied successfully!');
  };

  const shiftDate = (days) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const shiftMonth = (dir) => {
    const d = new Date(currentMonthDate);
    d.setMonth(d.getMonth() + dir);
    setCurrentMonthDate(d);
  };

  const groupedStaff = staff.reduce((acc, member) => {
    const d = member.department || 'Other';
    acc[d] = acc[d] || [];
    acc[d].push(member);
    return acc;
  }, {});

  const calendarYear = currentMonthDate.getFullYear();
  const calendarMonth = currentMonthDate.getMonth();
  const calendarWeeks = useMemo(() => getMonthCalendarWeeks(calendarYear, calendarMonth), [calendarYear, calendarMonth]);
  const monthLabel = currentMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Header / Navigators */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          {viewMode === 'employee' ? (
            <>
              <button onClick={() => shiftDate(-7)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"><ChevronLeft size={18} /></button>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700 bg-gray-100 px-3 py-1.5 rounded-xl border border-gray-200">
                <Calendar size={14} className="text-primary-600" />
                {formatWeekRange(selectedDate)}
              </div>
              <button onClick={() => shiftDate(7)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"><ChevronRight size={18} /></button>
            </>
          ) : (
            <>
              <button onClick={() => shiftMonth(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"><ChevronLeft size={18} /></button>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700 bg-gray-100 px-3 py-1.5 rounded-xl border border-gray-200">
                <Calendar size={14} className="text-primary-600" />
                {monthLabel}
              </div>
              <button onClick={() => shiftMonth(1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"><ChevronRight size={18} /></button>
            </>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <SegmentedControl
            size="sm"
            className="no-print"
            options={[
              { value: 'calendar', label: 'Calendar Grid', icon: CalendarDays },
              { value: 'employee', label: 'Employee View', icon: Users },
            ]}
            value={viewMode}
            onChange={setViewMode}
          />

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-xl transition-colors border border-gray-200 no-print"
          >
            <Printer size={14} /> Print
          </button>

          {isPayrollAdmin && viewMode === 'employee' && (
            <button onClick={copyLastWeek} className="flex items-center gap-1.5 text-xs font-bold text-primary-700 bg-primary-50 hover:bg-primary-100 px-4 py-2 rounded-xl transition-colors border border-primary-100 no-print">
              <Copy size={14} /> Copy Last Week
            </button>
          )}
        </div>
      </div>

      {/* CALENDAR GRID VIEW */}
      {viewMode === 'calendar' && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-3 overflow-x-auto no-print">
            {[
              { id: 'all', label: 'All Staff' },
              { id: 'rdh', label: 'RDH (Hygiene)' },
              { id: 'assistants', label: 'Assistants' },
              { id: 'front', label: 'Front Desk' },
              { id: 'doctor', label: 'Doctors' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCalendarTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                  calendarTab === tab.id ? 'bg-primary-100 text-primary-700 border border-primary-200' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <div className="min-w-[900px] print:min-w-0 print:w-full">
              <div className="grid grid-cols-[repeat(6,1fr)_100px] print:grid-cols-6 gap-[1px] bg-gray-200 border-b border-gray-200">
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => (
                  <div key={day} className="bg-gray-50 py-2.5 text-center text-[10px] font-black text-gray-500 uppercase tracking-wider">{day}</div>
                ))}
                <div className="bg-gray-50 py-2.5 text-center text-[10px] font-black text-gray-500 uppercase tracking-wider print:hidden">Copy Week</div>
              </div>

              <div className="space-y-[1px] bg-gray-200">
                {calendarWeeks.map((week, wIndex) => (
                  <div key={wIndex} className="grid grid-cols-[repeat(6,1fr)_100px] print:grid-cols-6 gap-[1px]">
                    {week.map((dayStr) => {
                      const d = new Date(dayStr);
                      const isCurrMonth = d.getMonth() === calendarMonth;
                      const isToday = dayStr === new Date().toISOString().split('T')[0];
                      const dayData = schedule[dayStr] || {};
                      const dayShifts = Object.entries(dayData).filter(([k, v]) => v && isShiftInTab(k, v, calendarTab, staff));

                      return (
                        <div
                          key={dayStr}
                          onClick={() => setSelectedDayForModal(dayStr)}
                          className={`min-h-[150px] bg-white p-3 flex flex-col gap-2 cursor-pointer transition-colors relative hover:bg-gray-50 select-none group/cell ${!isCurrMonth ? 'opacity-40' : ''}`}
                        >
                          <div className="flex justify-between items-center mb-1">
                            <span className={`text-xs font-bold ${isToday ? 'w-6 h-6 rounded-full bg-primary-500 text-white flex items-center justify-center' : 'text-gray-700'}`}>
                              {d.getDate()}
                            </span>
                            {!isCurrMonth && (
                              <span className="text-[9px] font-bold text-gray-300 uppercase">{d.toLocaleDateString('en-US', { month: 'short' })}</span>
                            )}
                          </div>

                          <div className="flex flex-col gap-1 flex-1 overflow-y-auto max-h-[105px]">
                            {dayShifts.map(([key, val]) => {
                              const isNeed = key.startsWith('need_') || val.toLowerCase().startsWith('need');
                              if (isNeed) {
                                return (
                                  <div key={key} className="relative group/shift flex items-center justify-between text-[9px] font-black tracking-tight text-white bg-red-500 rounded-lg py-1 px-2">
                                    <span className="uppercase">{val}</span>
                                    {isPayrollAdmin && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteShift(dayStr, key); }}
                                        className="opacity-0 group-hover/shift:opacity-100 p-0.5 hover:bg-red-700 rounded transition-opacity print:hidden"
                                        aria-label="Delete vacant slot"
                                        title="Delete slot"
                                      >
                                        <Trash2 size={10} className="text-white" />
                                      </button>
                                    )}
                                  </div>
                                );
                              } else {
                                const member = staff.find((s) => s.id === key);
                                if (!member) return null;
                                return (
                                  <div key={key} className="relative group/shift flex items-center justify-between text-[10px] font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg py-1 px-2 hover:border-primary-200">
                                    <div className="flex flex-col leading-tight">
                                      <span className="font-bold text-gray-800 text-[10px] truncate max-w-[90px]">{member.name}</span>
                                      <span className="text-[9px] text-gray-500 font-medium">{getShortRole(member.role)} {formatShiftTimeShorthand(val)}</span>
                                    </div>
                                    {isPayrollAdmin && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteShift(dayStr, key); }}
                                        className="opacity-0 group-hover/shift:opacity-100 p-0.5 text-gray-400 hover:text-red-500 rounded transition-opacity print:hidden"
                                        aria-label={`Delete ${member.name}'s shift`}
                                        title="Delete shift"
                                      >
                                        <Trash2 size={10} />
                                      </button>
                                    )}
                                  </div>
                                );
                              }
                            })}
                          </div>

                          {isPayrollAdmin && (
                            <div className="absolute bottom-2 right-2 opacity-0 group-hover/cell:opacity-100 transition-opacity p-1 bg-primary-50 text-primary-700 rounded-lg border border-primary-200 print:hidden">
                              <Plus size={13} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="bg-white flex items-center justify-center border-l border-gray-100 min-h-[150px] print:hidden">
                      {isPayrollAdmin ? (
                        <button
                          onClick={() => copyWeekRow(week)}
                          className="p-2.5 text-primary-700 hover:bg-primary-50 border border-primary-100 rounded-xl transition-colors flex flex-col items-center gap-1"
                          title="Copy schedule from previous week for this row"
                        >
                          <Copy size={14} />
                          <span className="text-[9px] font-bold uppercase tracking-wider">Copy</span>
                        </button>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EMPLOYEE VIEW */}
      {viewMode === 'employee' && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden p-2">
          <div className="overflow-x-auto pb-4">
            <div className="min-w-[1200px] p-4">
              <div className="grid grid-cols-[220px_repeat(7,1fr)_100px] gap-3 mb-4">
                <div className="font-bold text-gray-400 text-[10px] uppercase p-2 flex items-end tracking-wider">Employee</div>
                {weekDays.map((day) => {
                  const d = new Date(day);
                  const isToday = day === new Date().toISOString().split('T')[0];
                  return (
                    <div key={day} className={`text-center p-3 rounded-xl transition-colors ${isToday ? 'bg-primary-600 text-white' : 'bg-gray-50 text-gray-500'}`}>
                      <div className={`text-[9px] font-bold uppercase mb-0.5 ${isToday ? 'opacity-90' : 'opacity-70'}`}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                      <div className="text-lg font-black leading-none">{d.getDate()}</div>
                    </div>
                  );
                })}
                <div className="font-bold text-gray-400 text-[10px] uppercase p-2 flex items-end justify-center tracking-wider text-center">Totals</div>
              </div>

              <div className="space-y-6">
                {Object.entries(groupedStaff).map(([dept, members]) => (
                  <div key={dept}>
                    <div className="flex items-center gap-2 mb-3 px-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{dept}</span>
                    </div>

                    {members.map((member) => {
                      let totalSched = 0;
                      weekDays.forEach((day) => {
                        const dbVal = schedule[day]?.[member.id] || '';
                        let hrs;
                        if (dbVal.includes('-')) {
                          hrs = calculateHoursFromTimes(...dbVal.split('-'));
                        } else {
                          hrs = parseFloat(dbVal || '0');
                        }
                        totalSched += hrs;
                      });

                      return (
                        <div key={member.id} className="grid grid-cols-[220px_repeat(7,1fr)_100px] gap-3 items-stretch mb-2.5">
                          <div className="bg-gray-50 rounded-xl p-3 flex flex-col justify-center border border-gray-200">
                            <div className="font-bold text-xs text-gray-800 truncate mb-0.5">{member.name}</div>
                            <div className="text-[10px] text-gray-500 font-medium truncate">{member.role}</div>
                          </div>

                          {weekDays.map((day) => (
                            <ScheduleCell key={day} date={day} memberId={member.id} schedule={schedule} onUpdate={handleUpdate} isPayrollAdmin={isPayrollAdmin} />
                          ))}

                          <div className="flex flex-col justify-center items-center bg-gray-50 rounded-xl border border-gray-200 p-2">
                            <div className="text-base font-black text-gray-700">{parseFloat(totalSched.toFixed(2))}</div>
                            <span className="text-[9px] font-bold text-gray-400 uppercase">hrs</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHIFT DETAIL MODAL */}
      {selectedDayForModal && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden border border-gray-200">
            <div className="bg-gray-50 p-5 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h3 className="text-base font-black text-gray-800">{isPayrollAdmin ? 'Manage Shifts' : 'Day Shifts'}</h3>
                <p className="text-gray-500 text-xs mt-0.5 font-semibold">
                  {new Date(selectedDayForModal + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <button
                onClick={() => { setSelectedDayForModal(null); setSelectedStaffId(''); }}
                aria-label="Close"
                className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              <div className="space-y-2">
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Scheduled Shifts</h4>
                <div className="space-y-2">
                  {Object.entries(schedule[selectedDayForModal] || {}).filter(([, v]) => v).map(([key, val]) => {
                    const isNeed = key.startsWith('need_') || val.toLowerCase().startsWith('need');
                    if (isNeed) {
                      return (
                        <div key={key} className="flex justify-between items-center p-3 bg-red-50 border border-red-100 rounded-xl">
                          <span className="text-xs font-black tracking-tight text-red-600 uppercase">{val}</span>
                          {isPayrollAdmin && (
                            <button onClick={() => handleDeleteShift(selectedDayForModal, key)} aria-label="Delete vacant slot" className="p-1.5 hover:bg-red-100 rounded-lg text-red-500 transition-colors">
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      );
                    } else {
                      const member = staff.find((s) => s.id === key);
                      if (!member) return null;
                      return (
                        <div key={key} className="flex justify-between items-center p-3 bg-gray-50 border border-gray-200 rounded-xl">
                          <div>
                            <div className="text-sm font-bold text-gray-800">{member.name}</div>
                            <div className="text-xs text-gray-500 font-medium">{member.role} ({val})</div>
                          </div>
                          {isPayrollAdmin && (
                            <button onClick={() => handleDeleteShift(selectedDayForModal, key)} aria-label={`Delete ${member.name}'s shift`} className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-red-500 transition-colors">
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      );
                    }
                  })}
                  {Object.keys(schedule[selectedDayForModal] || {}).filter((k) => schedule[selectedDayForModal][k]).length === 0 && (
                    <div className="text-gray-400 text-xs italic text-center py-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                      No shifts scheduled for this day.
                    </div>
                  )}
                </div>
              </div>

              {isPayrollAdmin && (
                <div className="border-t border-gray-100 pt-5">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Add Shift</h4>

                  <div className="flex bg-gray-100 p-1 rounded-xl mb-4 text-xs font-bold">
                    <button type="button" onClick={() => setNewShiftType('employee')} className={`flex-1 py-2 text-center rounded-lg transition-colors ${newShiftType === 'employee' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'}`}>
                      Staff Shift
                    </button>
                    <button type="button" onClick={() => setNewShiftType('need')} className={`flex-1 py-2 text-center rounded-lg transition-colors ${newShiftType === 'need' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'}`}>
                      Vacant Slot (Need)
                    </button>
                  </div>

                  <form onSubmit={handleAddShift} className="space-y-3">
                    {newShiftType === 'employee' ? (
                      <>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Select Staff</label>
                          <select
                            required
                            value={selectedStaffId}
                            onChange={(e) => setSelectedStaffId(e.target.value)}
                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-800 font-medium outline-none focus:border-primary-500 cursor-pointer text-xs"
                          >
                            <option value="" disabled>Choose Employee</option>
                            {staff.filter((s) => !(schedule[selectedDayForModal] || {})[s.id]).map((s) => (
                              <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Start Time</label>
                            <input type="text" required placeholder="e.g. 9a" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)}
                              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-800 font-bold outline-none focus:border-primary-500 text-xs" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">End Time</label>
                            <input type="text" required placeholder="e.g. 5p" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)}
                              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-800 font-bold outline-none focus:border-primary-500 text-xs" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Role/Label</label>
                          <select value={vacantRole} onChange={(e) => setVacantRole(e.target.value)}
                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-800 font-medium outline-none focus:border-primary-500 cursor-pointer text-xs">
                            <option value="RDH">RDH</option>
                            <option value="Assistant">Assistant</option>
                            <option value="Front Desk">Front Desk</option>
                            <option value="Doctor">Doctor</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Time Range</label>
                          <input type="text" placeholder="e.g. 4-8p" value={vacantTime} onChange={(e) => setVacantTime(e.target.value)}
                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-800 font-bold outline-none focus:border-primary-500 text-xs" />
                        </div>
                      </div>
                    )}
                    <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition-colors mt-1 flex items-center justify-center gap-1.5 text-xs">
                      <Plus size={16} /> Add Shift to Schedule
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
