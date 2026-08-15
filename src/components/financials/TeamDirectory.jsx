// -----------------------------------------------------------------------------
// TeamDirectory.jsx
// -----------------------------------------------------------------------------
// Staff directory (CRUD, admin-only edits) + App Access sub-tab where payroll
// admins can promote/demote other logged-in fds-hub users' `payrollRole`.
//
// Pay rates live in a separate `payroll_staffRates` collection (see
// firestore.rules): a payroll admin can read every rate, a non-admin can only
// read the single rate doc linked (by email) to their own login — enforced
// by the database, not just hidden in the UI.
// -----------------------------------------------------------------------------
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, setDoc, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { Plus, Pencil, Trash2, X, Briefcase, User, Mail, ChevronRight, Shield, Lock } from 'lucide-react';
import { db } from '../../config/firebase';
import SegmentedControl from '../SegmentedControl';
import { DEPARTMENTS, JOB_ROLES, OWNER_EMAILS } from '../../utils/payrollConstants';
import { formatCurrency } from '../../utils/payrollCalculations';

export default function TeamDirectory({ user, isPayrollAdmin, onToast }) {
  const [activeTab, setActiveTab] = useState('staff');

  const [staff, setStaff] = useState([]);
  const [appUsers, setAppUsers] = useState([]);
  const [ratesById, setRatesById] = useState({});
  const [myRate, setMyRate] = useState(null);

  useEffect(() => {
    const unsubStaff = onSnapshot(collection(db, 'payroll_staff'), (snapshot) => {
      const loaded = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
      setStaff(loaded.sort((a, b) => a.name.localeCompare(b.name)));
    }, (err) => console.error('Error fetching staff:', err));

    let unsubUsers = () => {};
    if (isPayrollAdmin) {
      unsubUsers = onSnapshot(collection(db, 'users'), (s) => {
        setAppUsers(s.docs.map((d) => {
          const data = d.data();
          return { ...data, uid: data.uid || d.id, email: data.email || 'No Email' };
        }));
      });
    }
    return () => { unsubStaff(); unsubUsers(); };
  }, [isPayrollAdmin]);

  // Rates: admins get every rate; non-admins only get the single rate doc
  // linked to their own login email (enforced by firestore.rules).
  useEffect(() => {
    if (isPayrollAdmin) {
      const unsub = onSnapshot(collection(db, 'payroll_staffRates'), (s) => {
        const map = {};
        s.docs.forEach((d) => (map[d.id] = d.data().rate));
        setRatesById(map);
      });
      return () => unsub();
    }

    const myStaff = staff.find((s) => s.email && user?.email && s.email.toLowerCase() === user.email.toLowerCase());
    if (!myStaff) {
      setMyRate(null);
      return;
    }
    const unsub = onSnapshot(doc(db, 'payroll_staffRates', myStaff.id), (snap) => {
      setMyRate(snap.exists() ? snap.data().rate : null);
    }, () => setMyRate(null));
    return () => unsub();
  }, [isPayrollAdmin, staff, user]);

  const getDisplayRate = (member) => {
    if (isPayrollAdmin) return ratesById[member.id];
    if (member.email && user?.email && member.email.toLowerCase() === user.email.toLowerCase()) return myRate;
    return undefined;
  };

  const [isEditing, setIsEditing] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dept, setDept] = useState('General');
  const [role, setRole] = useState('');
  const [rate, setRate] = useState('');

  const handleSaveStaff = async (e) => {
    e.preventDefault();
    const memberData = { name, department: dept, role, email: email.trim() };
    const staffId = isEditing ? isEditing.id : Date.now().toString();
    try {
      if (isEditing) {
        await updateDoc(doc(db, 'payroll_staff', staffId), memberData);
      } else {
        await setDoc(doc(db, 'payroll_staff', staffId), memberData);
      }
      await setDoc(doc(db, 'payroll_staffRates', staffId), { rate: parseFloat(rate) || 0 });
      onToast?.(isEditing ? 'Staff member updated' : 'Staff member added', 'success');
      resetForm();
    } catch (err) {
      console.error('Error saving staff:', err);
      onToast?.('Failed to save staff member', 'error');
    }
  };

  const handleDeleteStaff = async (id) => {
    if (confirm('Remove this staff member?')) {
      await deleteDoc(doc(db, 'payroll_staff', id));
      await deleteDoc(doc(db, 'payroll_staffRates', id));
      onToast?.('Staff member removed', 'success');
    }
  };

  const resetForm = () => {
    setIsEditing(null);
    setName('');
    setEmail('');
    setDept('General');
    setRole('');
    setRate('');
  };

  const startEdit = (member) => {
    setIsEditing(member);
    setName(member.name);
    setEmail(member.email || '');
    setDept(member.department);
    setRole(member.role);
    setRate((ratesById[member.id] ?? '').toString());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleAdmin = async (targetUid, currentRole) => {
    if (targetUid === user?.uid) return;
    const newRole = currentRole === 'admin' ? 'viewer' : 'admin';
    await updateDoc(doc(db, 'users', targetUid), { payrollRole: newRole });
  };

  const groupedStaff = staff.reduce((acc, member) => {
    const d = member.department || 'Other';
    acc[d] = acc[d] || [];
    acc[d].push(member);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Sub-tab switcher */}
      {isPayrollAdmin && (
        <SegmentedControl
          className="w-fit"
          options={[
            { value: 'staff', label: 'Staff List' },
            { value: 'access', label: 'App Access', icon: Shield },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
      )}

      {/* STAFF LIST */}
      {activeTab === 'staff' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {isPayrollAdmin && (
            <div className="lg:col-span-1">
              <form onSubmit={handleSaveStaff} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4 sticky top-6">
                <h3 className="font-black text-gray-800 text-xs uppercase tracking-wider border-b border-gray-100 pb-3">
                  {isEditing ? 'Edit Member' : 'Add New Member'}
                </h3>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 text-gray-400" size={16} />
                    <input value={name} onChange={(e) => setName(e.target.value)} required
                      className="w-full p-2.5 pl-9 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 transition-colors"
                      placeholder="Full Name" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Login Email (optional)</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 text-gray-400" size={16} />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      className="w-full p-2.5 pl-9 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 transition-colors"
                      placeholder="matches their fds-hub login" />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Must exactly match this person's fds-hub login email so they can see their own rate/schedule here.</p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Department</label>
                  <div className="relative">
                    <Briefcase className="absolute left-3 top-3 text-gray-400" size={16} />
                    <select value={dept} onChange={(e) => setDept(e.target.value)}
                      className="w-full p-2.5 pl-9 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 appearance-none transition-colors font-medium cursor-pointer">
                      {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <ChevronRight className="absolute right-3 top-3 text-gray-400 rotate-90 pointer-events-none" size={14} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Role</label>
                  <div className="relative">
                    <select value={role} onChange={(e) => setRole(e.target.value)} required
                      className="w-full p-2.5 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 appearance-none transition-colors font-medium cursor-pointer">
                      <option value="" disabled>Select Role</option>
                      {Object.entries(JOB_ROLES).map(([cat, roles]) => (
                        <optgroup key={cat} label={cat}>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</optgroup>
                      ))}
                    </select>
                    <ChevronRight className="absolute right-3 top-3 text-gray-400 rotate-90 pointer-events-none" size={14} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Hourly Rate</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-gray-400 font-bold text-xs">$</span>
                    <input type="number" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} required
                      className="w-full p-2.5 pl-7 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 transition-colors font-bold"
                      placeholder="0.00" />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  {isEditing && (
                    <button type="button" onClick={resetForm} className="w-1/3 bg-gray-100 text-gray-600 font-bold py-2.5 rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center">
                      <X size={16} />
                    </button>
                  )}
                  <button type="submit" className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-bold py-2.5 rounded-xl text-xs transition-colors shadow-sm flex items-center justify-center gap-1.5">
                    {isEditing ? 'Update Staff' : <><Plus size={16} /> Add Member</>}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className={isPayrollAdmin ? 'lg:col-span-2 space-y-6' : 'lg:col-span-3 space-y-6'}>
            {Object.entries(groupedStaff).map(([groupName, members]) => (
              <div key={groupName} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gray-50 px-6 py-3 border-b border-gray-100 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary-500" />
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{groupName}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {members.map((member) => {
                    const isMe = member.email && user?.email && member.email.toLowerCase() === user.email.toLowerCase();
                    const displayRate = getDisplayRate(member);
                    return (
                      <div key={member.id} className={`p-4 flex items-center justify-between hover:bg-gray-50/60 transition-colors group ${isMe ? 'bg-primary-50/40' : ''}`}>
                        <div>
                          <div className="font-bold text-gray-800 text-sm mb-0.5 flex items-center gap-2">
                            {member.name}
                            {isMe && <span className="text-[9px] font-bold text-primary-700 bg-primary-100 px-1.5 py-0.5 rounded-full">YOU</span>}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-2">
                            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] font-semibold">{member.role}</span>
                            {displayRate !== undefined && (
                              <span className="text-primary-700 font-bold bg-primary-50 border border-primary-100 px-1.5 py-0.5 rounded text-[10px]">
                                {formatCurrency(displayRate)}/hr
                              </span>
                            )}
                          </div>
                        </div>
                        {isPayrollAdmin && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEdit(member)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"><Pencil size={16} /></button>
                            <button onClick={() => handleDeleteStaff(member.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16} /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {staff.length === 0 && (
              <div className="text-center text-gray-400 py-8 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                <p className="text-xs font-semibold">No staff members yet.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* APP ACCESS */}
      {activeTab === 'access' && isPayrollAdmin && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden max-w-3xl">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-100">
            <h3 className="font-black text-gray-800 text-xs uppercase tracking-wider flex items-center gap-2">
              <Shield size={16} className="text-primary-600" /> System Users
            </h3>
            <p className="text-gray-500 text-xs mt-1">Manage who can access financial data.</p>
          </div>
          <div className="divide-y divide-gray-50">
            {appUsers.map((u) => {
              const payrollRole = u.payrollRole || 'viewer';
              const isOwner = OWNER_EMAILS.includes(u.email);
              // Owner emails auto-bootstrap to admin the first time *they* open this
              // page — until then they can still show as viewer, so only lock the
              // control once they're actually admin (self is always locked).
              const isLocked = u.uid === user?.uid || (isOwner && payrollRole === 'admin');
              return (
                <div key={u.uid} className="p-4 flex items-center justify-between hover:bg-gray-50/60 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-sm ${payrollRole === 'admin' ? 'bg-primary-500' : 'bg-gray-300'}`}>
                      {u.email?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-gray-800 text-sm">{u.email}</div>
                      <div className="text-[10px] text-gray-400 flex items-center gap-2 mt-0.5">
                        <span className="font-mono bg-gray-100 px-1.5 rounded">{u.uid.slice(0, 8)}...</span>
                        {u.uid === user?.uid && <span className="bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full text-[9px] font-bold">YOU</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className={`text-[10px] font-bold px-3 py-1 rounded-full border uppercase tracking-wider ${payrollRole === 'admin' ? 'bg-primary-50 text-primary-700 border-primary-100' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                      {payrollRole}
                    </div>
                    {!isLocked && (
                      <button
                        onClick={() => toggleAdmin(u.uid, payrollRole)}
                        className="text-xs font-bold text-gray-500 hover:text-primary-600 hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {payrollRole === 'admin' ? 'Demote to Viewer' : 'Promote to Admin'}
                      </button>
                    )}
                    {isLocked && (
                      <div className="text-gray-300 p-2"><Lock size={16} /></div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
