import React, { useState, useEffect, useRef } from 'react';
import { 
  Landmark, 
  Users, 
  Layers, 
  LogOut, 
  RefreshCw, 
  Zap, 
  Shield,
  Type,
  MoreVertical,
  FileText,
  Sun,
  Moon,
  Mail
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useTheme } from '../../context/ThemeContext.js';
import { InstallPwaButton } from '../pwa/InstallPwaButton.js';
import type { ActiveSyncState } from '../../hooks/useSyncStream.js';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  activeSync: ActiveSyncState | null;
  onManualSyncAll: () => void;
  isSyncing: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  activeSync,
  onManualSyncAll,
  isSyncing,
}) => {
  const { user, logout } = useAuth();
  const { toggleTheme, isLight } = useTheme();
  const isAdmin = user?.role === 'ADMIN';

  // 3-dots dropdown menu state
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Senior accessibility: large font toggle with persistent local storage
  const [isLargeText, setIsLargeText] = useState<boolean>(() => {
    return localStorage.getItem('bm_senior_text') === 'true';
  });

  useEffect(() => {
    if (isLargeText) {
      document.documentElement.classList.add('senior-text-large');
      localStorage.setItem('bm_senior_text', 'true');
    } else {
      document.documentElement.classList.remove('senior-text-large');
      localStorage.setItem('bm_senior_text', 'false');
    }
  }, [isLargeText]);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const toggleTextSize = () => {
    setIsLargeText((prev) => !prev);
    setIsMenuOpen(false);
  };

  const handleToggleTheme = () => {
    toggleTheme();
    setIsMenuOpen(false);
  };

  const handleToggleTab = (tab: string) => {
    setCurrentTab(tab);
    setIsMenuOpen(false);
  };

  const handleSyncClick = () => {
    onManualSyncAll();
    setIsMenuOpen(false);
  };

  const handleLogout = () => {
    setIsMenuOpen(false);
    logout();
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between min-h-[4.5rem] py-2">
          {/* Logo & Brand */}
          <button
            onClick={() => setCurrentTab(isAdmin ? 'users' : 'bills')}
            className="flex items-center gap-3 text-left hover:opacity-90 transition-opacity focus:outline-none py-1"
            title="Przejdź do strony głównej"
          >
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/25 shrink-0">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-1">
                Bills<span className="text-blue-400">Master</span>
              </span>
              <span className="text-xs sm:text-sm text-slate-300 font-medium block">
                {isAdmin ? (
                  <span className="text-indigo-400 flex items-center gap-1 font-semibold">
                    <Shield className="w-3.5 h-3.5" /> Panel Administratora
                  </span>
                ) : (
                  'Moje Rachunki i Opłaty'
                )}
              </span>
            </div>
          </button>

          {/* Desktop Navigation Links - ADMIN ONLY */}
          {isAdmin && (
            <nav className="hidden md:flex items-center gap-2">
              <button
                onClick={() => setCurrentTab('users')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  currentTab === 'users'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Użytkownicy</span>
              </button>

              <button
                onClick={() => setCurrentTab('groups')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  currentTab === 'groups'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Grupy i Lokale</span>
              </button>

              <button
                onClick={() => setCurrentTab('portals')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  currentTab === 'portals'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Landmark className="w-4 h-4" />
                <span>Dostawcy mediów</span>
              </button>
            </nav>
          )}

          {/* Right Actions: PWA Install + 3-dots Dropdown Menu */}
          <div className="flex items-center gap-2 sm:gap-3">
            <InstallPwaButton />

            {/* 3-dots Menu Container */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className={`p-3 rounded-2xl border transition-all flex items-center justify-center ${
                  isMenuOpen
                    ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 hover:border-slate-600'
                }`}
                title="Więcej opcji"
                aria-label="Menu opcji"
                aria-expanded={isMenuOpen}
              >
                <MoreVertical className="w-6 h-6" />
              </button>

              {/* Dropdown Menu Panel */}
              {isMenuOpen && (
                <div className="absolute right-0 mt-3 w-72 sm:w-80 bg-slate-900 border-2 border-slate-700 rounded-3xl shadow-2xl z-50 overflow-hidden backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
                  {/* User Header in Menu */}
                  <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/60">
                    <div className="text-base font-bold text-white leading-tight truncate">
                      {user?.name}
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5 truncate">
                      {user?.email}
                    </div>
                  </div>

                  <div className="p-2.5 space-y-1">
                    {/* Standard User: Dostawcy Button */}
                    {!isAdmin && (
                      <button
                        onClick={() => handleToggleTab(currentTab === 'accounts' ? 'bills' : 'accounts')}
                        className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-base font-bold text-slate-200 hover:text-white hover:bg-slate-800 transition-colors text-left"
                      >
                        {currentTab === 'accounts' ? (
                          <>
                            <FileText className="w-5 h-5 text-blue-400 shrink-0" />
                            <span>Wróć do rachunków</span>
                          </>
                        ) : (
                          <>
                            <Landmark className="w-5 h-5 text-blue-400 shrink-0" />
                            <span>Dostawcy i Liczniki</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* Admin: Skrypt poczty Google Script */}
                    {isAdmin && (
                      <button
                        onClick={() => handleToggleTab('mail-script')}
                        className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-base font-bold transition-colors text-left ${
                          currentTab === 'mail-script'
                            ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/30'
                            : 'text-indigo-400 hover:text-indigo-300 hover:bg-slate-800'
                        }`}
                      >
                        <Mail className="w-5 h-5 shrink-0 text-indigo-400" />
                        <span>Skrypt poczty Google (Apps Script)</span>
                      </button>
                    )}

                    {/* Refresh / Sync Button */}
                    <button
                      onClick={handleSyncClick}
                      disabled={isSyncing || (!isAdmin && Boolean(activeSync))}
                      className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-base font-bold text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 transition-colors text-left disabled:opacity-50"
                    >
                      <RefreshCw className={`w-5 h-5 shrink-0 ${isSyncing || (!isAdmin && activeSync) ? 'animate-spin' : ''}`} />
                      <span>
                        {isSyncing || (!isAdmin && activeSync)
                          ? 'Pobieranie w toku...'
                          : isAdmin
                          ? 'Odśwież rachunki (wszystkie portale)'
                          : 'Odśwież rachunki'}
                      </span>
                    </button>

                    {/* Theme Toggle Button (Light / Dark) */}
                    <button
                      onClick={handleToggleTheme}
                      className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-base font-bold text-amber-300 hover:text-amber-200 hover:bg-slate-800 transition-colors text-left"
                      title={isLight ? 'Przełącz na motyw ciemny' : 'Przełącz na motyw jasny'}
                    >
                      {isLight ? (
                        <>
                          <Moon className="w-5 h-5 shrink-0 text-indigo-400" />
                          <span>Motyw: Ciemny</span>
                        </>
                      ) : (
                        <>
                          <Sun className="w-5 h-5 shrink-0 text-amber-400" />
                          <span>Motyw: Jasny</span>
                        </>
                      )}
                    </button>

                    {/* Text Size Accessibility Toggle */}
                    <button
                      onClick={toggleTextSize}
                      className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-base font-bold text-sky-300 hover:text-sky-200 hover:bg-slate-800 transition-colors text-left"
                    >
                      <Type className="w-5 h-5 shrink-0 text-sky-400" />
                      <span>{isLargeText ? 'Zmniejsz tekst (standardowy)' : 'Powiększ tekst (duży)'}</span>
                    </button>

                    {/* Log off button */}
                    <div className="pt-1.5 border-t border-slate-800/80">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-base font-bold text-rose-300 hover:text-white hover:bg-rose-950/60 transition-colors text-left"
                      >
                        <LogOut className="w-5 h-5 shrink-0 text-rose-400" />
                        <span>Wyloguj się</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Navigation Bar - ADMIN ONLY */}
        {isAdmin && (
          <div className="flex md:hidden border-t border-slate-800 py-2.5 justify-around gap-2">
            <button
              onClick={() => setCurrentTab('users')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                currentTab === 'users' ? 'bg-indigo-600 text-white' : 'text-slate-300'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Użytkownicy</span>
            </button>
            <button
              onClick={() => setCurrentTab('groups')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                currentTab === 'groups' ? 'bg-indigo-600 text-white' : 'text-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Grupy</span>
            </button>
            <button
              onClick={() => setCurrentTab('portals')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                currentTab === 'portals' ? 'bg-indigo-600 text-white' : 'text-slate-300'
              }`}
            >
              <Landmark className="w-3.5 h-3.5" />
              <span>Dostawcy</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
