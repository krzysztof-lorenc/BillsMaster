import React, { useState } from 'react';
import { ShieldCheck, ArrowRight, Lock, Mail, User, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export const SetupAdminPage: React.FC = () => {
  const { setupAdmin, isLoading } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await setupAdmin({ name, email, password });
    } catch (err: any) {
      setError(err.message || 'Nie udało się utworzyć konta administratora');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="w-18 h-18 sm:w-20 sm:h-20 rounded-3xl bg-blue-600/20 border-2 border-blue-500/40 flex items-center justify-center mx-auto mb-4 text-blue-400 shadow-2xl shadow-blue-500/20">
            <ShieldCheck className="w-10 h-10 sm:w-12 sm:h-12" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">Witaj w BillsMaster</h1>
          <p className="text-base sm:text-lg text-slate-300 mt-2 font-medium">
            Pierwsze uruchomienie: Utwórz główne konto Administratora systemu do zarządzania użytkownikami i dostawcami.
          </p>
        </div>

        <div className="bg-slate-900/90 border-2 border-slate-800 rounded-3xl p-6 sm:p-10 backdrop-blur-xl shadow-2xl">
          {error && (
            <div className="mb-6 p-4 bg-rose-950/60 border-2 border-rose-600/80 rounded-2xl text-rose-200 text-base font-bold">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-base font-bold text-slate-200 mb-2">
                Imię i nazwisko Administratora
              </label>
              <div className="relative">
                <User className="w-6 h-6 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Jan Administrator"
                  className="w-full bg-slate-950 border-2 border-slate-800 focus:border-blue-500 rounded-2xl pl-12 sm:pl-14 pr-4 py-4 text-base sm:text-lg text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>
            </div>

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
                  placeholder="admin@twojadomena.pl"
                  className="w-full bg-slate-950 border-2 border-slate-800 focus:border-blue-500 rounded-2xl pl-12 sm:pl-14 pr-4 py-4 text-base sm:text-lg text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-base font-bold text-slate-200">
                  Hasło (minimum 8 znaków)
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs sm:text-sm text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"
                >
                  {showPassword ? (
                    <>
                      <EyeOff className="w-4 h-4" />
                      <span>Ukryj</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" />
                      <span>Pokaż</span>
                    </>
                  )}
                </button>
              </div>
              <div className="relative">
                <Lock className="w-6 h-6 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Wpisz bezpieczne hasło"
                  className="w-full bg-slate-950 border-2 border-slate-800 focus:border-blue-500 rounded-2xl pl-12 sm:pl-14 pr-12 py-4 text-base sm:text-lg text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-black rounded-2xl text-lg transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-600/30 disabled:opacity-50 mt-4 cursor-pointer"
            >
              <span>{isLoading ? 'Tworzenie administratora...' : 'Utwórz konto i rozpocznij'}</span>
              <ArrowRight className="w-6 h-6" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
