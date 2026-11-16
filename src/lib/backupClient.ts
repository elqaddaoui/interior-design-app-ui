/**
 * Client of the backup service (server/backup/routes.js), shared by the store admin and the Super Admin console.
 * Pure logic, no UI, no import: each UI hands over a `Transport` that knows its own base URL and session. The console may not import the
 * store's API helper (style/data isolation), the admin may not use the console's: both just implement the 3 small functions below.
 */
export type BkErrorShape = { status: number; code: string; body?: Record<string, unknown> };
export class BkError extends Error {
  constructor(public status: number, public code: string, public body: Record<string, unknown> = {}) { super(code); }
}
export type Transport = {
  /** JSON in, JSON out (path relative to the backup prefix, e.g. `/jobs`). Throws BkError. */
  json<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>;
  /** One raw chunk (application/octet-stream), JSON out. Throws BkError. */
  chunk<T>(path: string, body: Blob): Promise<T>;
  /** Absolute URL a browser can open to download a finished backup (session cookie authenticates it). */
  downloadUrl(jobId: string): string;
};

export type BackupType = 'app' | 'db' | 'both';
export type Destination = 'local' | 'gdrive' | 'dropbox';
export type Provider = 'neon' | 'supabase';
export type MediaTarget = 'r2' | 'app';
export type Capabilities = {
  available: boolean; reason: string; scope: 'tenant' | 'platform'; types: BackupType[]; canApp: boolean; storeSplit?: boolean;
  provider: { detected: string; engine: string; options: Provider[]; locked?: boolean };
  media: { mode: string; count: number; bytes: number; targets: { r2: boolean; app: boolean } };
  destinations: { local: true; gdrive?: { serverConfigured: boolean }; dropbox?: { serverConfigured: boolean } };
  limits: { maxUploadBytes: number; keepHours: number }; running: string | null;
};
export type JobStep = { key: string; status: 'pending' | 'running' | 'done' | 'error' | 'skipped'; detail?: Record<string, unknown> };
export type JobLog = { at: number; level: 'info' | 'warn' | 'error'; code: string; [k: string]: unknown };
export type JobIssue = { code: string; [k: string]: unknown };
export type Plan = {
  manifest: { createdAt?: number; appVersion?: string; scope: string; tenantId?: string | null; type?: string; storePart?: 'app' | 'db' | 'both'; includes: { app?: boolean; db?: boolean; media?: boolean }; db?: { provider?: string; dataMode?: string; schemaOnly?: boolean } | null; [k: string]: unknown };
  restorable: { app: boolean; db: boolean; media: boolean };
  mediaTargets: { r2: boolean; app: boolean }; defaultMediaTarget: MediaTarget;
  willReplace: Record<string, number>; currentProvider: string; warnings: JobIssue[];
};
export type Job = {
  id: string; kind: 'backup' | 'restore' | 'validate'; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; progress: number;
  steps: JobStep[]; log: JobLog[]; errors: JobIssue[]; warnings: JobIssue[]; options: Record<string, any>;
  createdAt: number; startedAt: number | null; finishedAt: number | null;
  result: ({ name?: string; size?: number; sha256?: string; plan?: Plan; restored?: { app: number; db: Record<string, number> | null; media: number }; failed?: boolean; restartRequired?: boolean; safetyBackup?: { name?: string } | string | null; [k: string]: unknown }) | null;
  canDownload: boolean; cancelling: boolean;
};
export type BackupRequest = { type: BackupType; data: 'content' | 'empty'; media: boolean; provider: 'auto' | Provider; destination: Destination; auth?: { accessToken?: string; folder?: string; folderId?: string } };
export type RestoreRequest = { uploadId: string; parts: { app: boolean; db: boolean; media: boolean }; mediaTarget?: MediaTarget; safetyBackup: boolean };

