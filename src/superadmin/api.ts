/**
 * Super Admin API client. Plain `fetch` on the platform host (`/api/super-admin/*`), session in an HttpOnly cookie that the server only
 * accepts for this API. It deliberately does not use the tenant `api()` helper: that one adds tenant prefixes and tenant tokens.
 */
export class SaError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export async function sa<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/super-admin${path}`, {
      method: options.method || 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch { throw new SaError(0, 'NETWORK'); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new SaError(response.status, (body && body.error) || `HTTP_${response.status}`);
  return body as T;
}
const MESSAGES: Record<string, string> = {
  'Invalid credentials': 'Wrong e-mail or password.', 'Too many attempts': 'Too many attempts. Wait 15 minutes.', NETWORK: 'The server cannot be reached.',
  SLUG_RESERVED: 'This address is reserved.', SLUG_TAKEN: 'This address is already used.', SLUG_RETIRED: 'This address was used recently and is on hold for 30 days.',
  INVALID_SLUG: 'Use 3 to 40 lowercase letters, digits and single hyphens.', INVALID_EMAIL: 'Enter a valid e-mail address.', INVALID_NAME: 'The name is too short.',
  WEAK_PASSWORD: 'Password too weak (8+ characters, not a common one, not "superadmin").', ADMIN_EXISTS: 'This administrator already exists here.', EMAIL_TAKEN: 'This e-mail is already used here.',
  CONFIRM_SLUG: 'Type the exact address to confirm.', DEFAULT_TENANT_PROTECTED: 'The default tenant cannot be changed this way.', USE_DEMO_DELETE: 'Delete demos from the Demos section.',
  DEMO_PROTECTED: 'Demo templates cannot be changed from a request.', NOTHING_TO_APPLY: 'Nothing to apply.', DOMAIN_NOT_VERIFIED: 'The DNS record was not found yet.',
  DOMAIN_TAKEN: 'This domain already belongs to another tenant.', DOMAIN_RESERVED: 'This domain cannot be used.', INVALID_DOMAIN: 'Enter a valid domain.', TOO_MANY_DOMAINS: 'Three domains at most.',
  WRONG_CURRENT_PASSWORD: 'The current password is not correct.', INVALID_LOGIN: 'Use 3 to 190 characters: letters, digits and . _ @ + - (an e-mail address works).',
  SAME_PASSWORD: 'The new password must be different from the current one.', NOTHING_TO_CHANGE: 'Nothing to change.', ACCOUNT_DISABLED: 'This account is disabled.',
  OWNER_EMAIL_REQUIRED: 'The chosen administrator has no valid e-mail.', NOT_FOUND: 'Not found.',
};
export const saMessage = (error: unknown) => (error instanceof SaError ? (MESSAGES[error.code] || error.code) : 'Something went wrong.');
