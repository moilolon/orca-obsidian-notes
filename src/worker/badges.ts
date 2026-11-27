// README badges (`[![Obsidian](https://img.shields.io/badge/Obsidian-7C3AED?style=for-the-badge)](…)`)
// laid out as a scene the worker draws into a PNG, with nothing downloaded: a shields.io address
// carries their text and colors, and Orca shows no web image.
import type { Scene, Shape } from './raster'

export type Badge = { label: string; message: string; color: string; labelColor: string; large: boolean }

/** shields.io's named colors. */
const NAMED: Record<string, string> = {
  brightgreen: '#44cc11',
  green: '#97ca00',
  yellowgreen: '#a4a61d',
  yellow: '#dfb317',
  orange: '#fe7d37',
  red: '#e05d44',
  blue: '#007ec6',
  grey: '#555555',
  gray: '#555555',
  lightgrey: '#9f9f9f',
  lightgray: '#9f9f9f',
  blueviolet: '#8a2be2',
  success: '#44cc11',
  important: '#fe7d37',
  critical: '#e05d44',
  informational: '#007ec6',
  inactive: '#9f9f9f'
}
const DEFAULT_COLOR = '#007ec6'
const DEFAULT_LABEL_COLOR = '#555555'

function colorOf(raw: string | null | undefined, fallback: string): string {
  const value = (raw || '').trim().toLowerCase()
  if (NAMED[value]) return NAMED[value]
  if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/.test(value)) return value.startsWith('#') ? value : `#${value}`
  return fallback
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** A shields.io part: `__` is `_`, `_` a space, `--` a dash. */
function shieldsText(part: string): string {
  return safeDecode(part).replace(/__/g, '\u0000').replace(/_/g, ' ').replace(/\u0000/g, '_').replace(/--/g, '-')
}

/**
 * The badge an image draws: a static shields.io badge as it would look (its text, colors and
 * size); any other badge address as its alt text on grey, as its own service cannot be asked.
 */
export function badgeOf(alt: string, url: string): Badge {
  let address: URL | null = null
  try {
    address = new URL(url)
  } catch {
    address = null
  }
  const large = address?.searchParams.get('style') === 'for-the-badge'
  const match = address && /^\/badge\/(.+)$/.exec(address.pathname)
  if (address && address.hostname === 'img.shields.io' && match) {
    // `label-message-color` or `message-color`: dashes split it, `--` stays a dash.
    const parts = match[1].replace(/--/g, '\u0001').split('-').map((part) => part.replace(/\u0001/g, '--'))
    const color = parts.length > 1 ? parts.pop()! : ''
    const message = parts.length > 1 ? parts.pop()! : parts.pop() || ''
    const label = parts.join('-')
    return {
      label: shieldsText(label),
      message: shieldsText(message),
      color: colorOf(address.searchParams.get('color') || color, DEFAULT_COLOR),
      labelColor: colorOf(address.searchParams.get('labelColor'), DEFAULT_LABEL_COLOR),
      large
    }
  }
  return { label: '', message: alt.trim() || 'badge', color: DEFAULT_LABEL_COLOR, labelColor: DEFAULT_LABEL_COLOR, large }
}

/** Light backgrounds take dark text, as shields.io does. */
function textColor(background: string): string {
  const hex = background.replace('#', '')
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.65 ? '#333333' : '#ffffff'
}

/** How wide a line of text is, in pixels: the worker measures with the font it draws with. */
export type Measure = (text: string, size: number, bold: boolean, spacing: number) => number

/** The panel's usual width: the badges wrap at it, so they are drawn about their own size. */
export const ROW_WIDTH = 400
const GAP = 6

/**
 * Badges side by side, wrapping onto new rows at `ROW_WIDTH`, each row centred when `centre`.
 * The scene is as wide as its widest row.
 */
export function badgesScene(badges: readonly Badge[], measure: Measure, centre: boolean = false): Scene {
  type Placed = { badge: Badge; label: string; message: string; labelWidth: number; messageWidth: number; width: number; height: number }
  const rows: Placed[][] = [[]]
  let x = 0
  for (const badge of badges) {
    const size = badge.large ? 10 : 11
    const spacing = badge.large ? 1.2 : 0
    const pad = badge.large ? 12 : 6
    const label = badge.large ? badge.label.toUpperCase() : badge.label
    const message = badge.large ? badge.message.toUpperCase() : badge.message
    const labelWidth = label ? measure(label, size, badge.large, spacing) + 2 * pad : 0
    const messageWidth = measure(message, size, badge.large, spacing) + 2 * pad
    const width = Math.ceil(labelWidth + messageWidth)
    if (x > 0 && x + width > ROW_WIDTH) {
      rows.push([])
      x = 0
    }
    rows[rows.length - 1].push({ badge, label, message, labelWidth, messageWidth, width, height: badge.large ? 28 : 20 })
    x += width + GAP
  }
  const rowWidth = (row: Placed[]): number => row.reduce((sum, item) => sum + item.width, 0) + GAP * Math.max(0, row.length - 1)
  const width = Math.max(1, ...rows.map(rowWidth))
  const shapes: Shape[] = []
  let y = 0
  for (const row of rows) {
    let left = centre ? (width - rowWidth(row)) / 2 : 0
    const rowHeight = Math.max(0, ...row.map((item) => item.height))
    for (const item of row) {
      const { badge, height } = item
      const top = y + (rowHeight - height) / 2
      const radius = badge.large ? 0 : 3
      const size = badge.large ? 10 : 11
      const spacing = badge.large ? 1.2 : 0
      // The whole badge in the message color, then the label over its left part.
      shapes.push({ kind: 'rect', x: left, y: top, width: item.width, height, radius, fill: badge.color })
      if (item.label) {
        shapes.push({ kind: 'rect', x: left, y: top, width: item.labelWidth + radius, height, radius, fill: badge.labelColor })
        if (radius) shapes.push({ kind: 'rect', x: left + item.labelWidth, y: top, width: radius, height, fill: badge.color })
        shapes.push({ kind: 'text', x: left + item.labelWidth / 2, y: top + height / 2, text: item.label, size, color: textColor(badge.labelColor), bold: badge.large, spacing })
      }
      shapes.push({ kind: 'text', x: left + item.labelWidth + item.messageWidth / 2, y: top + height / 2, text: item.message, size, color: textColor(badge.color), bold: badge.large, spacing })
      left += item.width + GAP
    }
    y += rowHeight + GAP
  }
  return { width, height: Math.max(1, y - GAP), shapes }
}
