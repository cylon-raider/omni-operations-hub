import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import CallCard from './CallCard';

export default function QueueSection({
  title,
  calls,
  onUpdate,
  onResolve,
  onDelete,
  defaultExpanded = true,
  emptyMessage = "No active calls in queue.",
  icon: Icon,
  topContent,
  user
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-4 group"
      >
        <div className="flex items-center gap-3">
          {Icon && <Icon size={18} className="text-gray-500 group-hover:text-primary-500 transition-colors" />}
          <h3 className="font-black text-gray-800 text-sm uppercase tracking-wide group-hover:text-primary-600 transition-colors">
            {title}
          </h3>
          <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md group-hover:bg-primary-50 transition-colors">
            {calls.length}
          </span>
        </div>
        {expanded ? (
          <ChevronDown size={20} className="text-gray-400 group-hover:text-primary-500 transition-colors" />
        ) : (
          <ChevronRight size={20} className="text-gray-400 group-hover:text-primary-500 transition-colors" />
        )}
      </button>

      {expanded && (
        <div className="space-y-3">
          {topContent && (
            <div className="mb-4 pb-4 border-b border-gray-100">
              {topContent}
            </div>
          )}
          {calls.length === 0 ? (
            <div className="text-center text-gray-400 py-8 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
              <CheckCircle2 size={24} className="mx-auto text-primary-500 mb-2 opacity-60" />
              <p className="text-xs font-semibold">{emptyMessage}</p>
            </div>
          ) : (
            calls.map((call) => (
              <CallCard
                key={call.id}
                call={call}
                onUpdate={onUpdate}
                onResolve={onResolve}
                onDelete={onDelete}
                user={user}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
