import { create } from 'zustand';
import { api, backendEnabled } from '@/lib/backend';
import type { AdminAccess } from '@/lib/access';

/** The signed-in administrator's own account (see server/admins.js). `credits: null` = unlimited. */
export interface AdminProfile {
  id: string; username: string; name: string; email: string; phone: string; title: string; avatar: string;
  credits: number | null; createdAt?: number; lastLoginAt?: number | null; passwordChangedAt?: number | null; defaultPassword?: boolean;
}
export interface AdminDevice { id: string; current: boolean; createdAt?: number | null; lastSeen?: number | null; ua?: string }

interface State {
  profile: AdminProfile | null;
  /** What the Super Admin allows this administrator (role + page access); null until the session answered. */
  access: AdminAccess | null;
  setAccess(a: AdminAccess | null | undefined): void;
  hydrate(p: AdminProfile | null | undefined): void;
  clear(): void;
  save(patch: Partial<Pick<AdminProfile, 'name' | 'email' | 'phone' | 'title' | 'avatar' | 'credits'>>): Promise<AdminProfile>;
}
export const useAdminProfile = create<State>((set) => ({
  profile: null,
  access: null,
  setAccess: (access) => set({ access: access ?? null }),
  hydrate: (profile) => set({ profile: profile ?? null }),
  clear: () => set({ profile: null, access: null }),
  async save(patch) {
    const profile = await api<AdminProfile>('/admin/account', { method: 'PATCH', body: patch });
    set({ profile });
    return profile;
  },
}));

export const changeAdminPassword = (current: string, next: string) =>
  api<{ ok: true }>('/admin/account/password', { method: 'POST', body: { current, next } }).then(async (r) => {
    await refreshProfile();
    return r;
  });
export const listAdminDevices = () => api<{ sessions: AdminDevice[] }>('/admin/account/sessions').then((r) => r.sessions);
export const revokeAdminDevice = (id: string) => api<{ ok: true }>(`/admin/account/sessions/${id}`, { method: 'DELETE' });
export const revokeOtherAdminDevices = () => api<{ ok: true }>('/admin/account/sessions', { method: 'DELETE' });
export async function refreshProfile() {
  if (!backendEnabled) return;
  try { useAdminProfile.getState().hydrate(await api<AdminProfile>('/admin/account')); } catch { /* keeps the last known profile */ }
}
/** Display name: the profile name, else the generic role label supplied by the caller. */
export const adminDisplayName = (p: AdminProfile | null, fallback: string) => (p?.name || '').trim() || fallback;
