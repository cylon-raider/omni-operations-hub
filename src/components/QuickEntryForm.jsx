import React, { useState } from 'react';
import { Plus } from 'lucide-react';

const QUEUES = [
  { value: 'Front Desk Supervisor', label: 'Front Desk Supervisor' },
  { value: 'Pod 1', label: 'Pod 1 (Dr. Arthurs)' },
  { value: 'Pod 2', label: 'Pod 2 (Dr. Williams)' },
  { value: 'Pod 3', label: 'Pod 3 (Dr. Zenner)' },
  { value: 'Billing', label: 'Billing' },
  { value: 'Clinical / Labs', label: 'Clinical / Labs' },
  { value: 'Hygiene', label: 'Hygiene' },
  { value: 'Treatment Coordinator', label: 'Treatment Coordinator' },
];

const PRIORITIES = ['NORMAL', 'TODAY', 'URGENT', 'ESCALATED'];

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function QuickEntryForm({ onAddCall, onSuccess, onError }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [assign, setAssign] = useState('Front Desk Supervisor');
  const [priority, setPriority] = useState('NORMAL');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onAddCall({
        fromName: name.trim().slice(0, 100),
        fromNumber: phone.trim().slice(0, 20),
        assignment: assign,
        priority,
        reason: reason.trim().slice(0, 50) || undefined,
      });
      setName('');
      setPhone('');
      setReason('');
      setPriority('NORMAL');
      if (onSuccess) onSuccess('Callback saved successfully!');
    } catch (err) {
      console.error('Error saving callback:', err);
      if (onError) onError('Failed to save callback. Please try again.');
    }
    setSaving(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <h3 className="font-black text-gray-800 text-xs uppercase tracking-wider mb-4 flex items-center gap-2">
        <Plus size={16} className="text-primary-600" /> Quick Callback Entry
      </h3>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Patient Name *
          </label>
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-2.5 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 transition-colors"
            placeholder="John Doe"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Phone Number *
          </label>
          <input
            required
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            className="w-full p-2.5 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 transition-colors"
            placeholder="(555) 555-5555"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Assign To
          </label>
          <select
            value={assign}
            onChange={(e) => setAssign(e.target.value)}
            className="w-full p-2.5 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 font-medium transition-colors"
          >
            {QUEUES.map((q) => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Priority
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full p-2.5 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 font-bold transition-colors"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Reason
          </label>
          <input
            maxLength={50}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full p-2.5 border border-gray-200 rounded-xl text-xs outline-none bg-gray-50 focus:bg-white focus:border-primary-500 transition-colors"
            placeholder="Appt reschedule"
          />
        </div>
        <div>
          <button
            disabled={saving}
            type="submit"
            className="w-full h-[38px] bg-primary-600 hover:bg-primary-700 disabled:bg-primary-800 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-colors shadow-sm flex items-center justify-center"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              'SAVE CALLBACK'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
