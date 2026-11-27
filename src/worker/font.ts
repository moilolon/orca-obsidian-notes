// The system's TrueType fonts, read with no library: each character's outline and width, so the
// worker can draw text into a PNG (Orca shows no SVG). Color emojis come from Windows' COLR
// layers; fonts with PostScript outlines (CFF) or bitmap emojis are skipped.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Point = { x: number; y: number }
/** A glyph's outline in font units, y up: closed contours of points, curves already flattened. */
export type Outline = Point[][]
/** One coloured layer of a glyph; `color` null takes the text's own colour. */
export type Layer = { outline: Outline; color: string | null }

type Table = { offset: number; length: number }

/** One TrueType font: its tables, read on demand. */
export class Font {
  readonly unitsPerEm: number
  readonly ascender: number
  readonly descender: number
  private readonly data: DataView
  private readonly tables: Map<string, Table>
  private readonly numGlyphs: number
  private readonly numHMetrics: number
  private readonly longLoca: boolean
  private readonly cmap: (code: number) => number
  private readonly outlines = new Map<number, Outline>()
  private readonly colorLayers: Map<number, { glyph: number; palette: number }[]> | null
  private readonly palette: string[]

  constructor(buffer: Buffer, offset: number = 0) {
    this.data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const count = this.u16(offset + 4)
    this.tables = new Map()
    for (let i = 0; i < count; i++) {
      const record = offset + 12 + i * 16
      const tag = String.fromCharCode(...[0, 1, 2, 3].map((at) => this.data.getUint8(record + at)))
      this.tables.set(tag, { offset: this.u32(record + 8), length: this.u32(record + 12) })
    }
    for (const needed of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'loca', 'glyf']) {
      if (!this.tables.has(needed)) throw new Error(`no ${needed} table`)
    }
    const head = this.table('head').offset
    this.unitsPerEm = this.u16(head + 18)
    this.longLoca = this.i16(head + 50) === 1
    const hhea = this.table('hhea').offset
    this.ascender = this.i16(hhea + 4)
    this.descender = this.i16(hhea + 6)
    this.numHMetrics = this.u16(hhea + 34)
    this.numGlyphs = this.u16(this.table('maxp').offset + 4)
    this.cmap = this.readCmap()
    this.palette = this.readPalette()
    this.colorLayers = this.palette.length ? this.readColr() : null
  }

  private u8(at: number): number {
    return this.data.getUint8(at)
  }
  private u16(at: number): number {
    return this.data.getUint16(at)
  }
  private i16(at: number): number {
    return this.data.getInt16(at)
  }
  private u32(at: number): number {
    return this.data.getUint32(at)
  }
  private table(tag: string): Table {
    return this.tables.get(tag)!
  }

  /** The character's glyph, or 0 when the font has none. */
  glyphOf(code: number): number {
    return this.cmap(code)
  }

  /** A glyph's advance, in font units. */
  advance(glyph: number): number {
    const hmtx = this.table('hmtx').offset
    const index = Math.min(glyph, this.numHMetrics - 1)
    return this.u16(hmtx + index * 4)
  }

  /** The glyph's coloured layers (an emoji), or null for a plain glyph. */
  layers(glyph: number): Layer[] | null {
    const layers = this.colorLayers?.get(glyph)
    if (!layers) return null
    return layers.map((layer) => ({ outline: this.outline(layer.glyph), color: layer.palette === 0xffff ? null : this.palette[layer.palette] || null }))
  }

  /** Format 4 (the basic plane) or 12 (all of Unicode), Windows or Unicode platform. */
  private readCmap(): (code: number) => number {
    const cmap = this.table('cmap').offset
    const count = this.u16(cmap + 2)
    let best: { format: number; offset: number } | null = null
    for (let i = 0; i < count; i++) {
      const platform = this.u16(cmap + 4 + i * 8)
      const encoding = this.u16(cmap + 6 + i * 8)
      const offset = cmap + this.u32(cmap + 8 + i * 8)
      const format = this.u16(offset)
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
      if (!unicode || (format !== 4 && format !== 12)) continue
      if (!best || (format === 12 && best.format === 4)) best = { format, offset }
    }
    if (!best) throw new Error('no Unicode cmap')
    const { format, offset } = best
    if (format === 12) {
      const groups = this.u32(offset + 12)
      return (code) => {
        let low = 0
        let high = groups - 1
        while (low <= high) {
          const mid = (low + high) >> 1
          const at = offset + 16 + mid * 12
          const start = this.u32(at)
          const end = this.u32(at + 4)
          if (code < start) high = mid - 1
          else if (code > end) low = mid + 1
          else return this.u32(at + 8) + code - start
        }
        return 0
      }
    }
    const segments = this.u16(offset + 6) / 2
    const ends = offset + 14
    const starts = ends + segments * 2 + 2
    const deltas = starts + segments * 2
    const ranges = deltas + segments * 2
    return (code) => {
      if (code > 0xffff) return 0
      for (let i = 0; i < segments; i++) {
        if (code > this.u16(ends + i * 2)) continue
        const start = this.u16(starts + i * 2)
        if (code < start) return 0
        const delta = this.i16(deltas + i * 2)
        const range = this.u16(ranges + i * 2)
        if (!range) return (code + delta) & 0xffff
        const glyph = this.u16(ranges + i * 2 + range + (code - start) * 2)
        return glyph ? (glyph + delta) & 0xffff : 0
      }
      return 0
    }
  }

  private readPalette(): string[] {
    const cpal = this.tables.get('CPAL')
    if (!cpal || !this.tables.has('COLR')) return []
    const entries = this.u16(cpal.offset + 2)
    const records = this.u32(cpal.offset + 8)
    const first = this.u16(cpal.offset + 12)
    const colors: string[] = []
    for (let i = 0; i < entries; i++) {
      const at = cpal.offset + records + (first + i) * 4
      const hex = (value: number): string => value.toString(16).padStart(2, '0')
      // BGRA; a colour drawn with alpha keeps it as #rrggbbaa.
      const alpha = this.u8(at + 3)
      colors.push(`#${hex(this.u8(at + 2))}${hex(this.u8(at + 1))}${hex(this.u8(at))}${alpha === 255 ? '' : hex(alpha)}`)
    }
    return colors
  }

  /** COLR version 0 layers, which version 1 tables keep too. */
  private readColr(): Map<number, { glyph: number; palette: number }[]> {
    const colr = this.table('COLR').offset
    const bases = this.u16(colr + 2)
    const baseOffset = colr + this.u32(colr + 4)
    const layerOffset = colr + this.u32(colr + 8)
    const map = new Map<number, { glyph: number; palette: number }[]>()
    for (let i = 0; i < bases; i++) {
      const at = baseOffset + i * 6
      const first = this.u16(at + 2)
      const count = this.u16(at + 4)
      const layers: { glyph: number; palette: number }[] = []
      for (let j = 0; j < count; j++) {
        const layer = layerOffset + (first + j) * 4
        layers.push({ glyph: this.u16(layer), palette: this.u16(layer + 2) })
      }
      map.set(this.u16(at), layers)
    }
    return map
  }

  /** The glyph's contours in font units, quadratic curves flattened. */
  outline(glyph: number): Outline {
    const known = this.outlines.get(glyph)
    if (known) return known
    const outline = glyph < this.numGlyphs ? this.readGlyph(glyph, 0) : []
    this.outlines.set(glyph, outline)
    return outline
  }

  private readGlyph(glyph: number, depth: number): Outline {
    const loca = this.table('loca').offset
    const start = this.longLoca ? this.u32(loca + glyph * 4) : this.u16(loca + glyph * 2) * 2
    const end = this.longLoca ? this.u32(loca + glyph * 4 + 4) : this.u16(loca + glyph * 2 + 2) * 2
    if (end <= start) return []
    const at = this.table('glyf').offset + start
    const contours = this.i16(at)
    return contours >= 0 ? this.simpleGlyph(at, contours) : depth < 8 ? this.compoundGlyph(at, depth) : []
  }

  private simpleGlyph(at: number, contours: number): Outline {
    const endPoints: number[] = []
    for (let i = 0; i < contours; i++) endPoints.push(this.u16(at + 10 + i * 2))
    const count = contours ? endPoints[contours - 1] + 1 : 0
    let p = at + 10 + contours * 2
    p += 2 + this.u16(p)
    const flags: number[] = []
    while (flags.length < count) {
      const flag = this.u8(p++)
      flags.push(flag)
      if (flag & 8) {
        const repeat = this.u8(p++)
        for (let r = 0; r < repeat; r++) flags.push(flag)
      }
    }
    const xs: number[] = []
    let value = 0
    for (const flag of flags) {
      if (flag & 2) value += flag & 16 ? this.u8(p++) : -this.u8(p++)
      else if (!(flag & 16)) {
        value += this.i16(p)
        p += 2
      }
      xs.push(value)
    }
    const ys: number[] = []
    value = 0
    for (const flag of flags) {
      if (flag & 4) value += flag & 32 ? this.u8(p++) : -this.u8(p++)
      else if (!(flag & 32)) {
        value += this.i16(p)
        p += 2
      }
      ys.push(value)
    }
    const outline: Outline = []
    let first = 0
    for (const last of endPoints) {
      const points = []
      for (let i = first; i <= last; i++) points.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 })
      first = last + 1
      if (points.length) outline.push(flattenContour(points))
    }
    return outline
  }

  private compoundGlyph(at: number, depth: number): Outline {
    const outline: Outline = []
    let p = at + 10
    for (;;) {
      const flags = this.u16(p)
      const glyph = this.u16(p + 2)
      p += 4
      let dx = 0
      let dy = 0
      if (flags & 1) {
        dx = this.i16(p)
        dy = this.i16(p + 2)
        p += 4
      } else {
        dx = this.data.getInt8(p)
        dy = this.data.getInt8(p + 1)
        p += 2
      }
      // Point matching (no ARGS_ARE_XY_VALUES) is rare: the part is placed unmoved.
      if (!(flags & 2)) dx = dy = 0
      let [a, b, c, d] = [1, 0, 0, 1]
      const f2dot14 = (at: number): number => this.i16(at) / 16384
      if (flags & 8) {
        a = d = f2dot14(p)
        p += 2
      } else if (flags & 0x40) {
        a = f2dot14(p)
        d = f2dot14(p + 2)
        p += 4
      } else if (flags & 0x80) {
        a = f2dot14(p)
        b = f2dot14(p + 2)
        c = f2dot14(p + 4)
        d = f2dot14(p + 6)
        p += 8
      }
      for (const contour of this.readGlyph(glyph, depth + 1)) {
        outline.push(contour.map((point) => ({ x: a * point.x + c * point.y + dx, y: b * point.x + d * point.y + dy })))
      }
      if (!(flags & 0x20)) return outline
    }
  }
}

