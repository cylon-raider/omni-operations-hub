import React, { useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Menu, Clock } from 'lucide-react';

import { useAuth } from './hooks/useAuth';
import { useCalls } from './hooks/useCalls';
import { useToast } from './components/Toast';

import LoginScreen from './components/LoginScreen';
import Sidebar from './components/Sidebar';
import LiveDispatch from './pages/LiveDispatch';
import PlaceholderPage from './pages/PlaceholderPage';

// Route → Display name mapping
const PAGE_TITLES = {
  '/': 'Live Dispatch',
  '/financials': 'Financials & Payroll',
  '/billing': 'Billing Center',
  '/clinical': 'Clinical Center',
  '/hygiene': 'Hygiene Center',
  '/prescriptions': 'Prescriptions',
};

// Loading skeleton for initial auth
function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm font-bold text-gray-500">Loading FDS Hub...</p>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading: authLoading, error: authError, setError: setAuthError, login, register, logout, resetPassword } = useAuth();
  const { activeCalls, resolvedCalls, loading: callsLoading, addCall, updateCall, resolveCall, deleteCall } = useCalls(user);
  const { showToast, ToastContainer } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  // Show loading skeleton while Firebase auth initializes
  if (authLoading) {
    return <LoadingSkeleton />;
  }

  // Not authenticated — show login
  if (!user) {
    return (
      <LoginScreen
        onLogin={login}
        onRegister={register}
        onResetPassword={resetPassword}
        error={authError}
        setError={setAuthError}
      />
    );
  }

  // Authenticated — show dashboard
  const pageTitle = PAGE_TITLES[location.pathname] || 'FDS Hub';
  const pageSubtitle = location.pathname === '/'
    ? 'Real-time callbacks & call dispatch tracking'
    : 'Module overview and management';

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
      <Sidebar
        user={user}
        onLogout={logout}
        mobileOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Mobile Header */}
        <header className="bg-white border-b border-gray-200 p-4 flex items-center justify-between lg:hidden shrink-0">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 bg-gray-100 rounded-lg text-gray-700"
          >
            <Menu size={20} />
          </button>
          <h1 className="font-black text-gray-900">FDS HUB</h1>
          <div className="w-8" />
        </header>

        <div className="p-4 sm:p-6 space-y-6 max-w-[1400px] w-full mx-auto">
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-200 pb-4">
            <div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight uppercase">
                {pageTitle}
              </h2>
              <p className="text-xs text-gray-500 font-medium">{pageSubtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              {callsLoading && location.pathname === '/' && (
                <div className="flex items-center gap-2 text-xs font-bold text-gray-400 bg-white px-3 py-1.5 rounded-xl border border-gray-200">
                  <div className="w-3 h-3 border-2 border-gray-300 border-t-emerald-500 rounded-full animate-spin" />
                  Loading...
                </div>
              )}
              <div className="text-xs font-bold text-gray-500 bg-white px-3 py-1.5 rounded-xl border border-gray-200 flex items-center gap-1.5 w-fit">
                <Clock size={14} className="text-emerald-600" /> Realtime Sync Active
              </div>
            </div>
          </div>

          {/* Routes */}
          <Routes>
            <Route
              path="/"
              element={
                <LiveDispatch
                  user={user}
                  activeCalls={activeCalls}
                  resolvedCalls={resolvedCalls}
                  addCall={addCall}
                  updateCall={updateCall}
                  resolveCall={resolveCall}
                  deleteCall={deleteCall}
                  onToast={showToast}
                />
              }
            />
            <Route path="/financials" element={<PlaceholderPage title="Financials & Payroll" />} />
            <Route path="/billing" element={<PlaceholderPage title="Billing Center" />} />
            <Route path="/clinical" element={<PlaceholderPage title="Clinical Center" />} />
            <Route path="/hygiene" element={<PlaceholderPage title="Hygiene Center" />} />
            <Route path="/prescriptions" element={<PlaceholderPage title="Prescriptions" />} />
          </Routes>
        </div>
      </div>

      {/* Toast Notifications */}
      {ToastContainer}
    </div>
  );
}