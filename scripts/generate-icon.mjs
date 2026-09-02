// Génère l'icône de l'app (barre système, fenêtre, exécutable empaqueté) :
// un pictogramme de micro blanc sur fond carré arrondi couleur accent, dessiné
// entièrement en code (pas d'image externe, pas de souci de droits d'auteur).
// Le .ico embarque plusieurs résolutions (16/32/48/256) pour rester net à
// toutes les tailles (barre système, alt-tab, explorateur de fichiers).
// Relance ce script si tu changes les couleurs ou les proportions.
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ACCENT = [196, 96, 42, 255] // #C4602A
const WHITE = [255, 255, 255, 255]
const REFERENCE_SIZE = 256 // les coordonnées ci-dessous sont pensées pour ce canevas
const SIZES = [16, 32, 48, 256]
const SUPERSAMPLE = 4 // anti-aliasing : moyenne de NxN échantillons par pixel

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

function inRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - 1 - radius)
  const cy = Math.min(Math.max(y, radius), size - 1 - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

// Distance d'un point à un segment — sert à dessiner la tête du micro (une
// "capsule" = segment épaissi d'un rayon) et la base (idem à l'horizontale).
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSq = dx * dx + dy * dy
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function buildMicTest(size) {
  const s = size / REFERENCE_SIZE
  const cx = size / 2
  const headTop = 62 * s
  const headBottom = 138 * s
  const headRadius = 32 * s
  const arcCy = 146 * s
  const arcRadius = 46 * s
  const arcThickness = Math.max(9 * s, 1)
  const stemTop = 176 * s
  const stemBottom = 200 * s
  const stemHalfWidth = Math.max(6 * s, 0.6)
  const baseY = 204 * s
  const baseHalfLen = 30 * s
  const baseRadius = Math.max(7 * s, 0.8)

  return (x, y) => {
    if (distToSegment(x, y, cx, headTop, cx, headBottom) <= headRadius) return true
    if (y >= arcCy) {
      const d = Math.hypot(x - cx, y - arcCy)
      if (Math.abs(d - arcRadius) <= arcThickness / 2) return true
    }
    if (x >= cx - stemHalfWidth && x <= cx + stemHalfWidth && y >= stemTop && y <= stemBottom) return true
    if (distToSegment(x, y, cx - baseHalfLen, baseY, cx + baseHalfLen, baseY) <= baseRadius) return true
    return false
  }
}

function sampleCoverage(testFn, x, y) {
  let hits = 0
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      if (testFn(x + (sx + 0.5) / SUPERSAMPLE, y + (sy + 0.5) / SUPERSAMPLE)) hits++
    }
  }
  return hits / (SUPERSAMPLE * SUPERSAMPLE)
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function createIconPng(size) {
  const bgRadius = (48 * size) / REFERENCE_SIZE
  const inMic = buildMicTest(size)

  const raw = Buffer.alloc((size * 4 + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0
    for (let x = 0; x < size; x++) {
      const bgCoverage = sampleCoverage((px, py) => inRoundedSquare(px, py, size, bgRadius), x, y)
      const micCoverage = sampleCoverage(inMic, x, y)

      const r = mix(0, mix(ACCENT[0], WHITE[0], micCoverage), bgCoverage)
      const g = mix(0, mix(ACCENT[1], WHITE[1], micCoverage), bgCoverage)
      const b = mix(0, mix(ACCENT[2], WHITE[2], micCoverage), bgCoverage)
      const a = Math.round(255 * bgCoverage)

      raw[offset++] = r
      raw[offset++] = g
      raw[offset++] = b
      raw[offset++] = a
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = deflateSync(raw)

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function wrapAsIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // réservé
  header.writeUInt16LE(1, 2) // type = icône
  header.writeUInt16LE(images.length, 4)

  const entries = []
  const dataBlocks = []
  let offset = 6 + images.length * 16

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // palette
    entry[3] = 0 // réservé
    entry.writeUInt16LE(1, 4) // plans couleur
    entry.writeUInt16LE(32, 6) // bits par pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    dataBlocks.push(png)
    offset += png.length
  }

  return Buffer.concat([header, ...entries, ...dataBlocks])
}

const images = SIZES.map((size) => ({ size, png: createIconPng(size) }))
const ico = wrapAsIco(images)

const outDir = join(__dirname, '..', 'build')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'icon.ico'), ico)
console.log('Icône générée :', join(outDir, 'icon.ico'), `(${ico.length} octets, tailles: ${SIZES.join(', ')})`)

// Aperçu PNG pur (256px, hors .ico) pour relecture visuelle facile.
const previewPath = process.argv[2]
if (previewPath) {
  const largest = images.find((i) => i.size === Math.max(...SIZES))
  writeFileSync(previewPath, largest.png)
  console.log('Aperçu PNG :', previewPath)
}
