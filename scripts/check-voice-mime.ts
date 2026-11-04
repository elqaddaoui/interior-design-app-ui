/** The MIME type declared for a recorded voice note must follow the file's real bytes (the server refuses a mismatch), on every browser. */
import { audioMimeOf } from '../src/lib/audioMime';

/** Tiny strict assertion (the project has no Node typings, so `node:assert` is not imported). */
const assert = { equal: (a: unknown, b: unknown, msg: string) => { if (a !== b) throw new Error(`${msg}: expected ${String(b)}, got ${String(a)}`); } };

const head = (...a: number[]) => Uint8Array.from([...a, ...Array(16).fill(0)].slice(0, 16));
const WEBM = [0x1a, 0x45, 0xdf, 0xa3], OGG = [0x4f, 0x67, 0x67, 0x53], MP4 = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70];

assert.equal(audioMimeOf('audio/webm;codecs=opus', head(...WEBM)), 'audio/webm', 'Chrome / Edge');
assert.equal(audioMimeOf('audio/ogg;codecs=opus', head(...OGG)), 'audio/ogg', 'Firefox');
assert.equal(audioMimeOf('audio/mp4', head(...MP4)), 'audio/mp4', 'Safari');
assert.equal(audioMimeOf('', head(...MP4)), 'audio/mp4', 'Safari with an empty Blob.type');
assert.equal(audioMimeOf('video/mp4', head(...MP4)), 'audio/mp4', 'Safari reporting video/mp4 for an audio-only file');
assert.equal(audioMimeOf('video/webm', head(...WEBM)), 'audio/webm', 'a webm recording typed as video');
assert.equal(audioMimeOf('audio/webm', head(...OGG)), 'audio/ogg', 'the bytes win over a wrong Blob.type');
assert.equal(audioMimeOf('audio/x-other', head(9, 9, 9, 9)), 'audio/x-other', 'unknown bytes: keep an audio type');
assert.equal(audioMimeOf('', head(9, 9, 9, 9)), 'audio/webm', 'nothing known: webm');
console.log('voice: declared MIME follows the real container on every browser');
