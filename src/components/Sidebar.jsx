import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Receipt, DollarSign, Stethoscope,
  FileText, Activity, LogOut, X,
} from 'lucide-react';
import ThemeSelector from './ThemeSelector';

const mainLinks = [
  { to: '/', icon: LayoutDashboard, label: 'Live Dispatch', size: 'main' },
  { to: '/financials', icon: Receipt, label: 'Financials & Payroll', size: 'main' },
];

const centerLinks = [
  { to: '/billing', icon: DollarSign, label: 'Billing Center' },
  { to: '/clinical', icon: Stethoscope, label: 'Clinical Center' },
  { to: '/hygiene', icon: FileText, label: 'Hygiene Center' },
  { to: '/prescriptions', icon: Activity, label: 'Prescriptions' },
];

export default function Sidebar({ user, onLogout, mobileOpen, onClose }) {
  const userInitial = user?.displayName?.[0] || user?.email?.[0]?.toUpperCase() || '?';
  const userName = user?.displayName || user?.email?.split('@')[0] || 'Staff';

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-gray-900/40 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 lg:static flex flex-col`}
      >
        {/* Header */}
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="FDS Logo" className="w-10 h-10 rounded-lg object-contain" />
            <div>
              <h1 className="font-black text-xl text-gray-900 tracking-tight">FDS HUB</h1>
              <p className="text-xs text-primary-600 font-bold uppercase tracking-widest mt-0.5">
                Command Center
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <div className="px-4 py-2 overflow-y-auto flex-1 space-y-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 px-3 mb-2">
              Main Applications
            </p>
            <div className="space-y-1">
              {mainLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `w-full flex items-center gap-3 p-3 rounded-xl font-bold text-sm transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  <link.icon size={18} />
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 px-3 mb-2">
              Centers
            </p>
            <div className="space-y-1">
              {centerLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`
                  }
                >
                  <link.icon size={16} />
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-gray-100 space-y-2">
          <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-primary-100 text-primary-800 font-black flex items-center justify-center text-xs">
              {userInitial}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-gray-800 truncate">{userName}</div>
              <div className="text-[10px] text-primary-600 font-bold uppercase">Staff</div>
            </div>
          </div>
          <ThemeSelector />
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 p-2 rounded-xl text-xs font-bold text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors border border-gray-200 hover:border-red-200"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}
