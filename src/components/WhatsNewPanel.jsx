import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { CHANGELOG, LATEST_CHANGE_DATE } from '../utils/changelog';

const SEEN_KEY = 'fds_whatsnew_seen';

export default function WhatsNewPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(() => {
    try {
      return LATEST_CHANGE_DATE !== null && localStorage.getItem(SEEN_KEY) !== LATEST_CHANGE_DATE;
    } catch {
      return LATEST_CHANGE_DATE !== null;
    }
  });
  const modalRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    setHasUnseen(false);
    try {
      if (LATEST_CHANGE_DATE) localStorage.setItem(SEEN_KEY, LATEST_CHANGE_DATE);
    } catch {
      // localStorage unavailable (private window, blocked storage, etc) —
      // non-critical, the pulsing dot just won't stay dismissed.
    }
  };

  if (CHANGELOG.length === 0) return null;

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-center gap-2 p-2 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors border border-transparent hover:border-gray-200"
      >
        <span className="relative flex items-center">
          <Sparkles size={14} />
          {hasUnseen && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-500" />
            </span>
          )}
        </span>
        What's New
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-gray-900/40 z-[60] flex items-center justify-center p-4">
          <div
            ref={modalRef}
            className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[70vh] flex flex-col"
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50 shrink-0">
              <div className="flex items-center gap-2 text-gray-800 font-bold">
                <Sparkles size={18} className="text-primary-500" />
                What's New
              </div>
              <button
                onClick={() => setIsOpen(false)}
                aria-label="Close what's new"
                className="p-1 hover:bg-gray-200 rounded-lg text-gray-500 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-5">
              {CHANGELOG.map((entry) => (
                <div key={entry.date}>
                  <p className="text-[10px] font-black text-primary-600 uppercase tracking-wider mb-2">
                    {new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                  <ul className="space-y-1.5">
                    {entry.items.map((item) => (
                      <li key={item} className="text-xs text-gray-600 font-medium flex gap-2">
                        <span className="text-primary-400 shrink-0">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
