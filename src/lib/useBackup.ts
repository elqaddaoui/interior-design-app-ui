import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient, errorCode, isRunning, watchJob, type BackupRequest, type Capabilities, type Job, type MediaTarget, type Plan, type Transport } from '@/lib/backupClient';

export type RestorePhase = 'idle' | 'uploading' | 'validating' | 'ready' | 'restoring' | 'done' | 'error';

/**
 * State machine shared by both Backup screens: capabilities, history, the running backup, and the restore wizard
 * (upload -> validation -> choose parts -> confirmed restore). Everything long runs on the server; this only polls.
 */
export function useBackup(transport: Transport | null, scopeKey: string) {
  const client = useMemo(() => (transport ? createClient(transport) : null), [transport]);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);          // backup job being watched
  const [error, setError] = useState<string | null>(null);   // error code of the last action
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<RestorePhase>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [checkJob, setCheckJob] = useState<Job | null>(null); // validation job (shows errors of a refused file)
  const [restoreJob, setRestoreJob] = useState<Job | null>(null);
  const stop = useRef({ aborted: false });
  const upload = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => { stop.current = { aborted: false }; return () => { stop.current.aborted = true; upload.current.aborted = true; }; }, [client, scopeKey]);

  const loadJobs = useCallback(async () => { if (client) try { setJobs(await client.list()); } catch { /* keep the last list */ } }, [client]);
  const loadCaps = useCallback(async () => {
    if (!client) return;
    setCapsError(null);
    try { setCaps(await client.capabilities()); } catch (e) { setCapsError(errorCode(e)); }
  }, [client]);
  const track = useCallback(async (first: Job) => {
    if (!client) return first;
    const guard = stop.current;
    try { const done = await watchJob(client, first, setJob, guard); if (!guard.aborted) { setJob(done); loadJobs(); loadCaps(); } return done; }
    catch (e) { if (!guard.aborted) setError(errorCode(e)); return first; }
  }, [client, loadJobs, loadCaps]);

  // Reset everything when the target (store / platform) changes.
  useEffect(() => {
    setCaps(null); setJobs([]); setJob(null); setError(null); setPhase('idle'); setPlan(null); setUploadId(null); setCheckJob(null); setRestoreJob(null); setFileName(''); setUploadPct(0);
    loadCaps(); loadJobs();
  }, [loadCaps, loadJobs, scopeKey]);
  // A job already running on the server (page reloaded, other tab): pick it up.
  useEffect(() => {
    if (!client || !caps?.running || job) return;
    client.get(caps.running).then((j) => { if (j.kind === 'backup') track(j); else setRestoreJob(j); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, caps?.running]);

  const startBackup = useCallback(async (request: BackupRequest) => {
    if (!client) return;
    setBusy(true); setError(null); setJob(null);
    try { const first = await client.start(request); setBusy(false); await track(first); }
    catch (e) { setError(errorCode(e)); setJob(null); }
    finally { setBusy(false); }
  }, [client, track]);

  const cancel = useCallback(async (id: string) => { if (client) try { setJob(await client.cancel(id)); } catch (e) { setError(errorCode(e)); } }, [client]);
  const cancelRestore = useCallback(async (id: string) => { if (client) try { setRestoreJob(await client.cancel(id)); } catch (e) { setError(errorCode(e)); } }, [client]);

  const reset = useCallback(async () => {
    upload.current.aborted = true;
    if (client && uploadId && phase !== 'restoring' && phase !== 'done') await client.discard(uploadId);
    setPhase('idle'); setPlan(null); setUploadId(null); setCheckJob(null); setRestoreJob(null); setFileName(''); setUploadPct(0); setError(null);
  }, [client, uploadId, phase]);

  const pickFile = useCallback(async (file: File) => {
    if (!client) return;
    if (uploadId) await client.discard(uploadId);
    upload.current = { aborted: false };
    const guard = upload.current;
    setError(null); setPlan(null); setUploadId(null); setCheckJob(null); setRestoreJob(null); setFileName(file.name); setUploadPct(0); setPhase('uploading');
    try {
      const sent = await client.upload(file, (f) => setUploadPct(Math.round(f * 100)), guard);
      setUploadId(sent.uploadId); setPhase('validating'); setCheckJob(sent.job);
      const checked = await watchJob(client, sent.job, setCheckJob, stop.current);
      if (checked.status === 'done' && checked.result?.plan) { setPlan(checked.result.plan); setPhase('ready'); }
      else { setError(checked.errors[0]?.code || 'UNKNOWN'); setPhase('error'); }
    } catch (e) { if ((e as { code?: string }).code !== 'CANCELLED') { setError(errorCode(e)); setPhase('error'); } }
  }, [client, uploadId]);

  const restore = useCallback(async (parts: { app: boolean; db: boolean; media: boolean }, mediaTarget: MediaTarget | undefined, safetyBackup: boolean) => {
    if (!client || !uploadId) return;
    setError(null); setPhase('restoring');
    try {
      const first = await client.restore({ uploadId, parts, mediaTarget, safetyBackup });
      setRestoreJob(first);
      const done = await watchJob(client, first, setRestoreJob, stop.current);
      setRestoreJob(done); setPhase(done.status === 'done' ? 'done' : 'error');
      if (done.status !== 'done') setError(done.errors[0]?.code || (done.status === 'cancelled' ? 'CANCELLED' : 'UNKNOWN'));
      loadJobs(); loadCaps();
    } catch (e) { setError(errorCode(e)); setPhase('ready'); }
  }, [client, uploadId, loadJobs, loadCaps]);

  const download = useCallback((id: string) => {
    if (!client) return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const a = doc.createElement('a');
    a.href = client.downloadUrl(id); a.rel = 'noopener'; a.style.display = 'none';
    doc.body.appendChild(a); a.click(); a.remove();
  }, [client]);

  return { caps, capsError, loadCaps, jobs, loadJobs, job, error, busy, startBackup, cancel, cancelRestore, download, backupRunning: isRunning(job),
    phase, uploadPct, fileName, plan, checkJob, restoreJob, pickFile, restore, reset, clearError: () => setError(null) };
}

/** Opens the browser's file chooser (web). Must be called synchronously inside the tap. */
export function chooseZip(): Promise<File | null> {
  return new Promise((resolve) => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return resolve(null);
    const input = doc.createElement('input');
    input.type = 'file'; input.accept = '.zip,application/zip,application/x-zip-compressed';
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px';
    let done = false;
    const finish = (file: File | null) => { if (done) return; done = true; input.remove(); resolve(file); };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    doc.body.appendChild(input);
    input.click();
  });
}
