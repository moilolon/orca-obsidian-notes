// Turns an Obsidian note into what Orca's Markdown component can draw. No imports: the panel
// loads this file, and panels cannot reach Node. The worker reads it too, for the backlinks.

export type CalloutTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export type HeadingLevel = 1 | 2 | 3 | 4

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'heading'; level: HeadingLevel; text: string; markdown: string }
  | { kind: 'callout'; tone: CalloutTone; title: string; text: string }
  /** An image on a line of its own: `target` is a file name or a vault path, for the worker. */
  | { kind: 'image'; target: string; alt: string }

/** The image files the panel shows in a note, by extension. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']

export function isImageName(name: string): boolean {
  const extension = (name.split('.').pop() || '').toLowerCase()
  return name.includes('.') && IMAGE_EXTENSIONS.includes(extension)
}

/** A note the text links to: what the button reads and the target the worker resolves. */
export type NoteLink = { label: string; target: string }

/** A front matter property: `value` as the panel lists it, lists joined with commas; `values` one by one. */
export type Property = { label: string; value: string; values: string[] }

/** A folder on the way to a note: its name and its vault path. */
export type Crumb = { label: string; path: string }

/** The folders a note sits in, outermost first: `A/B/note.md` gives `A` and `A/B`. */
export function folderCrumbs(notePath: string): Crumb[] {
  const folders = notePath.split('/').slice(0, -1)
  return folders.map((label, index) => ({ label, path: folders.slice(0, index + 1).join('/') }))
}

/**
 * The note's title and the segments under it: a `#` heading that opens the note is its title,
 * so it is not drawn twice; otherwise the file name is.
 */
export function splitTitle(segments: readonly Segment[], fileTitle: string): { title: string; body: Segment[] } {
  const [first, ...rest] = segments
  if (first && first.kind === 'heading' && first.level === 1) return { title: first.text, body: rest }
  return { title: fileTitle, body: [...segments] }
}

