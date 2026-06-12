import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const iconsDir = join(__dirname, '..', 'extension', 'icons')

function makePNG(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4)
  const d = Buffer.alloc(13)
  d.writeUInt32BE(size, 0); d.writeUInt32BE(size, 4); d[8] = 8; d[9] = 2; d[10] = 0; d[11] = 0; d[12] = 0
  d.copy(ihdr, 8)
  ihdr.writeUInt32BE(crc32(ihdr.subarray(4)), 21)

  const raw = Buffer.alloc(size * (1 + size * 3))
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 3)] = 0
    for (let x = 0; x < size; x++) {
      const i = y * (1 + size * 3) + 1 + x * 3
      const t = (x + y) / (size * 2)
      raw[i] = Math.round(74 + (53 - 74) * t)
      raw[i + 1] = Math.round(144 + (122 - 144) * t)
      raw[i + 2] = Math.round(217 + (189 - 217) * t)
    }
  }
  const cmp = deflate(raw)
  const idat = Buffer.alloc(12 + cmp.length)
  idat.writeUInt32BE(cmp.length, 0); idat.write('IDAT', 4); cmp.copy(idat, 8)
  idat.writeUInt32BE(crc32(idat.subarray(4)), 8 + cmp.length)

  const iend = Buffer.alloc(12)
  iend.writeUInt32BE(0, 0); iend.write('IEND', 4)
  iend.writeUInt32BE(crc32(iend.subarray(4)), 8)

  return Buffer.concat([sig, ihdr, idat, iend])
}

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

function deflate(data) {
  const blocks = []
  for (let i = 0; i < data.length; i += 65535) {
    const b = data.slice(i, Math.min(i + 65535, data.length))
    const h = Buffer.alloc(5)
    h[0] = i + 65535 >= data.length ? 1 : 0
    h.writeUInt16LE(b.length, 1); h.writeUInt16LE(~b.length & 0xFFFF, 3)
    blocks.push(h, b)
  }
  return Buffer.concat(blocks)
}

;[16, 32, 48, 128].forEach(s => {
  const p = makePNG(s)
  writeFileSync(join(iconsDir, `icon${s}.png`), p)
  console.log(`Created icon${s}.png`)
})
