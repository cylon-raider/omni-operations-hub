import React from 'react';
import CallCard from './CallCard';

const QUEUES = [
  { id: 'front-desk', key: 'front desk', name: 'FRONT DESK', sub: 'SUPERVISOR', bg: 'bg-purple-700', text: 'text-purple-700' },
  { id: 'pod-2', key: 'pod 2', name: 'POD 2', sub: 'Dr. Williams', bg: 'bg-primary-700', text: 'text-primary-700' },
  { id: 'pod-1', key: 'pod 1', name: 'POD 1', sub: 'Dr. Arthurs', bg: 'bg-blue-600', text: 'text-blue-600' },
  { id: 'billing', key: 'billing', name: 'BILLING', sub: '', bg: 'bg-amber-500', text: 'text-amber-500' },
  { id: 'clinical', key: 'clinical / labs', name: 'CLINICAL / LABS', sub: '', bg: 'bg-orange-600', text: 'text-orange-600' },
  { id: 'treatment', key: 'treatment coordinator', name: 'TREATMENT', sub: 'COORDINATOR', bg: 'bg-red-600', text: 'text-red-600' },
  { id: 'pod-3', key: 'pod 3', name: 'POD 3', sub: 'Dr. Zenner', bg: 'bg-cyan-600', text: 'text-cyan-600' },
  { id: 'hygiene', key: 'hygiene', name: 'HYGIENE', sub: '', bg: 'bg-teal-600', text: 'text-teal-600' },
];

function getQueueCalls(queue, calls) {
  return calls.filter((c) => {
    if (!c.assignment) return false;
    const assigned = c.assignment.toLowerCase().trim();
    const queueName = queue.name.toLowerCase();
    const queueKey = queue.key.toLowerCase();

    if (assigned === queueKey || assigned === queueName) return true;
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
  });
}

export default function QueueHeader({ activeCalls, officeLocation, filterQueue, setFilterQueue, onUpdate, onResolve, onDelete }) {
  // Filter out pods if Litchfield
  const visibleQueues = QUEUES.filter(q => {
    if (officeLocation === 'litchfield') {
      return !['pod-1', 'pod-2', 'pod-3'].includes(q.id);
    }
    return true;
  });

  return (
    <div className={`grid gap-4 transition-all duration-1000 ease-in-out ${filterQueue !== 'all' ? 'grid-cols-1 max-w-4xl mx-auto' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
      {visibleQueues.map((q) => {
        // Derive the exact filter string that LiveDispatch expects from q.id
        const filterName = q.id.replace('-', ' ');
        const isSelected = filterQueue === 'all' || filterQueue === filterName;
        const isOnlySelected = filterQueue === filterName;
        
        const queueCalls = getQueueCalls(q, activeCalls);
        
        // Drama animation: slow fade out for non-selected, slight delay before selected pops
        return (
          <div 
            key={q.id} 
            className={`transition-all duration-[800ms] ease-[cubic-bezier(0.23,1,0.32,1)] transform
              ${!isSelected ? 'opacity-0 scale-50 absolute -z-10 w-0 h-0 m-0 p-0 overflow-hidden' : 'opacity-100 relative z-10 w-full'}
              ${isOnlySelected ? 'scale-100 delay-150' : 'scale-100'}
            `}
            style={!isSelected ? { pointerEvents: 'none', margin: 0, padding: 0 } : {}}
          >
            <button
              type="button"
              aria-pressed={isOnlySelected}
              aria-label={`${isOnlySelected ? 'Close' : 'Focus'} ${q.name} queue, ${queueCalls.length} waiting`}
              onClick={() => setFilterQueue && setFilterQueue(filterQueue === filterName ? 'all' : filterName)}
              className={`w-full text-left bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col cursor-pointer transition-all duration-500 ease-out hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/40
                ${isOnlySelected ? 'shadow-2xl ring-4 ring-primary-500/20 mb-6' : 'shadow-sm hover:scale-105'}
              `}
            >
              <div className={`${q.bg} text-white p-2.5 text-center transition-colors duration-300`}>
                <h3 className="text-[11px] font-black uppercase tracking-wider">{q.name}</h3>
                {q.sub && <p className="text-[9px] opacity-80 font-medium">{q.sub}</p>}
              </div>
              <div className="p-4 text-center my-auto">
                <div className={`text-3xl font-black transition-colors duration-300 ${q.text}`}>
                  {queueCalls.length}
                </div>
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                  Waiting
                </div>
              </div>
            </button>

            {/* Embedded Call List (Only shows when this is the uniquely selected queue) */}
            {isOnlySelected && (
              <div className="animate-in fade-in slide-in-from-top-4 duration-700 delay-300 fill-mode-both space-y-3">
                <div className="flex items-center justify-between mb-4 px-2">
                  <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
                    {queueCalls.length} Calls in {q.name} Queue
                  </h4>
                  <button 
                    onClick={() => setFilterQueue('all')}
                    className="text-xs font-bold text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-1 rounded-full transition-colors"
                  >
                    Close Queue
                  </button>
                </div>
                
                {queueCalls.length === 0 ? (
                  <div className="text-center p-8 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400 font-medium text-sm">
                    No calls waiting in this queue.
                  </div>
                ) : (
                  queueCalls.map(call => (
                    <CallCard
                      key={call.id}
                      call={call}
                      onUpdate={onUpdate}
                      onResolve={onResolve}
                      onDelete={onDelete}
                      officeLocation={officeLocation}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
