/** Tiny, dependency-free image helpers: real type from the magic bytes, pixel size from the header. */
function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
/** { width, height } of a PNG / JPEG / WebP, or null when the header cannot be read. */
function imageSize(buf) {
  try {
    const mime = sniffMime(buf);
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (mime === 'image/webp') {
      const kind = buf.toString('latin1', 12, 16);
      if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (kind === 'VP8L') { const bits = buf.readUInt32LE(21); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
      if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
  } catch { /* unreadable header */ }
  return null;
}
/**
 * Output size that keeps the photo's aspect ratio (so the room is never stretched or cropped): the longest side is `max`
 * pixels at most, both sides are multiples of 16 (what diffusion models expect) and the ratio is clamped to 1:2.5 .. 2.5:1.
 */
function fitSize(size, max = 1024) {
  const ratio = size?.width && size?.height ? Math.min(2.5, Math.max(0.4, size.width / size.height)) : 4 / 3;
  const round = value => Math.max(256, Math.round(value / 16) * 16);
  return ratio >= 1 ? { width: round(max), height: round(max / ratio) } : { width: round(max * ratio), height: round(max) };
}
module.exports = { sniffMime, imageSize, fitSize };