/** A TrueType contour as points, its quadratic curves cut into short lines. */
function flattenContour(points: { x: number; y: number; on: boolean }[]): Point[] {
  // Two off-curve points in a row have an on-curve point between them.
  const full: { x: number; y: number; on: boolean }[] = []
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]
    if (!point.on && !previous.on) full.push({ x: (point.x + previous.x) / 2, y: (point.y + previous.y) / 2, on: true })
    full.push(point)
  })
  const start = full.findIndex((point) => point.on)
  if (start < 0) return []
  const ordered = [...full.slice(start), ...full.slice(0, start)]
  const out: Point[] = [{ x: ordered[0].x, y: ordered[0].y }]
  for (let i = 1; i <= ordered.length; i++) {
    const point = ordered[i % ordered.length]
    if (point.on) {
      out.push({ x: point.x, y: point.y })
      continue
    }
    const next = ordered[(i + 1) % ordered.length]
    const from = out[out.length - 1]
    for (let step = 1; step <= 6; step++) {
      const t = step / 6
      const u = 1 - t
      out.push({ x: u * u * from.x + 2 * u * t * point.x + t * t * next.x, y: u * u * from.y + 2 * u * t * point.y + t * t * next.y })
    }
    i++
  }
  return out
}

/** A font file's first TrueType font, or null when it cannot be read or is not TrueType. */
function openFont(path: string): Font | null {
  try {
    const buffer = readFileSync(path)
    const tag = buffer.toString('latin1', 0, 4)
    const offset = tag === 'ttcf' ? buffer.readUInt32BE(12) : 0
    return new Font(buffer, offset)
  } catch {
    return null
  }
}

