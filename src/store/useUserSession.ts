import { create } from 'zustand';
import { Platform } from 'react-native';
import type { AppUser, UserPrefs } from '@/data/types';
import { t } from 'i18next';
import { api, backendEnabled, BackendError } from '@/lib/backend';
import { toast } from '@/store/useToast';
import { usePrefs } from '@/store/usePrefs';
import { inAdminArea } from '@/lib/route';
import { clientTenant } from '@/lib/tenantLink';

/** User authentication never touches useLocal.adminSession or its secure-store key. */
export const useUserSession = create<{
  user: AppUser | null;
  refresh(): Promise<void>;
  login(name: string, phone: string): Promise<AppUser>;
  logout(): Promise<void>;
}>((set, get) => ({
  user: null,
  async refresh() {
    if (!backendEnabled) return;
    try {
      const session = await api<{ user: AppUser; prefs?: UserPrefs }>('/user/session');
      set({ user: session.user });
      usePrefs.getState().hydrate('client', session.prefs ?? {});
    }
    catch (error) {
      if (error instanceof BackendError && error.status === 401) { set({ user: null }); usePrefs.getState().clear('client'); }
      // The admin blocked this account: sign out locally so nothing keeps working with a dead session.
      else if (error instanceof BackendError && error.code === 'ACCOUNT_BLOCKED') {
        // Tell the person once, at the moment they are signed out, and never inside the admin panel
        // (an administrator working there is not the blocked client and must not see this message).
        const wasSignedIn = !!get().user;
        set({ user: null }); usePrefs.getState().clear('client');
        if (wasSignedIn && !inAdminArea()) toast(t('account.blocked'));
      }
    }
  },
  async login(name, phone) {
    const tenant = await clientTenant(); // the company whose link opened the app (null = default workspace)
    const result = await api<{ user: AppUser; prefs?: UserPrefs; token?: string }>('/user/login', { method: 'POST', body: { name, phone, ...(tenant ? { tenant } : {}) }, client: true }); // the device token lets the server move this device's visitor chats into the account
    if (Platform.OS !== 'web' && result.token) await (await import('expo-secure-store')).setItemAsync('dwira-user-session', result.token);
    set({ user: result.user });
    usePrefs.getState().hydrate('client', result.prefs ?? {});
    return result.user;
  },
  async logout() {
    // This device stops receiving this client's notifications; best effort, the session revocation below is what matters.
    await (await import('@/lib/notifications')).releaseDevice('client').catch(() => {});
    // Do not claim success on an offline failure: the server session must be revoked.
    await api('/user/logout', { method: 'POST', body: {} });
    if (Platform.OS !== 'web') await (await import('expo-secure-store')).deleteItemAsync('dwira-user-session');
    set({ user: null });
    usePrefs.getState().clear('client');
  },
}));