/** The note's tags (Obsidian's `tags` or `tag` property, `#` dropped) and its other properties. */
export function splitTags(properties: readonly Property[]): { tags: string[]; others: Property[] } {
  const isTags = (property: Property): boolean => /^tags?$/i.test(property.label)
  const tags = properties.filter(isTags).flatMap((property) => property.values.flatMap((value) => value.split(/[\s,]+/)))
  return {
    tags: [...new Set(tags.map((tag) => tag.replace(/^#/, '')).filter(Boolean))],
    others: properties.filter((property) => !isTags(property))
  }
}

/** Where the Markdown is split when it can be: at the next blank line past this many characters. */
const MAX_CHUNK_CHARS = 6000
/** Orca refuses a text over 16 KiB: past this many UTF-8 bytes a piece is cut at any line. */
const MAX_CHUNK_BYTES = 15000
const MAX_PROPERTY_CHARS = 200

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/
const FRONT_MATTER_BODY = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const WIKILINK = /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g
/** `[text](note.md)` and `[text](<a note.md>)`, with an optional title after the address. */
const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g
const INLINE_CODE = /(`+)[\s\S]*?\1/g
const CALLOUT_START = /^>\s*\[!([A-Za-z-]+)\][+-]?\s*(.*)$/
const QUOTE_LINE = /^>\s?/
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const TABLE_LINE = /^\s*\|/
const TABLE_RULE = /^\s*\|?\s*:?-{3,}/
/** Inline Markdown a plain-text heading cannot show: emphasis, code and link brackets. */
const INLINE_MARKS = /\*\*|__|\*|`|\[|\]\([^)]*\)|\]/g

const CALLOUT_TONES: Record<string, CalloutTone> = {
  note: 'accent',
  info: 'accent',
  abstract: 'accent',
  summary: 'accent',
  todo: 'accent',
  question: 'accent',
  tip: 'success',
  hint: 'success',
  success: 'success',
  check: 'success',
  done: 'success',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  danger: 'danger',
  error: 'danger',
  failure: 'danger',
  bug: 'danger',
  quote: 'neutral',
  example: 'neutral'
}

/**
 * The open code fence after `line`, given the one open before it (null outside code). A fence
 * closes only with the same character, at least as many times, and nothing after it.
 */
export function fenceAfter(line: string, open: string | null): string | null {
  const match = FENCE.exec(line)
  if (!match) return open
  const marker = match[1]
  if (open === null) return marker
  const closes = marker[0] === open[0] && marker.length >= open.length && match[2].trim() === ''
  return closes ? null : open
}

/** The note without its YAML front matter. */
export function stripFrontMatter(text: string): string {
  return text.replace(FRONT_MATTER, '')
}

function unquoted(value: string): string {
  const trimmed = value.trim()
  const quoted = /^(["']).*\1$/.test(trimmed)
  return (quoted ? trimmed.slice(1, -1) : trimmed).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_whole, target: string, alias?: string) => alias || target)
}

/**
 * The front matter's properties, in order: `key: value`, `key: [a, b]` and `key:` followed by
 * `- item` lines. Nested maps and multi-line strings are left out; so are empty values.
 */
export function frontMatterProperties(text: string): Property[] {
  const match = FRONT_MATTER_BODY.exec(text)
  if (!match) return []
  const found: { label: string; values: string[] }[] = []
  let current: { label: string; values: string[] } | null = null
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([^\s#:-][^:]*):(?:\s+(.*))?$/.exec(line)
    if (pair) {
      const raw = (pair[2] || '').trim()
      const values = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1).split(',') : raw ? [raw] : []
      current = { label: pair[1].trim(), values: values.map(unquoted).filter(Boolean) }
      found.push(current)
      continue
    }
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && current) current.values.push(unquoted(item[1]))
    else if (!/^\s/.test(line)) current = null
  }
  return found
    .filter((property) => property.values.some(Boolean))
    .map((property) => {
      const value = property.values.filter(Boolean).join(', ')
      return { label: property.label, value: value.length > MAX_PROPERTY_CHARS ? `${value.slice(0, MAX_PROPERTY_CHARS)}…` : value, values: property.values.filter(Boolean) }
    })
}

/** The text without Obsidian's `%% comments %%`, inline or over several lines; code keeps them. */
export function stripComments(text: string): string {
  const kept: string[] = []
  let fence: string | null = null
  let inComment = false
  for (const line of text.split('\n')) {
    if (!inComment) {
      const next = fenceAfter(line, fence)
      if (fence !== null || next !== null) {
        kept.push(line)
        fence = next
        continue
      }
    }
    if (!inComment && !line.includes('%%')) {
      kept.push(line)
      continue
    }
    const parts = line.split('%%')
    let out = ''
    parts.forEach((part, index) => {
      if (index > 0) inComment = !inComment
      if (!inComment) out += part
    })
    // A line that was only a comment goes, rather than leaving a blank line behind.
    if (out.trim() || (!line.trim() && !inComment)) kept.push(out)
  }
  return kept.join('\n')
}

/** Runs `change` over the parts of a line that are not inline code, and joins them back. */
function mapOutsideCode(line: string, change: (prose: string) => string): string {
  let out = ''
  let last = 0
  for (const match of line.matchAll(INLINE_CODE)) {
    out += change(line.slice(last, match.index)) + match[0]
    last = (match.index || 0) + match[0].length
  }
  return out + change(line.slice(last))
}

/** Every line's prose, code fences and inline code left out: where links and marks count. */
function eachProse(text: string, visit: (prose: string) => void): void {
  let fence: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const next = fenceAfter(line, fence)
    const inCode = fence !== null || next !== null
    fence = next
    if (!inCode) mapOutsideCode(line, (prose) => (visit(prose), prose))
  }
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** The note path a Markdown link's address names, or null for a web address or another file. */
function markdownNoteAddress(address: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) return null
  const path = safeDecode(address.split('#')[0])
  return path.toLowerCase().endsWith('.md') ? path : null
}

/** The vault path a relative Markdown link from `from` leads to; `/` starts at the vault root. */
export function joinNotePath(from: string, address: string): string {
  const parts = address.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const part of address.replace(/^\/+/, '').split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

function noteTitleOf(path: string): string {
  return (path.split('/').pop() || path).replace(/\.md$/i, '')
}

/** `[[note|alias]]` as bold text (the panel lists the links below the note); embeds as a note. */
export function replaceWikilinks(text: string): string {
  return text.replace(WIKILINK, (_whole, embed: string, target: string, heading: string | undefined, alias: string | undefined) => {
    const shown = (alias || target + (heading || '')).trim()
    return embed === '!' ? `*(${shown})*` : `**${shown}**`
  })
}

/** Both kinds of note link as bold text: `[[wikilinks]]` and `[text](note.md)`. Web links stay. */
export function replaceNoteLinks(text: string): string {
  return replaceWikilinks(text).replace(MARKDOWN_LINK, (whole, embed: string, label: string, angled?: string, bare?: string) => {
    const path = markdownNoteAddress(angled || bare || '')
    if (path === null) return whole
    const shown = label.trim() || noteTitleOf(path)
    return embed === '!' ? `*(${shown})*` : `**${shown}**`
  })
}

/**
 * The distinct notes a note links to, in order: `[[wikilinks]]` by their target, Markdown links
 * as the vault path they lead to from `notePath`. Embeds, code and comments are left out.
 */
export function noteLinks(text: string, notePath: string): NoteLink[] {
  const links: NoteLink[] = []
  const seen = new Set<string>()
  const add = (label: string, target: string): void => {
    const key = target.toLowerCase()
    if (!target || seen.has(key)) return
    seen.add(key)
    links.push({ label, target })
  }
  eachProse(stripComments(stripFrontMatter(text)), (prose) => {
    for (const match of prose.matchAll(WIKILINK)) {
      if (match[1] !== '!') add(match[2].trim(), match[2].trim())
    }
    for (const match of prose.matchAll(MARKDOWN_LINK)) {
      const path = markdownNoteAddress(match[3] || match[4] || '')
      if (match[1] !== '!' && path !== null) add(match[2].trim() || noteTitleOf(path), joinNotePath(notePath, path))
    }
  })
  return links
}

function calloutTone(type: string): CalloutTone {
  return CALLOUT_TONES[type.toLowerCase()] || 'neutral'
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/** The text's size in UTF-8, the measure Orca's limit uses. */
export function utf8Length(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code < 0xdc00) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/** A line too long for any piece, cut into lines that fit. */
function splitLongLine(line: string, maxBytes: number): string[] {
  if (utf8Length(line) <= maxBytes) return [line]
  const pieces: string[] = []
  let piece = ''
  for (const char of line) {
    if (utf8Length(piece) + utf8Length(char) > maxBytes) {
      pieces.push(piece)
      piece = ''
    }
    piece += char
  }
  return piece ? [...pieces, piece] : pieces
}

/** The header and rule of the table `current` ends in, when `line` carries that table on. */
function openTableHeader(current: readonly string[], line: string): string[] {
  if (!TABLE_LINE.test(line)) return []
  let start = current.length
  while (start > 0 && TABLE_LINE.test(current[start - 1])) start--
  const table = current.slice(start)
  return table.length >= 2 && TABLE_RULE.test(table[1]) ? table.slice(0, 2) : []
}

/**
 * Splits long Markdown so each piece fits Orca's limit: at blank lines outside code fences when
 * it can; at any line past `maxBytes`, closing an open fence and opening it again in the next
 * piece, and repeating an open table's header.
 */
export function chunkMarkdown(text: string, maxChars: number = MAX_CHUNK_CHARS, maxBytes: number = MAX_CHUNK_BYTES): string[] {
  if (text.length <= maxChars && utf8Length(text) <= maxBytes) return text.trim() ? [text] : []
  const chunks: string[] = []
  let current: string[] = []
  let size = 0
  let bytes = 0
  let fence: string | null = null
  let fenceLine = ''
  const push = (line: string): void => {
    current.push(line)
    size += line.length + 1
    bytes += utf8Length(line) + 1
  }
  const flush = (): void => {
    if (current.join('').trim()) chunks.push(current.join('\n'))
    current = []
    size = 0
    bytes = 0
  }
  for (const whole of text.split('\n')) {
    for (const line of splitLongLine(whole, Math.floor(maxBytes / 2))) {
      if (current.length && bytes + utf8Length(line) + 1 > maxBytes) {
        const header = fence === null ? openTableHeader(current, line) : []
        if (fence !== null) push(fence)
        flush()
        if (fence !== null) push(fenceLine)
        header.forEach(push)
      }
      const next = fenceAfter(line, fence)
      if (fence === null && next !== null) fenceLine = line
      const canBreak = fence === null && next === null && line.trim() === '' && size >= maxChars
      fence = next
      if (canBreak) {
        flush()
        continue
      }
      push(line)
    }
  }
  flush()
  return chunks
}

export type SectionTone = 'accent' | 'success' | 'warning' | 'danger'

/** The colors `##` sections take in turn, so neighbouring sections never share one. */
export const SECTION_TONES: readonly SectionTone[] = ['accent', 'success', 'warning', 'danger']

/**
 * The color of the section each segment belongs to: every `##` heading starts the next color,
 * and what comes before the first one reads as the first color.
 */
export function sectionTones(segments: readonly Segment[]): SectionTone[] {
  let section = -1
  return segments.map((segment) => {
    if (segment.kind === 'heading' && segment.level === 2) section++
    return SECTION_TONES[Math.max(section, 0) % SECTION_TONES.length]
  })
}

/** A Markdown heading as plain text, its inline marks dropped. */
export function headingText(raw: string): string {
  return raw.replace(INLINE_MARKS, '').trim()
}

/** `#` to `###` keep their level; `####` and deeper are level 4: Orca text has no smaller step. */
function headingLevel(hashes: string): HeadingLevel {
  return Math.min(hashes.length, 4) as HeadingLevel
}

const IMAGE_EMBED_LINE = /^\s*!\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]\s*$/
const IMAGE_MARKDOWN_LINE = /^\s*!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)\s*$/

/**
 * The image a line holds on its own: `![[pic.png]]` by its name (Obsidian looks it up in the whole
 * vault), `![alt](pic.png)` as the vault path it leads to from `notePath`. Null for anything else.
 */
export function imageOnLine(line: string, notePath: string): { target: string; alt: string } | null {
  const embed = IMAGE_EMBED_LINE.exec(line)
  if (embed) {
    const target = embed[1].trim()
    // `![[pic.png|300]]` gives a width, not a caption.
    const alt = embed[2] && !/^\d+(x\d+)?$/.test(embed[2].trim()) ? embed[2].trim() : target
    return isImageName(target) ? { target, alt } : null
  }
  const markdown = IMAGE_MARKDOWN_LINE.exec(line)
  if (!markdown) return null
  const address = markdown[2] || markdown[3] || ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) return null
  const path = safeDecode(address.split('#')[0])
  return isImageName(path) ? { target: joinNotePath(notePath, path), alt: markdown[1].trim() || path.split('/').pop() || path } : null
}

