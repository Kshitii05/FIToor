// Identifies an image from its first bytes. The file name and the content type sent
// by the client are never trusted.

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWith(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

/** Returns `{ mimeType, extension }` for a JPEG, PNG or WebP image, otherwise null. */
export function detectImageType(buffer) {
  if (startsWith(buffer, JPEG)) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (startsWith(buffer, PNG)) return { mimeType: 'image/png', extension: 'png' };
  if (startsWith(buffer, RIFF) && startsWith(buffer, WEBP, 8)) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}
