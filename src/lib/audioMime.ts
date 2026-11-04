/**
 * The MIME type to declare for a recorded voice note (web). The server checks the declared type against the real bytes, so a wrong
 * guess is refused: browsers disagree on what `Blob.type` says (Chrome `audio/webm;codecs=opus`, Firefox `audio/ogg;codecs=opus`,
 * Safari `audio/mp4`, some Safari versions `video/mp4` or an empty string for an audio-only recording). The container's own first bytes
 * are the truth, so they win whenever they are recognisable; `Blob.type` is only the fallback.
 */
export function audioMimeOf(blobType: string, head: Uint8Array): string {
  const at = (i: number, ...b: number[]) => b.every((v, k) => head[i + k] === v);
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'audio/webm';
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return 'audio/mp4';
  if (at(0, 0x4f, 0x67, 0x67, 0x53)) return 'audio/ogg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return 'audio/wav';
  if (at(0, 0x49, 0x44, 0x33)) return 'audio/mpeg';
  const base = blobType.split(';')[0].trim().toLowerCase();
  if (base.startsWith('audio/')) return base;
  return base === 'video/mp4' ? 'audio/mp4' : 'audio/webm';
}
