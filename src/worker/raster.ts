// Draws a scene of shapes and text into a PNG, with no library: Orca's Image shows PNG, JPEG and
// WebP only, so the worker turns its drawings (Mermaid charts, README badges) into PNG files.
// Fills are antialiased by sampling each pixel row four times; text uses the system's fonts.
import { deflateSync } from 'node:zlib'
import { shapeText, type Fonts, type Point } from './font'

/** A path: moves, lines and quadratic curves, in pixels. */
export type PathCommand = { op: 'M' | 'L'; x: number; y: number } | { op: 'Q'; cx: number; cy: number; x: number; y: number }

export type Stroke = { color: string; width: number; dash?: readonly number[] }

export type Shape =
  /** `fade`: how much of the fill's strength is left at the right end (1, all of it, when unset): it pales from left to right. */
  | { kind: 'rect'; x: number; y: number; width: number; height: number; radius?: number; fill?: string; fade?: number; stroke?: Stroke }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: Stroke }
  | { kind: 'polygon'; points: readonly Point[]; fill?: string; fade?: number; stroke?: Stroke }
  /** A line or curve, open, with an arrowhead at either end when asked. */
  | { kind: 'path'; commands: readonly PathCommand[]; stroke: Stroke; arrowStart?: boolean; arrowEnd?: boolean }
  /** Text centred on `y`; `x` is its centre, or its start with `anchor: 'start'`. */
  | { kind: 'text'; x: number; y: number; text: string; size: number; color: string; bold?: boolean; anchor?: 'middle' | 'start'; spacing?: number }

export type Scene = { width: number; height: number; shapes: readonly Shape[] }

type Rgba = [number, number, number, number]

/** `#rgb`, `#rrggbb` or `#rrggbbaa` as channels from 0 to 1. */
function parseColor(color: string): Rgba {
  let hex = color.replace('#', '')
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c)
  const channel = (at: number): number => parseInt(hex.slice(at, at + 2), 16) / 255
  return [channel(0), channel(2), channel(4), hex.length >= 8 ? channel(6) : 1]
}

const SAMPLES = 4

class Canvas {
  readonly width: number
  readonly height: number
  readonly pixels: Float32Array
  private readonly coverage: Float32Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.pixels = new Float32Array(width * height * 4)
    this.coverage = new Float32Array(width * height)
  }

  /** Fills closed polygons by the nonzero rule, antialiased. */
  fill(polygons: readonly (readonly Point[])[], color: string, fade: number = 1): void {
    const edges: { x0: number; y0: number; x1: number; y1: number; dir: number }[] = []
    let top = Infinity
    let bottom = -Infinity
    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]
        const b = polygon[(i + 1) % polygon.length]
        if (a.y === b.y) continue
        const down = a.y < b.y
        edges.push(down ? { x0: a.x, y0: a.y, x1: b.x, y1: b.y, dir: 1 } : { x0: b.x, y0: b.y, x1: a.x, y1: a.y, dir: -1 })
        top = Math.min(top, a.y, b.y)
        bottom = Math.max(bottom, a.y, b.y)
      }
    }
    if (!edges.length) return
    const firstRow = Math.max(0, Math.floor(top))
    const lastRow = Math.min(this.height - 1, Math.ceil(bottom))
    let minX = this.width
    let maxX = 0
    const crossings: { x: number; dir: number }[] = []
    for (let row = firstRow; row <= lastRow; row++) {
      for (let s = 0; s < SAMPLES; s++) {
        const y = row + (s + 0.5) / SAMPLES
        crossings.length = 0
        for (const edge of edges) {
          if (y < edge.y0 || y >= edge.y1) continue
          crossings.push({ x: edge.x0 + ((y - edge.y0) * (edge.x1 - edge.x0)) / (edge.y1 - edge.y0), dir: edge.dir })
        }
        if (!crossings.length) continue
        crossings.sort((a, b) => a.x - b.x)
        let winding = 0
        let start = 0
        for (const crossing of crossings) {
          const before = winding
          winding += crossing.dir
          if (before === 0 && winding !== 0) start = crossing.x
          else if (before !== 0 && winding === 0) {
            this.span(row, start, crossing.x)
            minX = Math.min(minX, Math.floor(start))
            maxX = Math.max(maxX, Math.ceil(crossing.x))
          }
        }
      }
    }
    this.composite(firstRow, lastRow, Math.max(0, minX), Math.min(this.width - 1, maxX), parseColor(color), fade)
  }

  /** Adds one sample row's coverage between two x positions. */
  private span(row: number, from: number, to: number): void {
    const a = Math.max(0, from)
    const b = Math.min(this.width, to)
    if (b <= a) return
    const base = row * this.width
    const first = Math.floor(a)
    const last = Math.floor(b)
    const share = 1 / SAMPLES
    if (first === last) {
      this.coverage[base + first] += (b - a) * share
      return
    }
    this.coverage[base + first] += (first + 1 - a) * share
    for (let x = first + 1; x < last; x++) this.coverage[base + x] += share
    if (last < this.width) this.coverage[base + last] += (b - last) * share
  }

  /** Paints the gathered coverage in `color` over what is drawn, and clears it. */
  private composite(firstRow: number, lastRow: number, minX: number, maxX: number, [r, g, b, alpha]: Rgba, fade: number): void {
    const span = Math.max(1, maxX - minX)
    for (let row = firstRow; row <= lastRow; row++) {
      for (let x = minX; x <= maxX; x++) {
        const index = row * this.width + x
        const cover = this.coverage[index]
        if (!cover) continue
        this.coverage[index] = 0
        // One shape paling across its width: pieces side by side would show their joints.
        const strength = fade === 1 ? 1 : 1 - (1 - fade) * Math.pow((x - minX) / span, 1.4)
        const a = Math.min(1, cover) * alpha * strength
        const p = index * 4
        const below = this.pixels[p + 3]
        const out = a + below * (1 - a)
        if (!out) continue
        this.pixels[p] = (r * a + this.pixels[p] * below * (1 - a)) / out
        this.pixels[p + 1] = (g * a + this.pixels[p + 1] * below * (1 - a)) / out
        this.pixels[p + 2] = (b * a + this.pixels[p + 2] * below * (1 - a)) / out
        this.pixels[p + 3] = out
      }
    }
  }
}

