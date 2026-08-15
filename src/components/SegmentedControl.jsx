import React from 'react';

// Shared pill-style tab/toggle control used across the app (Live Dispatch's
// location toggle, Financials' tab bar, timeframe/view-mode switches, etc.)
// so the look and behavior stay consistent instead of being hand-rolled
// per page.
export default function SegmentedControl({ options, value, onChange, size = 'md', className = '' }) {
  const sizeClasses = size === 'sm'
    ? 'px-3 py-1.5 text-[10px]'
    : 'px-4 py-1.5 text-xs';

  return (
    <div className={`flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`flex items-center gap-1.5 rounded-lg font-bold uppercase tracking-wider transition-colors ${sizeClasses} ${
            value === opt.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          {opt.icon && <opt.icon size={size === 'sm' ? 13 : 14} />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
