import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, KeyRound, UserPlus, User } from 'lucide-react';

export default function LoginScreen({ onLogin, onRegister, onResetPassword, error, setError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'reset'
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'reset') {
        const sent = await onResetPassword(email);
        if (sent) setResetSent(true);
      } else if (mode === 'register') {
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          setLoading(false);
          return;
        }
        await onRegister(email, password, displayName.trim());
      } else {
        await onLogin(email, password);
      }
    } catch {
      // error is set in hook
    }
    setLoading(false);
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError(null);
    setResetSent(false);
    setConfirmPassword('');
    setDisplayName('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-emerald-900 flex items-center justify-center p-4">
      {/* Background Pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-emerald-600/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo Section */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="FDS Logo" className="w-20 h-20 mx-auto rounded-2xl object-contain mb-4 shadow-lg shadow-black/20" />
          <h1 className="text-3xl font-black text-white tracking-tight">FDS HUB</h1>
          <p className="text-emerald-400/80 text-sm font-bold uppercase tracking-widest mt-1">Command Center</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          <h2 className="text-lg font-black text-white mb-1">
            {mode === 'login' ? 'Staff Sign In' : mode === 'register' ? 'Create Account' : 'Reset Password'}
          </h2>
          <p className="text-sm text-gray-400 mb-6">
            {mode === 'login'
              ? 'Enter your credentials to access the operations hub.'
              : mode === 'register'
                ? 'Create a new staff account to get started.'
                : 'We\'ll send a password reset link to your email.'}
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/15 border border-red-500/30 rounded-xl">
              <p className="text-sm text-red-300 font-medium">{error}</p>
            </div>
          )}

          {resetSent && (
            <div className="mb-4 p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl">
              <p className="text-sm text-emerald-300 font-medium">
                Password reset email sent! Check your inbox.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Display Name — register only */}
            {mode === 'register' && (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                  Your Name
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    required
                    maxLength={50}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:border-emerald-500/50 focus:bg-white/8 transition-colors"
                    placeholder="Jeanette Markel"
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:border-emerald-500/50 focus:bg-white/8 transition-colors"
                  placeholder="you@fdsdental.com"
                />
              </div>
            </div>

            {/* Password — login + register */}
            {mode !== 'reset' && (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:border-emerald-500/50 focus:bg-white/8 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            )}

            {/* Confirm Password — register only */}
            {mode === 'register' && (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 outline-none focus:border-emerald-500/50 focus:bg-white/8 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : mode === 'login' ? (
                <>Sign In <ArrowRight size={16} /></>
              ) : mode === 'register' ? (
                <>Create Account <UserPlus size={16} /></>
              ) : (
                <>Send Reset Link <KeyRound size={16} /></>
              )}
            </button>
          </form>

          <div className="mt-6 space-y-2 text-center">
            {mode === 'login' ? (
              <>
                <button
                  onClick={() => switchMode('register')}
                  className="block w-full text-xs text-emerald-400 hover:text-emerald-300 font-semibold transition-colors"
                >
                  Don't have an account? Create one
                </button>
                <button
                  onClick={() => switchMode('reset')}
                  className="block w-full text-xs text-gray-400 hover:text-emerald-400 font-medium transition-colors"
                >
                  Forgot your password?
                </button>
              </>
            ) : (
              <button
                onClick={() => switchMode('login')}
                className="text-xs text-gray-400 hover:text-emerald-400 font-medium transition-colors"
              >
                ← Back to Sign In
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          FDS Operations Hub &middot; Authorized Staff Only
        </p>
      </div>
    </div>
  );
}