/** A curve or line as points, its curves cut into short lines. */
function flatten(commands: readonly PathCommand[]): Point[] {
  const points: Point[] = []
  for (const command of commands) {
    if (command.op !== 'Q') {
      points.push({ x: command.x, y: command.y })
      continue
    }
    const from = points[points.length - 1] || { x: command.x, y: command.y }
    for (let step = 1; step <= 16; step++) {
      const t = step / 16
      const u = 1 - t
      points.push({ x: u * u * from.x + 2 * u * t * command.cx + t * t * command.x, y: u * u * from.y + 2 * u * t * command.cy + t * t * command.y })
    }
  }
  return points
}

function circle(center: Point, radius: number): Point[] {
  const sides = Math.max(8, Math.ceil(radius * 4))
  return Array.from({ length: sides }, (_unused, i) => ({ x: center.x + radius * Math.cos((2 * Math.PI * i) / sides), y: center.y + radius * Math.sin((2 * Math.PI * i) / sides) }))
}

/** The pieces of a line a dash pattern keeps. */
function dashed(points: readonly Point[], dash: readonly number[]): Point[][] {
  const pieces: Point[][] = []
  let index = 0
  let left = dash[0]
  let on = true
  let current: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    let from = points[i - 1]
    const to = points[i]
    let length = Math.hypot(to.x - from.x, to.y - from.y)
    while (length > left) {
      const t = left / length
      const cut = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
      if (on) pieces.push([...current, cut])
      current = [cut]
      length -= left
      from = cut
      index = (index + 1) % dash.length
      left = dash[index]
      on = !on
    }
    left -= length
    current.push(to)
  }
  if (on && current.length > 1) pieces.push(current)
  return pieces
}

/** The polygons all turning the same way, so where they overlap they add up rather than cancel. */
function sameWay(polygons: Point[][]): Point[][] {
  return polygons.map((polygon) => {
    let area = 0
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]
      const b = polygon[(i + 1) % polygon.length]
      area += a.x * b.y - b.x * a.y
    }
    return area < 0 ? [...polygon].reverse() : polygon
  })
}

/** A line of `width` along the points, as polygons: a quad per piece and round joints. */
function strokePolygons(points: readonly Point[], width: number, closed: boolean): Point[][] {
  const half = width / 2
  const polygons: Point[][] = []
  const line = closed ? [...points, points[0]] : points
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    const nx = (-(b.y - a.y) / length) * half
    const ny = ((b.x - a.x) / length) * half
    polygons.push([
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny }
    ])
  }
  if (width > 1.2) for (const point of line.slice(closed ? 0 : 1, closed ? undefined : -1)) polygons.push(circle(point, half))
  return polygons
}

