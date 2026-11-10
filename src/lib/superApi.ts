import { Platform } from 'react-native';
import { BackendError, backendEnabled } from '@/lib/backend';

/** Same host rules as `api()` in backend.ts, but for the Super Admin API (`/api/super/*`) and its own session. */
const BASE = (process.env.EXPO_PUBLIC_API_URL?.trim() || (Platform.OS === 'web' ? '/api' : '')).replace(/\/+$/, '');
const TOKEN_KEY = 'dwira-super-session';

export async function superApi<T>(path: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  if (!backendEnabled) throw new BackendError(503, 'BACKEND_UNAVAILABLE');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (Platform.OS !== 'web') {
    const { getItemAsync } = await import('expo-secure-store');
    const token = await getItemAsync(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    headers['X-Dwira-Native'] = '1';
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const transport = Platform.OS === 'web' ? fetch : (await import('expo/fetch')).fetch;
    const response = await transport(`${BASE}/super${path}`, { method: options.method || 'GET', headers, credentials: 'include', body: options.body == null ? undefined : JSON.stringify(options.body), signal: controller.signal });
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new BackendError(503, 'BACKEND_UNAVAILABLE');
    const body = await response.json().catch(() => { throw new BackendError(502, 'BACKEND_UNAVAILABLE'); });
    if (!response.ok) throw new BackendError(response.status, body.error, body);
    return body as T;
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError(503, 'BACKEND_UNAVAILABLE');
  } finally { clearTimeout(timeout); }
}

export async function saveSuperToken(token?: string) {
  if (Platform.OS === 'web') return;
  const store = await import('expo-secure-store');
  if (token) await store.setItemAsync(TOKEN_KEY, token); else await store.deleteItemAsync(TOKEN_KEY);
}

/* ---------- Types mirrored from server/platform.js and server/super.js ---------- */
export type Level = 'none' | 'view' | 'edit';
export type Levels = Record<string, Level>;
export interface Limits { maxClients: number | null; maxAdmins: number | null; monthlyDesigns: number | null; startCredits: number | null }
export interface FeatureDef { key: string; group: string; icon: string; href: string; shared?: boolean }
export interface Catalog { features: FeatureDef[]; groups: string[]; levels: Level[]; systemRoles: Role[] }
export type TenantStatus = 'active' | 'suspended';
export interface Tenant {
  id: string; slug: string; name: string; planId: string; planName: string; status: TenantStatus; createdAt: string; updatedAt: string;
  contact: { name: string; email: string; phone: string }; notes: string; overrides: Levels; limits: Limits; ownLimits?: Partial<Limits>;
  usage: { clients: number; accounts: number; activeAccounts: number; requests: number; designsThisMonth: number; lastRequestAt: string | null };
  levels?: Levels;
}
export interface Account { id: string; tenantId: string; tenantName: string; username: string; name: string; email: string; roleId: string; roleName: string; status: 'active' | 'suspended'; overrides: Levels; lastLogin: string | null; createdAt: string }
export interface Role { id: string; name: string; system: boolean; tenantId: string | null; description: string; permissions: Levels; createdAt?: string; updatedAt?: string; accounts?: number }
export interface Plan { id: string; name: string; price: number; limits: Partial<Limits>; features: Levels }
export interface PlatformConfig { maintenance: { enabled: boolean; message: string }; announcement: { enabled: boolean; text: string; level: 'info' | 'warning' | 'success' }; signupOpen: boolean; defaultPlan: string; supportEmail: string }
export interface SuperClient { id: string; name: string; whatsapp: string; credits: number; blocked: boolean; tenantId: string; createdAt: string; lastSeen: string | null }
export interface AuditEntry { id: string; at: string; actor: string; action: string; targetType: string; targetId: string; tenantId: string | null; detail: Record<string, unknown> | null }
export interface Insight { kind: 'info' | 'warning' | 'danger'; code: string; tenantId?: string; tenantName?: string; value?: number; limit?: number }
export interface Overview {
  days: number; generatedAt: string; labels: string[];
  totals: { tenants: number; activeTenants: number; suspendedTenants: number; accounts: number; activeAccounts: number; clients: number; blockedClients: number; activeClients: number; requests: number; credits: number; devices: number; sessions: number; mrr: number };
  period: { clients: number; requests: number; tenants: number; prevClients: number; prevRequests: number };
  series: { clients: number[]; requests: number[]; tenants: number[] };
  requestStatus: { pending: number; processing: number; delivered: number };
  planMix: { id: string; name: string; price: number; tenants: number }[];
  topTenants: { id: string; name: string; slug: string; planName: string; status: TenantStatus; clients: number; designs: number; accounts: number }[];
  insights: Insight[];
}
