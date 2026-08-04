import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function PlaceholderPage({ title }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-sm">
      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">🚧</span>
      </div>
      <h3 className="font-black text-gray-800 text-lg uppercase tracking-wide">
        {title}
      </h3>
      <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
        This module is currently being developed. It will be available in a future update.
      </p>
      <button
        onClick={() => navigate('/')}
        className="mt-6 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors"
      >
        Return to Live Dispatch
      </button>
    </div>
  );
}
