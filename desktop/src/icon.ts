/**
 * @file Icona dell'app generata al volo (nessun file immagine nel repository): un "nucleo"
 * ambra con alone, disegnato pixel per pixel e codificato in PNG con zlib (incluso in Node).
 */
import zlib from 'node:zlib'

/** CRC32 richiesto dal formato PNG per ogni blocco. */
function crc32 (buf: Buffer): number {
  let c: number
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Un blocco PNG: lunghezza, tipo, dati, CRC. */
function chunk (type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/**
 * PNG quadrato `size`×`size` con un nucleo luminoso ambra su fondo trasparente.
 * @returns il file PNG in memoria, da passare a nativeImage.createFromBuffer
 */
export function nucleusIconPng (size = 64): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filtro "none" per ogni riga
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c // 0 al centro, 1 sul bordo
      // Nucleo pieno + alone che sfuma + un anello sottile.
      const core = Math.max(0, 1 - d / 0.45)
      const ring = Math.max(0, 1 - Math.abs(d - 0.8) / 0.06)
      const alpha = Math.min(1, core * 1.4 + Math.max(0, 1 - d) * 0.35 + ring * 0.9)
      const i = y * (size * 4 + 1) + 1 + x * 4
      raw[i] = 255 // R
      raw[i + 1] = Math.round(150 + 90 * core) // G: più chiaro al centro (oro)
      raw[i + 2] = Math.round(40 + 120 * core * core) // B
      raw[i + 3] = Math.round(alpha * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit per canale
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
