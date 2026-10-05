import React, { useEffect, useState } from 'react';
import { 
  FolderPlus, 
  Layers, 
  RefreshCw, 
  X, 
  Trash2, 
  Edit, 
  Users, 
  Landmark, 
  Check, 
  Zap, 
  Plus 
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate } from '../lib/utils.js';
import type { 
  GroupDto, 
  PortalDto, 
  UserDto, 
  CreateGroupRequest, 
  UpdateGroupRequest 
} from '@bills-master/shared-types';

export const AdminGroupsPage: React.FC = () => {
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [allPortals, setAllPortals] = useState<PortalDto[]>([]);
  const [allUsers, setAllUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupDto | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPortalIds, setSelectedPortalIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [groupsRes, portalsRes, usersRes] = await Promise.all([
        api.get<{ groups: GroupDto[] }>('/api/admin/groups'),
        api.get<{ portals: PortalDto[] }>('/api/admin/portals'),
        api.get<{ users: UserDto[] }>('/api/admin/users'),
      ]);
      setGroups(groupsRes.groups);
      setAllPortals(portalsRes.portals);
      setAllUsers(usersRes.users.filter((u) => u.role !== 'ADMIN'));
    } catch (err) {
      console.error('Błąd podczas pobierania grup:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreateModal = () => {
    setEditingGroup(null);
    setName('');
    setDescription('');
    setSelectedPortalIds([]);
    setSelectedUserIds([]);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (group: GroupDto) => {
    setEditingGroup(group);
    setName(group.name);
    setDescription(group.description || '');
    setSelectedPortalIds(group.portals.map((p) => p.id));
    setSelectedUserIds(group.users ? group.users.map((u) => u.id) : []);
    setFormError(null);
    setIsModalOpen(true);
  };

  const togglePortal = (portalId: string) => {
    setSelectedPortalIds((prev) =>
      prev.includes(portalId) ? prev.filter((id) => id !== portalId) : [...prev, portalId]
    );
  };

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleDeleteGroup = async (group: GroupDto) => {
    if (!confirm(`Czy na pewno chcesz usunąć grupę "${group.name}"? Użytkownicy przypisani do tej grupy stracą dostęp do jej portali.`)) {
      return;
    }

    try {
      await api.delete(`/api/admin/groups/${group.id}`);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Nie udało się usunąć grupy');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSubmitting(true);

    try {
      if (editingGroup) {
        const payload: UpdateGroupRequest = {
          name,
          description: description || undefined,
          portalIds: selectedPortalIds,
          userIds: selectedUserIds,
        };
        await api.patch(`/api/admin/groups/${editingGroup.id}`, payload);
      } else {
        const payload: CreateGroupRequest = {
          name,
          description: description || undefined,
          portalIds: selectedPortalIds,
          userIds: selectedUserIds,
        };
        await api.post('/api/admin/groups', payload);
      }
      setIsModalOpen(false);
      await fetchData();
    } catch (err: any) {
      setFormError(err.message || 'Nie udało się zapisać grupy');
    } finally {
      setFormSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Grupy i Lokale</h1>
          <p className="text-sm text-slate-400">
            Definiuj lokale mieszkalne (np. Mieszkanie, Dom) i przypisuj do nich dostawców mediów oraz domowników.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20"
        >
          <FolderPlus className="w-4 h-4" />
          <span>Dodaj nową grupę</span>
        </button>
      </div>

      {/* Groups List */}
      {loading ? (
        <div className="py-16 text-center bg-slate-900/60 border border-slate-800 rounded-2xl">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
          <p className="text-sm text-slate-400 mt-2 font-medium">Wczytywanie grup...</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 px-4 border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
          <div className="w-12 h-12 rounded-xl bg-indigo-600/10 text-indigo-400 flex items-center justify-center mx-auto mb-3">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-white">Nie utworzono jeszcze żadnych grup</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
            Grupy łączą dostawców z użytkownikami (np. «Mieszkanie Centrum», «Działka»).
          </p>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors shadow-lg shadow-indigo-600/20"
          >
            Utwórz pierwszą grupę
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {groups.map((group) => (
            <div
              key={group.id}
              className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">{group.name}</h3>
                      {group.description && (
                        <p className="text-xs text-slate-400 mt-0.5">{group.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(group)}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                      title="Edytuj grupę"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                      title="Usuń grupę"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Portals Section */}
                <div className="mt-4 pt-3 border-t border-slate-800/80">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                    <Landmark className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Przypisani dostawcy mediów ({group.portals.length})</span>
                  </div>
                  {group.portals.length === 0 ? (
                    <div className="text-xs text-slate-500 italic">Brak przypisanych portali dostawców.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {group.portals.map((p) => (
                        <span
                          key={p.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-300 text-xs font-medium"
                        >
                          <Zap className="w-3 h-3 text-indigo-400" />
                          <span>{p.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Users Section */}
                <div className="mt-3 pt-3 border-t border-slate-800/80">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Członkowie / Użytkownicy ({group.users?.length || 0})</span>
                  </div>
                  {(!group.users || group.users.length === 0) ? (
                    <div className="text-xs text-slate-500 italic">Brak przypisanych użytkowników.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {group.users.map((u) => (
                        <span
                          key={u.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-300 text-xs font-medium"
                        >
                          <span>{u.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500">
                Utworzono: {formatDate(group.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative my-8">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute right-5 top-5 p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">
                  {editingGroup ? 'Edycja Grupy' : 'Nowa Grupa / Lokal'}
                </h3>
                <p className="text-xs text-slate-300">
                  Połącz dostawców z użytkownikami, którzy powinni widzieć rachunki.
                </p>
              </div>
            </div>

            {formError && (
              <div className="mb-4 p-3.5 bg-rose-950/60 border border-rose-600/60 rounded-xl text-rose-200 text-sm font-semibold">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">
                  Nazwa grupy / lokalu
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Mieszkanie Lipowa 5"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1.5">
                  Opis (opcjonalnie)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="np. Główne mieszkanie rodziców"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Portals Selection */}
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">
                  Wybierz dostawców dla tej grupy
                </label>
                <p className="text-xs text-slate-400 mb-2">
                  Zaznacz liczniki i portale należące do tego lokalu.
                </p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                  {allPortals.length === 0 ? (
                    <div className="text-xs text-slate-400 italic">Brak dostawców. Dodaj dostawców w zakładce Dostawcy.</div>
                  ) : (
                    allPortals.map((p) => {
                      const isSelected = selectedPortalIds.includes(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => togglePortal(p.id)}
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
                            <span className="text-sm font-bold text-white">{p.name}</span>
                          </div>
                          <span className="text-xs text-slate-400">{p.providerName}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Users Selection */}
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">
                  Przypisz domowników / użytkowników
                </label>
                <p className="text-xs text-slate-400 mb-2">
                  Wybrani użytkownicy będą mieli wgląd w rachunki tej grupy.
                </p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                  {allUsers.length === 0 ? (
                    <div className="text-xs text-slate-400 italic">Brak użytkowników. Utwórz użytkowników w zakładce Użytkownicy.</div>
                  ) : (
                    allUsers.map((u) => {
                      const isSelected = selectedUserIds.includes(u.id);
                      return (
                        <div
                          key={u.id}
                          onClick={() => toggleUser(u.id)}
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
                            <span className="text-sm font-bold text-white">{u.name}</span>
                          </div>
                          <span className="text-xs text-slate-400 font-mono">{u.email}</span>
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
                <Plus className="w-5 h-5" />
                <span>{formSubmitting ? 'Zapisywanie...' : 'Zapisz grupę'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
