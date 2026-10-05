import React, { useState } from 'react';
import { LogIn, Lock, Mail, Zap, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export const LoginPage: React.FC = () => {
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login({ email, password });
    } catch (err: any) {
      setError(err.message || 'Nieprawidłowy adres e-mail lub hasło. Spróbuj ponownie.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-lg w-full">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="w-18 h-18 sm:w-20 sm:h-20 rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center mx-auto mb-5 text-white shadow-2xl shadow-blue-500/30">
            <Zap className="w-10 h-10 sm:w-12 sm:h-12" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Bills<span className="text-blue-400">Master</span>
          </h1>
          <p className="text-base sm:text-lg text-slate-300 mt-2 font-medium">
            Wygodne i bezpieczne zarządzanie rachunkami domowymi
          </p>
        </div>

        {/* Login Box */}
        <div className="bg-slate-900/90 border-2 border-slate-800 rounded-3xl p-6 sm:p-10 backdrop-blur-xl shadow-2xl">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white mb-1">Logowanie do konta</h2>
            <p className="text-sm text-slate-300">Wprowadź swój login i hasło, aby zobaczyć swoje rachunki.</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-rose-950/60 border-2 border-rose-600/80 rounded-2xl text-rose-200 text-base font-bold shadow-md">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-base font-bold text-slate-200 mb-2">
                Adres e-mail
              </label>
              <div className="relative">
                <Mail className="w-6 h-6 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="np. jan.kowalski@poczta.pl"
                  className="w-full bg-slate-950 border-2 border-slate-800 focus:border-blue-500 rounded-2xl pl-12 sm:pl-14 pr-4 py-4 text-base sm:text-lg text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-base font-bold text-slate-200">
                  Hasło
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs sm:text-sm text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"
                >
                  {showPassword ? (
                    <>
                      <EyeOff className="w-4 h-4" />
                      <span>Ukryj hasło</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" />
                      <span>Pokaż hasło</span>
                    </>
                  )}
                </button>
              </div>
              <div className="relative">
                <Lock className="w-6 h-6 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Wpisz swoje hasło"
                  className="w-full bg-slate-950 border-2 border-slate-800 focus:border-blue-500 rounded-2xl pl-12 sm:pl-14 pr-12 py-4 text-base sm:text-lg text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-black rounded-2xl text-lg transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-600/30 disabled:opacity-50 mt-4 cursor-pointer"
            >
              <LogIn className="w-6 h-6" />
              <span>{isLoading ? 'Logowanie...' : 'Zaloguj się'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