function firstFont(paths: readonly string[]): Font | null {
  for (const path of paths) {
    const font = openFont(path)
    if (font) return font
  }
  return null
}

const WINDOWS_FONTS = join(process.env.WINDIR || 'C:\\Windows', 'Fonts')

/** Where each system keeps the fonts the drawings use, the preferred first. */
const CANDIDATES = {
  regular: [
    join(WINDOWS_FONTS, 'segoeui.ttf'),
    join(WINDOWS_FONTS, 'arial.ttf'),
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf'
  ],
  bold: [
    join(WINDOWS_FONTS, 'segoeuib.ttf'),
    join(WINDOWS_FONTS, 'arialbd.ttf'),
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf'
  ],
  /** Emojis and symbols, for the characters the text font lacks. */
  fallback: [join(WINDOWS_FONTS, 'seguiemj.ttf'), join(WINDOWS_FONTS, 'seguisym.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf']
}

export type Fonts = { regular: Font; bold: Font; fallbacks: Font[] }

let loaded: Fonts | null | undefined

/** The system's fonts for drawing, read once; null when it has none the worker can read. */
export function systemFonts(): Fonts | null {
  if (loaded !== undefined) return loaded
  const regular = firstFont(CANDIDATES.regular)
  if (!regular) return (loaded = null)
  const bold = firstFont(CANDIDATES.bold) || regular
  const fallbacks = CANDIDATES.fallback.map(openFont).filter((font): font is Font => font !== null)
  return (loaded = { regular, bold, fallbacks })
}

/** A character set in a font: the glyph to draw and the font that has it. */
export type Shaped = { font: Font; glyph: number; advance: number }

/** The text's characters in the first font that has each, and their advances at `size` pixels. */
export function shapeText(fonts: Fonts, text: string, size: number, bold: boolean = false): Shaped[] {
  const main = bold ? fonts.bold : fonts.regular
  const shaped: Shaped[] = []
  for (const char of text) {
    const code = char.codePointAt(0) || 0
    // Variation selectors and joiners choose a form; drawn alone they would be boxes.
    if (code === 0xfe0f || code === 0xfe0e || code === 0x200d) continue
    let font = main
    let glyph = main.glyphOf(code)
    if (!glyph) {
      for (const fallback of fonts.fallbacks) {
        const found = fallback.glyphOf(code)
        if (found) {
          font = fallback
          glyph = found
          break
        }
      }
    }
    shaped.push({ font, glyph, advance: (font.advance(glyph) * size) / font.unitsPerEm })
  }
  return shaped
}

/** The text's width at `size` pixels, `spacing` added after each character. */
export function measureText(fonts: Fonts, text: string, size: number, bold: boolean = false, spacing: number = 0): number {
  return shapeText(fonts, text, size, bold).reduce((sum, item) => sum + item.advance + spacing, 0)
}