function rectPoints(x: number, y: number, width: number, height: number, radius: number = 0): Point[] {
  const r = Math.min(radius, width / 2, height / 2)
  if (r <= 0) return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
  const corner = (cx: number, cy: number, from: number): Point[] =>
    Array.from({ length: 7 }, (_unused, i) => {
      const angle = from + (i * Math.PI) / 12
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
    })
  return [...corner(x + width - r, y + r, -Math.PI / 2), ...corner(x + width - r, y + height - r, 0), ...corner(x + r, y + height - r, Math.PI / 2), ...corner(x + r, y + r, Math.PI)]
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Point[] {
  const sides = Math.max(24, Math.ceil((rx + ry) / 2))
  return Array.from({ length: sides }, (_unused, i) => ({ x: cx + rx * Math.cos((2 * Math.PI * i) / sides), y: cy + ry * Math.sin((2 * Math.PI * i) / sides) }))
}

/** An arrowhead whose tip is `tip`, pointing away from `from`. */
function arrowhead(tip: Point, from: Point, size: number): Point[] {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1
  const ux = (tip.x - from.x) / length
  const uy = (tip.y - from.y) / length
  const back = { x: tip.x - ux * size, y: tip.y - uy * size }
  return [tip, { x: back.x - uy * size * 0.5, y: back.y + ux * size * 0.5 }, { x: back.x + uy * size * 0.5, y: back.y - ux * size * 0.5 }]
}

function drawText(canvas: Canvas, fonts: Fonts, shape: Extract<Shape, { kind: 'text' }>, scale: number): void {
  const size = shape.size * scale
  const shaped = shapeText(fonts, shape.text, size, shape.bold)
  const spacing = (shape.spacing || 0) * scale
  const width = shaped.reduce((sum, item) => sum + item.advance + spacing, 0) - spacing
  const main = shape.bold ? fonts.bold : fonts.regular
  // The middle of the capitals sits on `y`.
  const baseline = shape.y * scale + (size * (main.ascender + main.descender)) / (2 * main.unitsPerEm) * 0.9
  let pen = shape.anchor === 'start' ? shape.x * scale : shape.x * scale - width / 2
  const plain: Point[][] = []
  for (const item of shaped) {
    const ratio = size / item.font.unitsPerEm
    const place = (outline: Point[][]): Point[][] => outline.map((contour) => contour.map((point) => ({ x: pen + point.x * ratio, y: baseline - point.y * ratio })))
    const layers = item.font.layers(item.glyph)
    if (layers) {
      // An emoji: its coloured layers in order, drawn now so later text stays above.
      for (const layer of layers) canvas.fill(place(layer.outline), layer.color || shape.color)
    } else plain.push(...place(item.font.outline(item.glyph)))
    pen += item.advance + spacing
  }
  canvas.fill(plain, shape.color)
}

function drawShape(canvas: Canvas, fonts: Fonts | null, shape: Shape, scale: number): void {
  const s = (point: Point): Point => ({ x: point.x * scale, y: point.y * scale })
  const strokeOf = (points: Point[], stroke: Stroke | undefined, closed: boolean): void => {
    if (!stroke) return
    const pieces = stroke.dash ? dashed(closed ? [...points, points[0]] : points, stroke.dash.map((length) => length * scale)) : [points]
    canvas.fill(sameWay(pieces.flatMap((piece) => strokePolygons(piece, stroke.width * scale, closed && !stroke.dash))), stroke.color)
  }
  switch (shape.kind) {
    case 'rect': {
      const points = rectPoints(shape.x * scale, shape.y * scale, shape.width * scale, shape.height * scale, (shape.radius || 0) * scale)
      if (shape.fill) canvas.fill([points], shape.fill, shape.fade ?? 1)
      strokeOf(points, shape.stroke, true)
      return
    }
    case 'ellipse': {
      const points = ellipsePoints(shape.cx * scale, shape.cy * scale, shape.rx * scale, shape.ry * scale)
      if (shape.fill) canvas.fill([points], shape.fill)
      strokeOf(points, shape.stroke, true)
      return
    }
    case 'polygon': {
      const points = shape.points.map(s)
      if (shape.fill) canvas.fill([points], shape.fill, shape.fade ?? 1)
      strokeOf(points, shape.stroke, true)
      return
    }
    case 'path': {
      const points = flatten(shape.commands).map(s)
      if (points.length < 2) return
      const head = Math.max(7, shape.stroke.width * 4) * scale
      // The line stops at the arrow's base, so its end does not show past the tip.
      const trim = (tip: Point, from: Point): Point => {
        const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1
        return { x: tip.x - ((tip.x - from.x) / length) * head * 0.8, y: tip.y - ((tip.y - from.y) / length) * head * 0.8 }
      }
      const line = [...points]
      const end = points[points.length - 1]
      const beforeEnd = points[points.length - 2]
      const start = points[0]
      const afterStart = points[1]
      if (shape.arrowEnd) line[line.length - 1] = trim(end, beforeEnd)
      if (shape.arrowStart) line[0] = trim(start, afterStart)
      strokeOf(line, shape.stroke, false)
      if (shape.arrowEnd) canvas.fill([arrowhead(end, beforeEnd, head)], shape.stroke.color)
      if (shape.arrowStart) canvas.fill([arrowhead(start, afterStart, head)], shape.stroke.color)
      return
    }
    case 'text':
      // With no font there is no text; scenes that need it are not drawn at all.
      if (fonts) drawText(canvas, fonts, shape, scale)
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_unused, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** RGBA pixels as a PNG file. */
export function encodePng(width: number, height: number, pixels: Float32Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width * 4; x++) raw[row + 1 + x] = Math.round(Math.min(1, Math.max(0, pixels[y * width * 4 + x])) * 255)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** The scene as a PNG, `scale` pixels per unit, so it stays sharp on dense screens. `fonts` may be null for a scene with no text. */
export function renderPng(scene: Scene, fonts: Fonts | null, scale: number = 2): Buffer {
  const width = Math.max(1, Math.ceil(scene.width * scale))
  const height = Math.max(1, Math.ceil(scene.height * scale))
  const canvas = new Canvas(width, height)
  for (const shape of scene.shapes) drawShape(canvas, fonts, shape, scale)
  return encodePng(width, height, canvas.pixels)
}
