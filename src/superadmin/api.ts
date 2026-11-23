/**
 * Super Admin API client. Plain `fetch` on the platform host (`/api/super-admin/*`), session in an HttpOnly cookie that the server only
 * accepts for this API. It deliberately does not use the tenant `api()` helper: that one adds tenant prefixes and tenant tokens.
 */
import { tr } from './i18n';

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
  DOMAIN_NOT_VERIFIED: 'The DNS record was not found yet.',
  DOMAIN_TAKEN: 'This domain already belongs to another tenant.', DOMAIN_RESERVED: 'This domain cannot be used.', INVALID_DOMAIN: 'Enter a valid domain.', TOO_MANY_DOMAINS: 'Three domains at most.',
  WRONG_CURRENT_PASSWORD: 'The current password is not correct.', INVALID_LOGIN: 'Use 3 to 190 characters: letters, digits and . _ @ + - (an e-mail address works).',
  SAME_PASSWORD: 'The new password must be different from the current one.', NOTHING_TO_CHANGE: 'Nothing to change.', ACCOUNT_DISABLED: 'This account is disabled.',
  OWNER_EMAIL_REQUIRED: 'The chosen administrator has no valid e-mail.', NOT_FOUND: 'Not found.',
  INVALID_USERNAME: 'User name: 3 to 40 letters, digits, dot, dash or underscore (no spaces, no @).', INVALID_CREDIT_LIMIT: 'Credits must be a whole number from 0 to 100 000 000, or empty for unlimited.',
  INVALID_API_MODE: 'Unknown API mode.', INVALID_API_LINKS: 'Invalid API selection.', API_NOT_FOUND: 'This API connection no longer exists.', INVALID_PROVIDER: 'Choose a provider from the list.',
  INVALID_KEY: 'The key looks wrong (12 to 300 letters, digits, dot, dash or underscore).', INVALID_URL: 'Use a public https address.', INVALID_MODEL: 'A model name is required for this provider.',
  SELECT_TENANTS: 'Choose at least one store.', TOO_MANY_TENANTS: 'Choose twelve stores at most at a time.', THEME_TOO_LARGE: 'This store has too much content to copy as a theme.',
  SOURCE_GONE: 'The store this theme came from no longer exists.', NO_ADMIN: 'This store has no active administrator.', TENANT_SUSPENDED: 'This store is suspended.', HANDOFF_INVALID: 'The sign-in link expired. Try again.',
  TOO_MANY_APIS: 'Thirty connections of one kind at most.', DEFAULT_REQUIRED: 'Choose another connection as the default instead.', INVALID_KIND: 'Unknown kind.',
  STORE_POOL_EXCEEDED: 'The clients of this store would hold more credits than its limit allows.', INVALID_LIMIT: 'This value is out of range.',
  NO_RECIPIENT: 'No e-mail address to send warnings to. Enter one above.', NO_MAIL_TRANSPORT: 'The server has no e-mail service configured yet.', EMAIL_FAILED: 'The e-mail could not be sent.',
  SELECT_FILES: 'Choose at least one file.', STORAGE_UNAVAILABLE: 'That storage is not available on this server.',
  INVALID_SOURCE: 'Unknown source.', KEY_NOT_FOUND: 'That key is no longer there.', ALREADY_ADDED: 'This key is already in the API manager.',
  MOVE_RUNNING: 'A move is already running. Wait for it to finish or stop it.', CONSOLIDATE_RUNNING: 'Files are already being moved into the media folder. Wait a moment.',
  INVALID_CURSOR: 'The list position is not valid. Reload the files.',
  INVALID_TYPE: 'Choose images, videos, audio or other files.', SELECT_OWNER: 'Choose a store, demo, theme or other owner first.',
  TOO_LARGE_FOR_DATABASE: 'This file is too large to be kept in the database.',
  INVALID_STORAGE: 'Choose Cloudflare R2 or the app folder.', R2_NOT_CONFIGURED: 'Cloudflare R2 is not configured on this server.',
  APP_STORAGE_UNAVAILABLE: 'The app folder is not usable on this host (read-only or not persistent).',
  SOURCE_MISSING: 'A file of the source could not be found.', VERIFY_FAILED: 'The copy could not be verified. Nothing was changed.',
  BACKUP_UNSUPPORTED_HOST: 'This host cannot make backups (no disk). Use the Neon and Cloudflare dashboards, or run the server on a host with a disk.',
  BACKUP_BUSY: 'A backup is already running. Wait for it to finish.', BACKUP_SERVER_BUSY: 'The server is busy with other backups. Try again in a few minutes.', JOB_NOT_FOUND: 'That backup is no longer there.', FILE_NOT_FOUND: 'The backup file is no longer there. Start a new backup.',
  VAULT_NOT_CONFIGURED: 'The backup vault is not configured on this server.', BACKUP_NOT_FOUND: 'That backup is no longer in the vault.',
  VAULT_VERIFY_FAILED: 'The saved copy did not match what was sent, so it was discarded. Nothing half-written is kept. Try again.',
  BACKUP_KEY_MISSING: 'This backup is encrypted and the server has no valid encryption key.', BACKUP_DECRYPT_FAILED: 'The backup could not be decrypted: wrong key or damaged file.',
  BACKUP_NOT_ENCRYPTED: 'This file is not an encrypted backup.', BACKUP_HASH_MISMATCH: 'The backup is damaged: its checksum does not match.',
  INVALID_PREVIEW: 'The screenshot is not a valid picture.', INVALID_HOUR: 'Choose an hour from 0 to 23, or automatic.', INVALID_RETENTION: 'Keep backups for 1 to 365 days.',
  VAULT_DOWNLOAD_FAILED: 'The backup could not be downloaded from the bucket.', SAFETY_BACKUP_FAILED: 'The safety copy could not be made, so nothing was restored.',
  NOT_VALIDATED: 'The backup was not checked yet.', UPLOAD_CHANGED: 'The file changed after it was checked. Start again.', NOTHING_TO_RESTORE: 'Choose at least one part to restore.',
  CONFIRMATION_REQUIRED: 'Confirm the restore first.', NOT_A_ZIP: 'This file is not a backup archive.', ARCHIVE_INVALID_DB: 'The database part of this backup is damaged.',
  ARCHIVE_NOT_A_BACKUP: 'This archive is not a backup of this app.', TOO_MANY_UPLOADS: 'Too many pending files. Try again in a minute.', NOT_ENOUGH_DISK: 'Not enough free disk space on the server for this backup.',
  APP_SOURCE_MISSING: 'The source code (src/) is not on this server, only the built app: this backup can restore the app here but cannot rebuild it in a new GitHub repository.',
  NO_CODE_IN_BACKUP: 'This backup holds no code.', BACKUP_HAS_NO_SOURCE: 'This backup was made before the source code was included, so it cannot be turned into a repository. Make a new Full app or Code backup.',
  INTERNAL: 'Something went wrong.',
  AI_DISABLED_DEMO: 'The API is off for this demo. Turn it on from Demos.', AI_PAUSED: 'The API of this store is paused.',
};
export const saMessage = (error: unknown) => (error instanceof SaError ? tr(MESSAGES[error.code] || error.code) : tr('Something went wrong.'));

/** One "sign-in" box for an administrator: an e-mail (has @) or a user name; empty = none given (the server then uses "admin"). */
export const loginFields = (value: string) => { const v = value.trim(); return !v ? {} : v.includes('@') ? { email: v } : { username: v }; };
/** Whole-number credit limit from a text box: '' = unlimited (null); anything else must be a whole number (the server validates again). */
export const parseLimit = (value: string) => (value.trim() === '' ? null : Number(value.trim()));
