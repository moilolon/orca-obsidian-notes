// Lays a Mermaid flowchart out as a scene the worker draws into a PNG: Orca has no Mermaid, and
// its Image shows only PNG, JPEG and WebP files of the plugin. Other Mermaid diagrams return null.
import type { Point } from './font'
import type { PathCommand, Scene, Shape } from './raster'

export type Direction = 'LR' | 'RL' | 'TB' | 'BT'
export type NodeShape = 'rect' | 'round' | 'stadium' | 'cylinder' | 'circle' | 'diamond' | 'hexagon' | 'subroutine'
export type FlowNode = { id: string; lines: string[]; shape: NodeShape }
export type LineStyle = 'solid' | 'dotted' | 'thick'
export type FlowEdge = { from: string; to: string; lines: string[]; style: LineStyle; arrowStart: boolean; arrowEnd: boolean }
export type Flowchart = { direction: Direction; nodes: FlowNode[]; edges: FlowEdge[] }

const HEADER = /^(?:flowchart|graph)(?:\s+(LR|RL|TB|TD|BT))?\s*;?\s*$/i
/** Lines that style or group the chart: the drawing leaves them out. */
const IGNORED = /^(?:subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b)/
/** Letters, digits and `_`: a `-` would swallow the link in `A-->B`. */
const NODE_ID = /^\w+/
/** Each shape's brackets, the longer openers first so `([` is not read as `(`. */
const SHAPES: [string, string, NodeShape][] = [
  ['([', '])', 'stadium'],
  ['[(', ')]', 'cylinder'],
  ['((', '))', 'circle'],
  ['{{', '}}', 'hexagon'],
  ['[[', ']]', 'subroutine'],
  ['[/', '/]', 'rect'],
  ['[\\', '\\]', 'rect'],
  ['[/', '\\]', 'rect'],
  ['[\\', '/]', 'rect'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
  ['>', ']', 'rect']
]

/** A label's lines: `<br>` breaks them, other tags and the quotes go. */
function labelLines(raw: string): string[] {
  const text = raw.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/#quot;/g, '"').replace(/#amp;/g, '&')
  return text
    .split(/<br\s*\/?>|\\n/i)
    .map((line) => line.replace(/<[^>]+>/g, '').replace(/\*\*|__|`/g, '').trim())
    .filter((line, index, all) => line || all.length === 1)
}

type Cursor = { text: string; at: number }

function skipSpace(cursor: Cursor): void {
  while (cursor.at < cursor.text.length && /\s/.test(cursor.text[cursor.at])) cursor.at++
}

/** A node at the cursor: its id and, when it has brackets, its label and shape. */
function readNode(cursor: Cursor): { id: string; label?: string; shape?: NodeShape } | null {
  skipSpace(cursor)
  const id = NODE_ID.exec(cursor.text.slice(cursor.at))
  if (!id) return null
  cursor.at += id[0].length
  const rest = cursor.text.slice(cursor.at)
  for (const [open, close, shape] of SHAPES) {
    if (!rest.startsWith(open)) continue
    let body = rest.slice(open.length)
    let end: number
    if (body.trimStart().startsWith('"')) {
      const quoted = body.indexOf('"')
      const closing = body.indexOf('"', quoted + 1)
      end = closing < 0 ? -1 : body.indexOf(close, closing + 1)
    } else end = body.indexOf(close)
    if (end < 0) continue
    body = body.slice(0, end)
    cursor.at += open.length + end + close.length
    skipClass(cursor)
    return { id: id[0], label: body, shape }
  }
  skipClass(cursor)
  return { id: id[0] }
}

/** `:::name` after a node gives it a class: the drawing has no use for it. */
function skipClass(cursor: Cursor): void {
  const match = /^:::[\w-]+/.exec(cursor.text.slice(cursor.at))
  if (match) cursor.at += match[0].length
}

/** Nodes joined by `&`, which all take the same links. */
function readGroup(cursor: Cursor): { id: string; label?: string; shape?: NodeShape }[] | null {
  const first = readNode(cursor)
  if (!first) return null
  const group = [first]
  for (;;) {
    const before = cursor.at
    skipSpace(cursor)
    if (cursor.text[cursor.at] !== '&') {
      cursor.at = before
      return group
    }
    cursor.at++
    const next = readNode(cursor)
    if (!next) return group
    group.push(next)
  }
}

const LINK = /^\s*(<)?(-{2,}|={2,}|-\.+-|~{3,})(>|o|x)?(?:\s*\|([^|]*)\|)?/
/** The start of a link with its text inline, `-- text -->`, and the end that closes it. */
const TEXT_LINK_START = /^\s*(<)?(--|==|-\.)(?=\s)/
const TEXT_LINK_END = /(-{2,}|={2,}|\.+-)(>|o|x)?/

/** A link at the cursor, `-->|text|` or `-- text -->`; null when there is none. */
function readLink(cursor: Cursor): Omit<FlowEdge, 'from' | 'to'> | null {
  const rest = cursor.text.slice(cursor.at)
  const textStart = TEXT_LINK_START.exec(rest)
  if (textStart) {
    const after = rest.slice(textStart[0].length)
    const end = TEXT_LINK_END.exec(after)
    if (end && end.index > 0) {
      cursor.at += textStart[0].length + end.index + end[0].length
      return edgeOf(textStart[2] + end[1], Boolean(textStart[1]), Boolean(end[2]), after.slice(0, end.index))
    }
  }
  const link = LINK.exec(rest)
  if (!link) return null
  cursor.at += link[0].length
  return edgeOf(link[2], Boolean(link[1]), Boolean(link[3]), link[4] || '')
}

function edgeOf(stroke: string, arrowStart: boolean, arrowEnd: boolean, label: string): Omit<FlowEdge, 'from' | 'to'> {
  const style: LineStyle = stroke.includes('.') ? 'dotted' : stroke.includes('=') ? 'thick' : 'solid'
  return { lines: label.trim() ? labelLines(label) : [], style, arrowStart, arrowEnd }
}

/** The chart a Mermaid flowchart describes; null for another kind of diagram or nothing to draw. */
export function parseFlowchart(code: string): Flowchart | null {
  const statements = code
    .split(/\r?\n/)
    .map((line) => line.replace(/%%.*$/, '').trim())
    .flatMap((line) => line.split(/;\s*$/))
    .filter(Boolean)
  const header = HEADER.exec(statements[0] || '')
  if (!header) return null
  const raw = (header[1] || 'TB').toUpperCase()
  const direction: Direction = raw === 'TD' ? 'TB' : (raw as Direction)
  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []
  const note = (node: { id: string; label?: string; shape?: NodeShape }): void => {
    const known = nodes.get(node.id)
    if (known && node.label === undefined) return
    nodes.set(node.id, { id: node.id, lines: node.label === undefined ? [node.id] : labelLines(node.label), shape: node.shape || 'rect' })
  }
  for (const statement of statements.slice(1)) {
    if (IGNORED.test(statement)) continue
    const cursor: Cursor = { text: statement, at: 0 }
    let group = readGroup(cursor)
    if (!group) continue
    group.forEach(note)
    for (;;) {
      const link = readLink(cursor)
      if (!link) break
      const next = readGroup(cursor)
      if (!next) break
      next.forEach(note)
      for (const from of group) for (const to of next) edges.push({ from: from.id, to: to.id, ...link })
      group = next
    }
  }
  return nodes.size ? { direction, nodes: [...nodes.values()], edges } : null
}

const FONT_SIZE = 14
const LINE_HEIGHT = 19
const PAD_X = 14
const PAD_Y = 10
const NODE_GAP = 28
const RANK_GAP = 56
const MARGIN = 12

/** How wide a line of text is at a size, in pixels: the worker measures with the font it draws with. */
export type Measure = (text: string, size: number) => number

function blockSize(lines: readonly string[], measure: Measure): { width: number; height: number } {
  return { width: Math.max(0, ...lines.map((line) => measure(line, FONT_SIZE))), height: lines.length * LINE_HEIGHT }
}

type Box = { node: FlowNode; width: number; height: number; x: number; y: number }

function nodeBox(node: FlowNode, measure: Measure): Box {
  const text = blockSize(node.lines, measure)
  let width = Math.max(text.width + 2 * PAD_X, 56)
  let height = text.height + 2 * PAD_Y
  if (node.shape === 'diamond') {
    width = width * 1.5
    height = height * 1.6
  } else if (node.shape === 'circle') width = height = Math.max(width, height)
  else if (node.shape === 'hexagon') width += 24
  else if (node.shape === 'cylinder') height += 12
  return { node, width, height, x: 0, y: 0 }
}

/**
 * Each node's rank, the longest path from a start: links that close a cycle do not count, so
 * a cycle still has an order.
 */
function ranksOf(chart: Flowchart): Map<string, number> {
  const out = new Map<string, string[]>(chart.nodes.map((node) => [node.id, []]))
  for (const edge of chart.edges) if (edge.from !== edge.to) out.get(edge.from)!.push(edge.to)
  const state = new Map<string, 'open' | 'done'>()
  const forward: [string, string][] = []
  const visit = (id: string): void => {
    state.set(id, 'open')
    for (const to of out.get(id)!) {
      if (state.get(to) === 'open') continue
      forward.push([id, to])
      if (!state.has(to)) visit(to)
    }
    state.set(id, 'done')
  }
  for (const node of chart.nodes) if (!state.has(node.id)) visit(node.id)
  const rank = new Map<string, number>(chart.nodes.map((node) => [node.id, 0]))
  for (let pass = 0; pass < chart.nodes.length; pass++) {
    let moved = false
    for (const [from, to] of forward) {
      if (rank.get(to)! < rank.get(from)! + 1) {
        rank.set(to, rank.get(from)! + 1)
        moved = true
      }
    }
    if (!moved) break
  }
  return rank
}

/** The nodes of each rank in an order that crosses few links: the mean place of their neighbours. */
function ordered(chart: Flowchart, rank: Map<string, number>): string[][] {
  const layers: string[][] = []
  for (const node of chart.nodes) (layers[rank.get(node.id)!] ||= []).push(node.id)
  const neighbours = (id: string, towards: number): string[] =>
    chart.edges.flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : [])).filter((other) => rank.get(other) === rank.get(id)! + towards)
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0
    const order = down ? layers.map((_layer, index) => index) : layers.map((_layer, index) => layers.length - 1 - index)
    for (const index of order.slice(1)) {
      const reference = layers[index + (down ? -1 : 1)] || []
      const place = (id: string): number => {
        const near = neighbours(id, down ? -1 : 1).map((other) => reference.indexOf(other)).filter((at) => at >= 0)
        return near.length ? near.reduce((sum, at) => sum + at, 0) / near.length : layers[index].indexOf(id)
      }
      const places = new Map(layers[index].map((id) => [id, place(id)]))
      layers[index] = [...layers[index]].sort((a, b) => places.get(a)! - places.get(b)!)
    }
  }
  return layers.map((layer) => layer || [])
}


/** Where the line from a box's centre towards `to` leaves the box. */
function border(box: Box, to: Point): Point {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const dx = to.x - cx
  const dy = to.y - cy
  if (!dx && !dy) return { x: cx, y: cy }
  if (box.node.shape === 'circle' || box.node.shape === 'diamond') {
    const rx = box.width / 2
    const ry = box.height / 2
    const scale = box.node.shape === 'circle' ? 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)) : 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
    return { x: cx + dx * scale, y: cy + dy * scale }
  }
  const scale = Math.min(Math.abs(dx) ? box.width / 2 / Math.abs(dx) : Infinity, Math.abs(dy) ? box.height / 2 / Math.abs(dy) : Infinity)
  return { x: cx + dx * scale, y: cy + dy * scale }
}

export type ColorScheme = 'light' | 'dark'

const PALETTES: Record<ColorScheme, { fill: string; stroke: string; text: string; edge: string; labelFill: string }> = {
  dark: { fill: '#2d3242', stroke: '#8b9cf7', text: '#e6e8ee', edge: '#9aa3b5', labelFill: '#262a35' },
  light: { fill: '#eef1fb', stroke: '#5b6bd6', text: '#1f2330', edge: '#6b7280', labelFill: '#ffffff' }
}

function textBlock(lines: readonly string[], cx: number, cy: number, color: string): Shape[] {
  const top = cy - (lines.length * LINE_HEIGHT) / 2 + LINE_HEIGHT / 2
  return lines.map((line, index) => ({ kind: 'text', x: cx, y: top + index * LINE_HEIGHT, text: line, size: FONT_SIZE, color }))
}

function nodeShapes(box: Box, colors: { fill: string; stroke: string }): Shape[] {
  const { x, y, width: w, height: h } = box
  const paint = { fill: colors.fill, stroke: { color: colors.stroke, width: 1.5 } }
  switch (box.node.shape) {
    case 'round':
      return [{ kind: 'rect', x, y, width: w, height: h, radius: 10, ...paint }]
    case 'stadium':
      return [{ kind: 'rect', x, y, width: w, height: h, radius: h / 2, ...paint }]
    case 'circle':
      return [{ kind: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...paint }]
    case 'diamond':
      return [{ kind: 'polygon', points: [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }], ...paint }]
    case 'hexagon':
      return [{ kind: 'polygon', points: [{ x: x + 12, y }, { x: x + w - 12, y }, { x: x + w, y: y + h / 2 }, { x: x + w - 12, y: y + h }, { x: x + 12, y: y + h }, { x, y: y + h / 2 }], ...paint }]
    case 'cylinder': {
      // The bottom rim, the body over its top half, the sides, then the open top.
      const ry = 6
      return [
        { kind: 'ellipse', cx: x + w / 2, cy: y + h - ry, rx: w / 2, ry, ...paint },
        { kind: 'rect', x, y: y + ry, width: w, height: h - 2 * ry, fill: colors.fill },
        { kind: 'path', commands: [{ op: 'M', x, y: y + ry }, { op: 'L', x, y: y + h - ry }], stroke: paint.stroke },
        { kind: 'path', commands: [{ op: 'M', x: x + w, y: y + ry }, { op: 'L', x: x + w, y: y + h - ry }], stroke: paint.stroke },
        { kind: 'ellipse', cx: x + w / 2, cy: y + ry, rx: w / 2, ry, ...paint }
      ]
    }
    case 'subroutine':
      return [
        { kind: 'rect', x, y, width: w, height: h, radius: 3, ...paint },
        { kind: 'path', commands: [{ op: 'M', x: x + 8, y }, { op: 'L', x: x + 8, y: y + h }], stroke: paint.stroke },
        { kind: 'path', commands: [{ op: 'M', x: x + w - 8, y }, { op: 'L', x: x + w - 8, y: y + h }], stroke: paint.stroke }
      ]
    default:
      return [{ kind: 'rect', x, y, width: w, height: h, radius: 4, ...paint }]
  }
}

/**
 * A Mermaid flowchart as a scene to draw, in the colors of Orca's scheme; null for anything
 * else. The panel is a narrow sidebar: a left-to-right chart that comes out over twice as wide
 * as tall is laid out top to bottom instead, or it would shrink until its text cannot be read.
 */
export function flowchartScene(code: string, scheme: ColorScheme, measure: Measure): Scene | null {
  const chart = parseFlowchart(code)
  if (!chart) return null
  const scene = layOut(chart, scheme, measure)
  if ((chart.direction === 'LR' || chart.direction === 'RL') && scene.width > 2 * scene.height && scene.width > 480) {
    return layOut({ ...chart, direction: chart.direction === 'LR' ? 'TB' : 'BT' }, scheme, measure)
  }
  return scene
}

function layOut(chart: Flowchart, scheme: ColorScheme, measure: Measure): Scene {
  const colors = PALETTES[scheme]
  const boxes = new Map(chart.nodes.map((node) => [node.id, nodeBox(node, measure)]))
  const rank = ranksOf(chart)
  const layers = ordered(chart, rank)
  const across = chart.direction === 'LR' || chart.direction === 'RL'
  // Along the ranks a node takes its width (left to right) or its height (top to bottom).
  const depth = (box: Box): number => (across ? box.width : box.height)
  const breadth = (box: Box): number => (across ? box.height : box.width)
  // The room between two ranks fits the text of the links that cross it.
  const gaps = layers.map(() => RANK_GAP)
  for (const edge of chart.edges) {
    if (!edge.lines.length) continue
    const low = Math.min(rank.get(edge.from)!, rank.get(edge.to)!)
    const size = blockSize(edge.lines, measure)
    gaps[low] = Math.max(gaps[low], (across ? size.width : size.height) + 40)
  }
  const layerDepth = layers.map((layer) => Math.max(0, ...layer.map((id) => depth(boxes.get(id)!))))
  const layerBreadth = layers.map((layer) => layer.reduce((sum, id) => sum + breadth(boxes.get(id)!), 0) + NODE_GAP * Math.max(0, layer.length - 1))
  const widest = Math.max(0, ...layerBreadth)
  let along = MARGIN
  layers.forEach((layer, index) => {
    let side = MARGIN + (widest - layerBreadth[index]) / 2
    for (const id of layer) {
      const box = boxes.get(id)!
      const centred = along + (layerDepth[index] - depth(box)) / 2
      if (across) {
        box.x = centred
        box.y = side
      } else {
        box.x = side
        box.y = centred
      }
      side += breadth(box) + NODE_GAP
    }
    along += layerDepth[index] + gaps[index]
  })
  const totalAlong = along - gaps[gaps.length - 1] + MARGIN
  const totalSide = widest + 2 * MARGIN
  const width = Math.ceil(across ? totalAlong : totalSide)
  const height = Math.ceil(across ? totalSide : totalAlong)
  // Right to left and bottom to top are the other two, mirrored.
  if (chart.direction === 'RL') for (const box of boxes.values()) box.x = width - box.x - box.width
  if (chart.direction === 'BT') for (const box of boxes.values()) box.y = height - box.y - box.height

  const centre = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  const links: Shape[] = []
  const labels: Shape[] = []
  for (const edge of chart.edges) {
    const from = boxes.get(edge.from)!
    const to = boxes.get(edge.to)!
    if (from === to) continue
    // A link back up the ranks, or past one, bends aside so it does not run over the others.
    const bend = rank.get(edge.to)! - rank.get(edge.from)! === 1 ? 0 : 48
    const a = centre(from)
    const b = centre(to)
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const control = { x: (a.x + b.x) / 2 - ((b.y - a.y) / length) * bend, y: (a.y + b.y) / 2 + ((b.x - a.x) / length) * bend }
    const start = border(from, bend ? control : b)
    const end = border(to, bend ? control : a)
    const stroke = { color: colors.edge, width: edge.style === 'thick' ? 3 : 1.5, ...(edge.style === 'dotted' ? { dash: [5, 4] } : {}) }
    const commands: PathCommand[] = bend
      ? [{ op: 'M', x: start.x, y: start.y }, { op: 'Q', cx: control.x, cy: control.y, x: end.x, y: end.y }]
      : [{ op: 'M', x: start.x, y: start.y }, { op: 'L', x: end.x, y: end.y }]
    links.push({ kind: 'path', commands, stroke, arrowStart: edge.arrowStart, arrowEnd: edge.arrowEnd })
    if (edge.lines.length) {
      const size = blockSize(edge.lines, measure)
      // The middle of the curve, or of the line.
      const mid = bend ? { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 } : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      labels.push({ kind: 'rect', x: mid.x - size.width / 2 - 6, y: mid.y - size.height / 2 - 3, width: size.width + 12, height: size.height + 6, radius: 4, fill: colors.labelFill })
      labels.push(...textBlock(edge.lines, mid.x, mid.y, colors.text))
    }
  }
  const nodes = [...boxes.values()].flatMap((box) => [...nodeShapes(box, colors), ...textBlock(box.node.lines, centre(box).x, centre(box).y, colors.text)])
  return { width, height, shapes: [...links, ...nodes, ...labels] }
}
