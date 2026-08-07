// -----------------------------------------------------------------------------
// App.jsx
// -----------------------------------------------------------------------------
// This is the "Root" or "Entry Point" of our React application.
// Think of this file as the traffic cop. It decides what to show the user
// based on whether they are logged in, and what URL they are currently on.
// -----------------------------------------------------------------------------
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

// ============================================================================
// LoadingSkeleton Component
// ============================================================================
// A simple, reusable loading screen shown while Firebase is checking if
// the user is logged in. This prevents the login screen from flashing for
// a split second if they are already authenticated.
function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm font-bold text-gray-500">Loading FDS Hub...</p>
      </div>
    </div>
  );
}

// ============================================================================
// Main App Component
// ============================================================================
export default function App() {
  // 1. Authentication Hook (useAuth)
  // This custom hook grabs the current user, handles the login/logout logic,
  // and tells us if Firebase is still "loading" the user state.
  const { user, loading: authLoading, error: authError, setError: setAuthError, login, register, logout, resetPassword } = useAuth();
  
  // 2. Global State for Location
  // We keep the "officeLocation" state here at the very top level so that 
  // both the Sidebar and the Dashboard can share this data.
  const [officeLocation, setOfficeLocation] = useState('glendale');

  // 3. Database Hook (useCalls)
  // This hook listens to our Firestore database in real-time. It grabs the
  // calls specific to the officeLocation we selected above.
  const { calls, activeCalls, resolvedCalls, loading: callsLoading, addCall, updateCall, resolveCall, deleteCall } = useCalls(user, officeLocation);
  
  // 4. UI State
  // Controls toast notifications (popups at the bottom) and mobile menu visibility.
  const { showToast, ToastContainer } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Gets the current URL path (e.g., '/', '/billing') so we can update the title
  const location = useLocation();

  // --------------------------------------------------------------------------
  // Condition 1: Firebase is still loading
  // --------------------------------------------------------------------------
  // We don't know if they are logged in yet, so we show the spinning wheel.
  if (authLoading) {
    return <LoadingSkeleton />;
  }

  // --------------------------------------------------------------------------
  // Condition 2: Not Authenticated
  // --------------------------------------------------------------------------
  // We know who they are, and they aren't logged in. Render the LoginScreen.
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

  // --------------------------------------------------------------------------
  // Condition 3: Authenticated (Dashboard View)
  // --------------------------------------------------------------------------
  // If the code reaches this point, `user` is not null, meaning they are logged in.
  // We can safely render the Sidebar and the main page content.
  const pageTitle = PAGE_TITLES[location.pathname] || 'FDS Hub';
  const pageSubtitle = location.pathname === '/'
    ? 'Real-time callbacks & call dispatch tracking'
    : 'Module overview and management';

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
      {/* 
        Sidebar Component 
        We pass down the user object so it can display their name and avatar,
        and we pass down the `logout` function so the Sign Out button works.
      */}
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
                  <div className="w-3 h-3 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin" />
                  Loading...
                </div>
              )}
              <div className="text-xs font-bold text-gray-500 bg-white px-3 py-1.5 rounded-xl border border-gray-200 flex items-center gap-1.5 w-fit">
                <Clock size={14} className="text-primary-600" /> Realtime Sync Active
              </div>
            </div>
          </div>

          {/* 
            React Router (Routes)
            This section acts like a TV channel changer. Depending on the URL,
            it renders a different component. If the URL is '/' (home), it renders
            the LiveDispatch component and passes down all the database functions.
          */}
          <Routes>
            <Route
              path="/"
              element={
                <LiveDispatch
                  user={user}
                  calls={calls}
                  activeCalls={activeCalls}
                  resolvedCalls={resolvedCalls}
                  addCall={addCall}
                  updateCall={updateCall}
                  resolveCall={resolveCall}
                  deleteCall={deleteCall}
                  onToast={showToast}
                  officeLocation={officeLocation}
                  setOfficeLocation={setOfficeLocation}
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