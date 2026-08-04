import React from 'react';

const QUEUES = [
  { id: 'front-desk', key: 'front desk', name: 'FRONT DESK', sub: 'SUPERVISOR', bg: 'bg-purple-700', text: 'text-purple-700' },
  { id: 'pod-2', key: 'pod 2', name: 'POD 2', sub: 'Dr. Williams', bg: 'bg-emerald-700', text: 'text-emerald-700' },
  { id: 'pod-1', key: 'pod 1', name: 'POD 1', sub: 'Dr. Arthurs', bg: 'bg-blue-600', text: 'text-blue-600' },
  { id: 'billing', key: 'billing', name: 'BILLING', sub: '', bg: 'bg-amber-500', text: 'text-amber-500' },
  { id: 'clinical', key: 'clinical / labs', name: 'CLINICAL / LABS', sub: '', bg: 'bg-orange-600', text: 'text-orange-600' },
  { id: 'treatment', key: 'treatment coordinator', name: 'TREATMENT', sub: 'COORDINATOR', bg: 'bg-red-600', text: 'text-red-600' },
  { id: 'pod-3', key: 'pod 3', name: 'POD 3', sub: 'Dr. Zenner', bg: 'bg-cyan-600', text: 'text-cyan-600' },
  { id: 'hygiene', key: 'hygiene', name: 'HYGIENE', sub: '', bg: 'bg-teal-600', text: 'text-teal-600' },
];

function getQueueCount(queue, calls) {
  return calls.filter((c) => {
    if (!c.assignment) return false;
    const assigned = c.assignment.toLowerCase().trim();
    const queueName = queue.name.toLowerCase();
    const queueKey = queue.key.toLowerCase();

    // Exact match on normalized assignment
    if (assigned === queueKey || assigned === queueName) return true;

    // Match common variations
    if (queue.id === 'front-desk' && (assigned.includes('front desk') || assigned.includes('supervisor'))) return true;
    if (queue.id === 'pod-1' && assigned === 'pod 1 scheduler') return true;
    if (queue.id === 'pod-2' && assigned === 'pod 2 scheduler') return true;
    if (queue.id === 'pod-3' && assigned === 'pod 3 scheduler') return true;
    if (queue.id === 'pod-1' && assigned === 'pod 1') return true;
    if (queue.id === 'pod-2' && assigned === 'pod 2') return true;
    if (queue.id === 'pod-3' && assigned === 'pod 3') return true;
    if (queue.id === 'billing' && assigned === 'billing') return true;
    if (queue.id === 'treatment' && assigned.includes('treatment')) return true;
    if (queue.id === 'hygiene' && assigned.includes('hygiene')) return true;
    if (queue.id === 'clinical' && (assigned.includes('clinical') || assigned.includes('labs'))) return true;

    return false;
  }).length;
}

export default function QueueHeader({ activeCalls }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {QUEUES.map((q) => (
        <div key={q.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex flex-col">
          <div className={`${q.bg} text-white p-2.5 text-center`}>
            <h3 className="text-[11px] font-black uppercase tracking-wider">{q.name}</h3>
            {q.sub && <p className="text-[9px] opacity-80 font-medium">{q.sub}</p>}
          </div>
          <div className="p-4 text-center my-auto">
            <div className={`text-3xl font-black ${q.text}`}>
              {getQueueCount(q, activeCalls)}
            </div>
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">
              Waiting
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
