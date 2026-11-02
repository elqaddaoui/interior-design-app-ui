/**
 * Device capability classification for the animated home cards. Pure functions only (no React, no native modules): the runtime
 * (lib/toolCardPerf.ts), the admin panel and `npm run check:toolcards` share them.
 *
 * WHY THE OLD DETECTION WAS WRONG
 *  - It used `expo-device`'s `deviceYearClass <= 2017`. Facebook's YearClass library (the Android implementation behind it) is frozen:
 *    its newest class is 2016, so EVERY Android phone, flagship included, was "old" and was sent to the cross-fade.
 *  - A 3-4 GB phone counted as low-end on memory alone.
 *  - One bad transition marked the phone low-end FOREVER (persisted). The first transition after a cold start is always the slowest
 *    (image decode, layer raster, JIT warm-up), so healthy phones were condemned by a single warm-up hiccup.
 *  - Frames were not filtered (warm-up included) and nothing ever expired.
 *
 * HOW IT WORKS NOW (three layers, strongest evidence wins)
 *  1. USER / BROWSER PREFERENCE  reduce-motion, data saver                       -> low (always respected)
 *  2. HARDWARE FACTS             RAM, CPU cores, 32-bit only, old Android        -> "hard" low (very weak hardware) or "soft" low (probation)
 *  3. MEASURED EVIDENCE          frame times of real transitions on this device  -> overrides the soft prior; expires after 7 days
 *
 *  A device with only soft signals starts low (safe) and is promoted as soon as it has proven itself smooth; a device with no signal
 *  starts high (full effects) and is demoted only when several real transitions in a row were janky. Hard-low hardware is never promoted.
 */

const GB = 1024 * 1024 * 1024;

/* ------------------------------ hardware signals ------------------------------ */
export interface DeviceSignals {
  platform: 'web' | 'ios' | 'android';
  /** Total RAM in bytes (Android / iOS: expo-device, web: navigator.deviceMemory, capped by the browser at 8 GB); null = unknown. */
  memoryBytes: number | null;
  /** Logical CPU cores (web only: navigator.hardwareConcurrency; null = unknown, e.g. on native). */
  cores: number | null;
  /** Android API level (Android 9 = 28); null elsewhere. */
  apiLevel: number | null;
  /** True when the device can run 64-bit code, false when it is 32-bit only (a 2013-2017 phone); null = unknown. */
  is64bit: boolean | null;
  /** The OS / browser asks for less motion. */
  reducedMotion: boolean;
  /** The browser asks for less data (Save-Data header / navigator.connection.saveData): the data saver is on. */
  saveData: boolean;
}

export type LowReason = 'reduceMotion' | 'saveData' | 'memory' | 'cores' | 'oldDevice' | 'measured';

/** Android phones at or below this RAM are entry level for sure ("2 GB" phones report ~1.8 GB; "3 GB" phones ~2.8 GB, which are NOT in this class). */
export const HARD_LOW_MEMORY_ANDROID = 2.4 * GB;
/** Android phones up to this RAM (a "3 GB" phone) start on probation: low until they have proven themselves smooth ("4 GB" phones report ~3.7 GB). */
export const SOFT_LOW_MEMORY_ANDROID = 3.4 * GB;
/** iPhones all share fast GPUs: only the very first 1 GB models would count. */
export const HARD_LOW_MEMORY_IOS = 1.2 * GB;
/** Android 9 (API 28) and older. */
export const SOFT_LOW_API = 28;

/**
 * Weak hardware that measurement cannot overrule. The web is coarse on purpose (navigator.deviceMemory is rounded to a power of two,
 * hardwareConcurrency can be spoofed by privacy modes): only a clearly tiny browser device is "hard" there.
 */
export function hardLowReason(s: DeviceSignals): LowReason | null {
  const m = s.memoryBytes;
  if (s.platform === 'web') return m != null && m <= 1 * GB ? 'memory' : null;
  if (m != null && m <= (s.platform === 'ios' ? HARD_LOW_MEMORY_IOS : HARD_LOW_MEMORY_ANDROID)) return 'memory';
  return null;
}

/** Suspicious hardware: low until measured smooth. */
export function softLowReason(s: DeviceSignals): LowReason | null {
  const m = s.memoryBytes;
  if (s.platform === 'android') {
    if (s.is64bit === false) return 'oldDevice';
    if (s.apiLevel != null && s.apiLevel < SOFT_LOW_API) return 'oldDevice';
    if (m != null && m <= SOFT_LOW_MEMORY_ANDROID) return 'memory';
    return null;
  }
  if (s.platform === 'web') {
    if (m != null && m <= 2 * GB) return 'memory';
    if (s.cores != null && s.cores <= 2) return 'cores';
    // A small laptop or a budget phone browser: 4 cores or fewer together with 4 GB or less.
    if (s.cores != null && s.cores <= 4 && m != null && m <= 4 * GB) return 'cores';
  }
  return null;
}