/** A prose line with its note links as bold text; inline code stays as written. */
function proseLine(line: string): string {
  return mapOutsideCode(line, replaceNoteLinks)
}

/**
 * The note body as Markdown pieces, headings and Obsidian callouts, in order. Headings are
 * their own segments so the panel can draw them with Orca's heading and space the sections.
 * Front matter and comments are dropped; code is shown as written. An image on a line of its own
 * is a segment too, its Markdown path read from `notePath`.
 */
export function noteSegments(text: string, notePath: string = ''): Segment[] {
  const body = stripComments(stripFrontMatter(text))
  const segments: Segment[] = []
  let pending: string[] = []
  let fence: string | null = null
  const flushMarkdown = (): void => {
    for (const chunk of chunkMarkdown(pending.join('\n'))) segments.push({ kind: 'markdown', text: chunk })
    pending = []
  }
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const next = fenceAfter(lines[i], fence)
    const inCode = fence !== null || next !== null
    fence = next
    if (inCode) {
      pending.push(lines[i])
      continue
    }
    const image = imageOnLine(lines[i], notePath)
    if (image) {
      flushMarkdown()
      segments.push({ kind: 'image', ...image })
      continue
    }
    const line = proseLine(lines[i])
    const heading = HEADING.exec(line)
    if (heading) {
      flushMarkdown()
      const level = headingLevel(heading[1])
      segments.push({ kind: 'heading', level, text: headingText(heading[2]), markdown: `${'#'.repeat(level)} ${heading[2]}` })
      continue
    }
    const start = CALLOUT_START.exec(line)
    if (!start) {
      pending.push(line)
      continue
    }
    flushMarkdown()
    const inner: string[] = []
    while (i + 1 < lines.length && QUOTE_LINE.test(lines[i + 1])) {
      i++
      inner.push(proseLine(lines[i].replace(QUOTE_LINE, '')))
    }
    segments.push({
      kind: 'callout',
      tone: calloutTone(start[1]),
      // A callout's title is plain text: the bold of a link would show as asterisks.
      title: headingText(start[2]) || capitalized(start[1]),
      text: inner.join('\n')
    })
  }
  flushMarkdown()
  return segments
}