export const isRunning = (job: Pick<Job, 'status'> | null | undefined) => !!job && (job.status === 'queued' || job.status === 'running');
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createClient = (t: Transport) => ({
  capabilities: () => t.json<Capabilities>('/capabilities'),
  list: async () => (await t.json<{ jobs: Job[] }>('/jobs')).jobs,
  get: async (id: string) => (await t.json<{ job: Job }>(`/jobs/${id}`)).job,
  start: async (body: BackupRequest) => (await t.json<{ job: Job }>('/jobs', { method: 'POST', body })).job,
  cancel: async (id: string) => (await t.json<{ job: Job }>(`/jobs/${id}/cancel`, { method: 'POST', body: {} })).job,
  restore: async (body: RestoreRequest) => (await t.json<{ job: Job }>('/restores', { method: 'POST', body: { ...body, confirm: true } })).job,
  discard: (uploadId: string) => t.json<{ ok: boolean }>(`/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => undefined),
  downloadUrl: t.downloadUrl,
  /**
   * Sends `file` in chunks (the server caps a chunk at 4 MB, so every request stays small and a dropped connection only repeats one chunk),
   * then starts the validation job. Resumes at the offset the server reports. Resolves with the upload id and the validation job.
   */
  async upload(file: Blob, onProgress: (fraction: number) => void, signal?: { aborted: boolean }): Promise<{ uploadId: string; job: Job }> {
    const created = await t.json<{ uploadId: string; chunkSize: number }>('/uploads', { method: 'POST', body: { size: file.size } });
    const size = Math.max(256 * 1024, Math.min(created.chunkSize || 4 * 1024 * 1024, 4 * 1024 * 1024));
    let offset = 0, tries = 0;
    while (offset < file.size) {
      if (signal?.aborted) { await t.json(`/uploads/${created.uploadId}`, { method: 'DELETE' }).catch(() => undefined); throw new BkError(0, 'CANCELLED'); }
      const end = Math.min(file.size, offset + size);
      try {
        await t.chunk(`/uploads/${created.uploadId}/chunk?offset=${offset}`, file.slice(offset, end));
        offset = end; tries = 0; onProgress(offset / file.size);
      } catch (error) {
        const e = error as BkError;
        if (e.code === 'UPLOAD_OFFSET' && Number.isInteger(e.body?.expected)) { offset = e.body!.expected as number; continue; } // the server already has more: carry on from there
        if ((e.status === 0 || e.status >= 500 || e.code === 'NETWORK' || e.code === 'UPLOAD_INTERRUPTED') && ++tries <= 4) { await wait(800 * tries); continue; }
        throw e;
      }
    }
    const done = await t.json<{ job: Job }>(`/uploads/${created.uploadId}/complete`, { method: 'POST', body: {} });
    return { uploadId: created.uploadId, job: done.job };
  },
});
export type BackupClient = ReturnType<typeof createClient>;

/** Polls a job until it finishes. Short network drops are tolerated (the job keeps running on the server). */
export async function watchJob(client: BackupClient, first: Job, onUpdate: (job: Job) => void, stop?: { aborted: boolean }): Promise<Job> {
  let job = first, misses = 0;
  onUpdate(job);
  while (isRunning(job)) {
    if (stop?.aborted) return job;
    await wait(job.kind === 'validate' ? 700 : 1000);
    try { job = await client.get(job.id); misses = 0; onUpdate(job); }
    catch (error) { if ((error as BkError).status === 404 || ++misses > 6) throw error; }
  }
  return job;
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
/** Texts are looked up by error code; a few errors carry details ({entry}, {table}...). */
export const errorCode = (error: unknown): string => (error && typeof (error as BkError).code === 'string' && (error as BkError).code ? ((error as BkError).code === 'BACKEND_UNAVAILABLE' ? 'NETWORK' : (error as BkError).code) : 'UNKNOWN');
export const errorVars = (issue: JobIssue | BkError): Record<string, string> => {
  const src: Record<string, unknown> = issue instanceof BkError ? issue.body : issue;
  return Object.fromEntries(['entry', 'table', 'destination', 'detected', 'tenant', 'count', 'from', 'to'].map((k) => [k, String(src[k] ?? '')]));
};