/* ------------------------------ measured evidence ------------------------------ */
/** Frame statistics of one transition (`frames` counted after the warm-up). */
export interface FrameStats { frames: number; sumMs: number; dropped: number; slow: number }

/** The first frames of a transition include layer raster and image upload: they are not measured. */
export const WARMUP_FRAMES = 5;
/** Fewer measured frames than this prove nothing (a very short transition). */
export const MIN_FRAMES = 12;
/** A transition is janky when its average frame is slower than this (50 fps) or more than 10% of its frames take longer than SLOW_MS. */
export const JANKY_AVG_MS = 22;
export const JANKY_SLOW_SHARE = 0.1;

export type Outcome = 'janky' | 'smooth' | 'skip';

/** One transition -> evidence. Absolute frame times: valid on 60, 90 and 120 Hz screens alike (a 120 Hz screen at 60 fps is still smooth). */
export function judgeTransition(s: FrameStats): Outcome {
  if (s.frames < MIN_FRAMES) return 'skip';
  const avg = s.sumMs / s.frames;
  return avg > JANKY_AVG_MS || s.slow / s.frames > JANKY_SLOW_SHARE ? 'janky' : 'smooth';
}

/** Stored evidence: the outcomes of the last transitions (true = janky) and when they were taken. */
export interface Evidence { at: number; runs: boolean[] }
export const WINDOW = 6;
/** Janky when at least this many of the last transitions (and at least half of them) were janky: one hiccup never decides. */
export const JANKY_COUNT = 3;
/** Smooth when at least this many were measured and at most one was janky. */
export const SMOOTH_COUNT = 4;
/** Evidence expires after a week (battery saver, thermal throttling, an OS update... can change a device). */
export const EVIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Measured = 'janky' | 'smooth' | 'unknown';

export function measuredVerdict(e: Evidence | null, now: number): Measured {
  if (!e || !(now - e.at < EVIDENCE_TTL_MS) || now < e.at - 60_000) return 'unknown';
  const last = e.runs.slice(-WINDOW);
  const janky = last.filter(Boolean).length;
  if (janky >= JANKY_COUNT && janky * 2 >= last.length) return 'janky';
  if (last.length >= SMOOTH_COUNT && janky <= 1) return 'smooth';
  return 'unknown';
}

/** Adds one outcome to the evidence (a new evidence object; `skip` changes nothing). */
export function addOutcome(e: Evidence | null, outcome: Outcome, now: number): Evidence | null {
  if (outcome === 'skip') return e;
  const fresh = e && now - e.at < EVIDENCE_TTL_MS && now >= e.at - 60_000 ? e.runs : [];
  return { at: now, runs: [...fresh, outcome === 'janky'].slice(-WINDOW) };
}

/* ------------------------------ the verdict ------------------------------ */
export interface DeviceClass {
  /** True = play the low-end rules (admin's low-end list, cross-fade otherwise, no extras). */
  low: boolean;
  reason: LowReason | null;
  /** True when nothing can promote this device (preference or very weak hardware). */
  fixed: boolean;
  measured: Measured;
}

export function classifyDevice(s: DeviceSignals, measured: Measured): DeviceClass {
  if (s.reducedMotion) return { low: true, reason: 'reduceMotion', fixed: true, measured };
  if (s.saveData) return { low: true, reason: 'saveData', fixed: true, measured };
  const hard = hardLowReason(s);
  if (hard) return { low: true, reason: hard, fixed: true, measured };
  if (measured === 'janky') return { low: true, reason: 'measured', fixed: false, measured };
  if (measured === 'smooth') return { low: false, reason: null, fixed: false, measured };
  const soft = softLowReason(s);
  return { low: !!soft, reason: soft, fixed: false, measured };
}

/**
 * Should the outcome of a transition that has just been played be recorded?
 * Not when the verdict cannot change anyway (fixed class), and not once the device is demoted by measurement: from then on it plays the
 * light effects, which would look smooth and could not tell whether it can now handle the heavy ones (that would make it flip-flop).
 */
export const shouldRecord = (c: DeviceClass) => !c.fixed && c.measured !== 'janky';
