import React, { useEffect, useState } from 'react';
import { 
  UserPlus, 
  Users, 
  RefreshCw, 
  X, 
  Shield, 
  CheckCircle2, 
  Ban, 
  Trash2, 
  Edit, 
  Layers, 
  Check, 
  Plus 
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate } from '../lib/utils.js';
import type { 
  UserDto, 
  GroupDto, 
  CreateUserRequest, 
  UpdateUserRequest 
} from '@bills-master/shared-types';

export const AdminUsersPage: React.FC = () => {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDto | null>(null);

  // Create Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Edit Form State
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editGroupIds, setEditGroupIds] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, groupsRes] = await Promise.all([
        api.get<{ users: UserDto[] }>('/api/admin/users'),
        api.get<{ groups: GroupDto[] }>('/api/admin/groups'),
      ]);
      setUsers(usersRes.users);
      setGroups(groupsRes.groups);
    } catch (err) {
      console.error('Błąd podczas ładowania danych użytkowników:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreateModal = () => {
    setName('');
    setEmail('');
    setPassword('');
    setSelectedGroupIds([]);
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const openEditModal = (user: UserDto) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditPassword('');
    setEditGroupIds(user.groups ? user.groups.map((g) => g.id) : []);
    setEditError(null);
  };

  const toggleCreateGroup = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const toggleEditGroup = (groupId: string) => {
    setEditGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const handleToggleStatus = async (user: UserDto) => {
    if (user.role === 'ADMIN') return;
    try {
      await api.patch(`/api/admin/users/${user.id}`, { isActive: !user.isActive });
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Nie udało się zaktualizować statusu użytkownika');
    }
  };

  const handleDeleteUser = async (user: UserDto) => {
    if (user.role === 'ADMIN') return;
    if (!confirm(`Czy na pewno chcesz usunąć użytkownika "${user.name}" (${user.email})? Spowoduje to usunięcie powiązanych danych.`)) {
      return;
    }
    try {
      await api.delete(`/api/admin/users/${user.id}`);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Nie udało się usunąć użytkownika');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSubmitting(true);
    try {
      const payload: CreateUserRequest = {
        name,
        email,
        password,
        role: 'USER',
        groupIds: selectedGroupIds,
      };
      await api.post('/api/admin/users', payload);
      setIsCreateModalOpen(false);
      await fetchData();
    } catch (err: any) {
      setFormError(err.message || 'Nie udało się utworzyć konta użytkownika');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditError(null);
    setEditSubmitting(true);
    try {
      const payload: UpdateUserRequest = {
        name: editName,
        email: editEmail,
        groupIds: editGroupIds,
      };
      if (editPassword.trim()) {
        payload.password = editPassword.trim();
      }
      await api.patch(`/api/admin/users/${editingUser.id}`, payload);
      setEditingUser(null);
      await fetchData();
    } catch (err: any) {
      setEditError(err.message || 'Nie udało się zaktualizować użytkownika');
    } finally {
      setEditSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Konta Użytkowników</h1>
          <p className="text-sm text-slate-400">
            Administracja systemem: Twórz konta dla domowników i przypisuj ich do odpowiednich lokali i grup.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>Dodaj użytkownika</span>
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
            <p className="text-sm text-slate-400 mt-2 font-medium">Wczytywanie listy użytkowników...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/90 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-xs">
                <tr>
                  <th className="px-5 py-3.5">Imię i nazwisko</th>
                  <th className="px-5 py-3.5">Adres e-mail</th>
                  <th className="px-5 py-3.5">Rola</th>
                  <th className="px-5 py-3.5">Przypisane grupy / lokale</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Utworzono</th>
                  <th className="px-5 py-3.5 text-right">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-4 font-bold text-white">{u.name}</td>
                    <td className="px-5 py-4 text-slate-300 font-mono text-xs sm:text-sm">{u.email}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          u.role === 'ADMIN'
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {u.role === 'ADMIN' && <Shield className="w-3.5 h-3.5" />}
                        <span>{u.role === 'ADMIN' ? 'Administrator' : 'Użytkownik'}</span>
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {u.role === 'ADMIN' ? (
                        <span className="text-xs text-slate-500 italic">Dostęp globalny (Administrator)</span>
                      ) : (!u.groups || u.groups.length === 0) ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Brak przypisanych grup
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.groups.map((g) => (
                            <span
                              key={g.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-950/50 border border-indigo-800/40 text-indigo-300 text-xs font-medium"
                            >
                              <Layers className="w-3 h-3 text-indigo-400" />
                              <span>{g.name}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          u.isActive
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-red-500/15 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {u.isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                        <span>{u.isActive ? 'Aktywny' : 'Zablokowany'}</span>
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-400 text-xs">{formatDate(u.createdAt)}</td>
                    <td className="px-5 py-4 text-right">
                      {u.role === 'ADMIN' ? (
                        <span className="text-xs text-indigo-400/80 font-medium px-2 py-1 bg-indigo-950/40 rounded-lg border border-indigo-900/40">
                          Główny Admin
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(u)}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                            title="Edytuj użytkownika"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(u)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              u.isActive
                                ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                            }`}
                          >
                            {u.isActive ? 'Zablokuj' : 'Odblokuj'}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                            title="Usuń użytkownika"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create User Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative my-8">
            <button
              onClick={() => setIsCreateModalOpen(false)}
              className="absolute right-5 top-5 p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Nowy Użytkownik</h3>
                <p className="text-xs text-slate-300">Użytkownik zobaczy tylko rachunki ze swoich grup.</p>
              </div>
            </div>

            {formError && (
              <div className="mb-4 p-3.5 bg-rose-950/60 border border-rose-600/60 rounded-xl text-rose-200 text-sm font-semibold">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">Imię i nazwisko</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Jan Kowalski"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">Adres e-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jan.kowalski@poczta.pl"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">Hasło startowe</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 znaków"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Group Assignment */}
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">
                  Przypisz do grup / lokali
                </label>
                <p className="text-xs text-slate-400 mb-2">
                  Dostawcy przypisani do tych grup będą widoczni na koncie tego użytkownika.
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                  {groups.length === 0 ? (
                    <div className="text-xs text-slate-400 italic">Brak grup. Najpierw utwórz grupę w zakładce Grupy.</div>
                  ) : (
                    groups.map((g) => {
                      const isSelected = selectedGroupIds.includes(g.id);
                      return (
                        <div
                          key={g.id}
                          onClick={() => toggleCreateGroup(g.id)}
                          className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-indigo-950/60 border-indigo-700 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                                isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-700'
                              }`}
                            >
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>
                            <span className="text-sm font-bold text-white">{g.name}</span>
                          </div>
                          <span className="text-xs text-slate-400">
                            {g.portals?.length || 0} dostawców
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={formSubmitting}
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                <UserPlus className="w-5 h-5" />
                <span>{formSubmitting ? 'Tworzenie konta...' : 'Utwórz konto użytkownika'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative my-8">
            <button
              onClick={() => setEditingUser(null)}
              className="absolute right-5 top-5 p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                <Edit className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Edycja Użytkownika</h3>
                <p className="text-xs text-slate-300">{editingUser.email}</p>
              </div>
            </div>

            {editError && (
              <div className="mb-4 p-3.5 bg-rose-950/60 border border-rose-600/60 rounded-xl text-rose-200 text-sm font-semibold">
                {editError}
              </div>
            )}

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">Imię i nazwisko</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">Adres e-mail</label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">
                  Zmień hasło (opcjonalnie)
                </label>
                <input
                  type="password"
                  minLength={8}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Pozostaw puste, aby nie zmieniać"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Group Assignment */}
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">
                  Przypisane grupy / lokale
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                  {groups.length === 0 ? (
                    <div className="text-xs text-slate-400 italic">Brak grup w systemie.</div>
                  ) : (
                    groups.map((g) => {
                      const isSelected = editGroupIds.includes(g.id);
                      return (
                        <div
                          key={g.id}
                          onClick={() => toggleEditGroup(g.id)}
                          className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-indigo-950/60 border-indigo-700 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                                isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-700'
                              }`}
                            >
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>
                            <span className="text-sm font-bold text-white">{g.name}</span>
                          </div>
                          <span className="text-xs text-slate-400">
                            {g.portals?.length || 0} dostawców
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={editSubmitting}
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                <Plus className="w-5 h-5" />
                <span>{editSubmitting ? 'Zapisywanie...' : 'Zapisz zmiany użytkownika'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
