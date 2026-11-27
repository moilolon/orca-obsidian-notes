// Turns an Obsidian note into what Orca's Markdown component can draw. No imports: the panel
// loads this file, and panels cannot reach Node. The worker reads it too, for the backlinks.

export type CalloutTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export type HeadingLevel = 1 | 2 | 3 | 4

/** How an HTML block (`<div align="center">`) lines up what it holds; left when unset. */
export type Align = 'center' | 'right'

export type Segment =
  /** `images`: the vault images it shows, which the panel points at their copies in the plugin. */
  | { kind: 'markdown'; text: string; images?: InlineImage[]; align?: Align }
  /** `icon`: a vault image before the text, as READMEs open (`# <img src="icon.png"> Name`). */
  | { kind: 'heading'; level: HeadingLevel; text: string; markdown: string; icon?: string; align?: Align }
  | { kind: 'callout'; tone: CalloutTone; title: string; text: string }
  /** An image on a line of its own: `target` is a file name or a vault path, for the worker. */
  | { kind: 'image'; target: string; alt: string; width?: number; align?: Align }
  /** Links to files on lines of their own, which the panel draws as rows that open them. */
  | { kind: 'files'; items: NoteLink[] }
  /**
   * A paragraph that links to notes or files, as runs the panel draws itself: Orca's Markdown
   * opens web addresses only, so a link to a note in it would be text that does nothing.
   */
  | { kind: 'rich'; runs: Inline[] }
  /** A list with such links in it, each item as runs; `marker` is its bullet or its number. */
  | { kind: 'list'; items: ListLine[] }
  /** README badges on lines of their own, web images the worker draws from their addresses. */
  | { kind: 'badges'; items: BadgeImage[]; align?: Align }
  /** A ```mermaid block: `code` for the worker to draw, `markdown` the block as written, shown when it cannot. */
  | { kind: 'diagram'; code: string; markdown: string }
  /** Task lines in a row, which the panel draws itself: Orca's Markdown adds a bullet to each. */
  | { kind: 'tasks'; items: Task[] }

/** Obsidian's task statuses: `[ ]`, `[x]`, `[-]` and `[/]`; any other mark is still to do. */
export type TaskStatus = 'todo' | 'done' | 'cancelled' | 'doing'

/**
 * An image inside Markdown text, as written in `src`: a vault image (`target` its vault path),
 * or a web image (the panel leaves it out: Orca shows none).
 */
export type InlineImage = { src: string; alt: string; target?: string }

/** A badge: a web image on a line of badges. */
export type BadgeImage = { alt: string; url: string }

/** A piece of a line of text: plain, bold or code text, or a link to the web, a note or a file. */
export type Inline =
  | { kind: 'text'; text: string; bold?: boolean; code?: boolean }
  | { kind: 'link'; text: string; href: string }
  /** `target`: what the worker resolves, a wikilink's target or a vault path. */
  | { kind: 'note'; text: string; target: string }
  | { kind: 'file'; text: string; target: string }

/** A list item: how deep it is nested (0 at the left), its bullet or number, and its text. */
export type ListLine = { level: number; marker: string; runs: Inline[] }

/** A task line: how deep it is nested (0 at the left), its status and its text as Markdown. */
export type Task = { level: number; status: TaskStatus; text: string }

/** The image files the panel shows in a note, by extension. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']

export function isImageName(name: string): boolean {
  const extension = (name.split('.').pop() || '').toLowerCase()
  return name.includes('.') && IMAGE_EXTENSIONS.includes(extension)
}

/** A note the text links to: what the button reads and the target the worker resolves. */
export type NoteLink = { label: string; target: string }

/** A front matter property: `value` as the panel lists it, lists joined with commas; `values` one by one. */
export type Property = {
  label: string
  value: string
  values: string[]
  /** Set when every value links to a file other than a note (`attachments: "[[plan.docx]]"`): the panel draws them as rows that open them. */
  files?: NoteLink[]
}

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
export function splitTitle(segments: readonly Segment[], fileTitle: string): { title: string; icon?: string; align?: Align; body: Segment[] } {
  const [first, ...rest] = segments
  if (first && first.kind === 'heading' && first.level === 1) {
    return { title: first.text, ...(first.icon ? { icon: first.icon } : {}), ...(first.align ? { align: first.align } : {}), body: rest }
  }
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

/**
 * A piece of a note as plain text, for a search hit: its Markdown marks dropped, links and
 * wikilinks as their text. The piece may start or end mid-mark, so half a link goes too.
 */
export function plainSnippet(snippet: string): string {
  return snippet
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)?/g, '$1')
    .replace(/\]\([^)]*\)?/g, '')
    .replace(/(^|\s)#{1,6}\s/g, '$1')
    .replace(/(^|\s)[-*+]\s\[.\]\s/g, '$1')
    .replace(/\*\*|__|~~|`|\[\[|\]\]|[[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A note's tags, lower case and each once: those of its `tags` property. A `#word` in the text
 * is not counted: it is as often an anchor, a number or part of an address as a tag.
 */
export function noteTags(text: string): string[] {
  return [...new Set(splitTags(frontMatterProperties(text)).tags.map((tag) => tag.toLowerCase()))]
}

/** Where the Markdown is split when it can be: at the next blank line past this many characters. */
const MAX_CHUNK_CHARS = 6000
/** Orca refuses a text over 16 KiB: past this many UTF-8 bytes a piece is cut at any line. */
const MAX_CHUNK_BYTES = 15000
/** Past this many characters a property does not fit a row of the list: the panel draws it under the list, whole. */
export const LONG_PROPERTY_CHARS = 120

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/
const FRONT_MATTER_BODY = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
/** A target may hold a lone `]`, as in `[[[V] Hours.json]]`: only `]]` ends it. */
const WIKILINK = /(!?)\[\[((?:[^\]|#]|\](?!\]))+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g
/** `[text](note.md)` and `[text](<a note.md>)`, with an optional title after the address. */
const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g
const INLINE_CODE = /(`+)[\s\S]*?\1/g
const CALLOUT_START = /^>\s*\[!([A-Za-z-]+)\][+-]?\s*(.*)$/
const QUOTE_LINE = /^>\s?/
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/
const MERMAID_FENCE = /^\s*(`{3,}|~{3,})\s*mermaid\s*$/i
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
/** `- [ ] task`, any bullet and indent. */
const TASK = /^([ \t]*)[-*+]\s+\[(.)\]\s+(.*)$/
const TASK_STATUSES: Record<string, TaskStatus> = { x: 'done', X: 'done', '-': 'cancelled', '/': 'doing' }

/** A task line's level (a tab or two spaces each), status and text; null for any other line. */
export function taskOnLine(line: string): Task | null {
  const task = TASK.exec(line)
  if (!task) return null
  return {
    level: Math.floor(task[1].replace(/\t/g, '  ').length / 2),
    status: TASK_STATUSES[task[2]] || 'todo',
    text: task[3].trim()
  }
}

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
  // `raw`: the values as written, to tell a link to a file from its name as text.
  const found: { label: string; raw: string[] }[] = []
  let current: { label: string; raw: string[] } | null = null
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([^\s#:-][^:]*):(?:\s+(.*))?$/.exec(line)
    if (pair) {
      const raw = (pair[2] || '').trim()
      // `[a, b]` is a list; `[[file]]` alone is one link, not a list of a list.
      const isList = raw.startsWith('[') && raw.endsWith(']') && !/^\[\[[^\]]*\]\]$/.test(raw)
      current = { label: pair[1].trim(), raw: isList ? raw.slice(1, -1).split(',') : raw ? [raw] : [] }
      found.push(current)
      continue
    }
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && current) current.raw.push(item[1])
    else if (!/^\s/.test(line)) current = null
  }
  return found
    .map((property) => ({ label: property.label, raw: property.raw.filter((value) => unquoted(value)) }))
    .filter((property) => property.raw.length)
    .map((property) => {
      const values = property.raw.map(unquoted)
      const files = property.raw.map(propertyFile)
      const all = files.filter((file): file is NoteLink => file !== null)
      return { label: property.label, value: values.join(', '), values, ...(all.length === files.length ? { files: all } : {}) }
    })
}

/** The file other than a note a property value links to, `[[plan.docx]]` or `[[plan.docx|The plan]]`, quoted or not; null for anything else. */
function propertyFile(raw: string): NoteLink | null {
  const link = /^\s*["']?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]["']?\s*$/.exec(raw)
  if (!link) return null
  const target = link[1].trim()
  return isAttachmentName(target) ? { label: (link[2] || '').trim() || target.split('/').pop() || target, target } : null
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

/** A file name with an extension other than `.md`, such as `hours.json`: a file, not a note. */
function isAttachmentName(name: string): boolean {
  const extension = /\.([a-z][a-z0-9]{0,4})$/i.exec(name)
  return extension !== null && extension[1].toLowerCase() !== 'md'
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
      if (match[1] !== '!' && !isAttachmentName(match[2].trim())) add(match[2].trim(), match[2].trim())
    }
    for (const match of prose.matchAll(MARKDOWN_LINK)) {
      const path = markdownNoteAddress(match[3] || match[4] || '')
      if (match[1] !== '!' && path !== null) add(match[2].trim() || noteTitleOf(path), joinNotePath(notePath, path))
    }
  })
  return links
}

/** The local file other than a note a Markdown link's address names; null for a web address or a note. */
function markdownFileAddress(address: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) return null
  const path = safeDecode(address.split('#')[0])
  return isAttachmentName(path) ? path : null
}

/**
 * The distinct files other than notes a note links to or embeds, in order (`[[hours.json]]`,
 * `![[plan.pdf]]`, `[plan](files/plan.pdf)`): wikilinks by their target, which the worker looks
 * up as Obsidian does, Markdown links as the vault path they lead to. Embedded images are left
 * out, since the note draws them; so are code and comments.
 */
export function fileLinks(text: string, notePath: string): NoteLink[] {
  const links: NoteLink[] = []
  const seen = new Set<string>()
  eachProse(stripComments(stripFrontMatter(text)), (prose) => {
    // A line of file links alone is drawn where it is, as rows that open them.
    if (fileLineLinks(prose, notePath)) return
    for (const link of fileLinksIn(prose, notePath).links) {
      const key = link.target.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      links.push(link)
    }
  })
  return links
}

/** The file links in a piece of prose, in order, and the prose with them taken out. */
function fileLinksIn(prose: string, notePath: string): { links: NoteLink[]; rest: string } {
  const found: { at: number; link: NoteLink }[] = []
  let rest = prose.replace(WIKILINK, (whole, embed: string, rawTarget: string, _heading: string | undefined, alias: string | undefined, at: number) => {
    const target = rawTarget.trim()
    if (!isAttachmentName(target) || (embed === '!' && isImageName(target))) return whole
    found.push({ at, link: { label: (alias || '').trim() || target.split('/').pop() || target, target } })
    return ''
  })
  rest = rest.replace(MARKDOWN_LINK, (whole, embed: string, label: string, angled: string | undefined, bare: string | undefined) => {
    const path = markdownFileAddress(angled || bare || '')
    if (path === null || (embed === '!' && isImageName(path))) return whole
    found.push({ at: Infinity, link: { label: label.trim() || path.split('/').pop() || path, target: joinNotePath(notePath, path) } })
    return ''
  })
  return { links: found.sort((a, b) => a.at - b.at).map((item) => item.link), rest }
}

/**
 * The files a line links to when it holds nothing else (`![[hours.json]]`, `- [[plan.pdf]]`):
 * the panel draws them there as rows that open them, since Orca's Markdown cannot open a file.
 * Null for any other line.
 */
export function fileLineLinks(line: string, notePath: string): NoteLink[] | null {
  const { links, rest } = fileLinksIn(line, notePath)
  return links.length && !rest.replace(/^\s*(?:[-*+]|\d+[.)])\s/, '').replace(/[\s,;·|]/g, '') ? links : null
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

/**
 * The section each segment belongs to, from 0: every `##` heading starts the next one, and
 * what comes before the first heading counts as section 0.
 */
export function sectionIndexes(segments: readonly Segment[]): number[] {
  let section = -1
  return segments.map((segment) => {
    if (segment.kind === 'heading' && segment.level === 2) section++
    return Math.max(section, 0)
  })
}

/**
 * A section's own color, as `#rrggbb`: the hue turns by the golden angle from one section to
 * the next, so no two sections of a note share a color however many it has, and neighbours
 * are far apart. Orca's four tones would repeat from the fifth section on.
 */
export function sectionColor(index: number, scheme: 'light' | 'dark'): string {
  const hue = (225 + index * 137.508) % 360
  const saturation = scheme === 'dark' ? 0.7 : 0.62
  const lightness = scheme === 'dark' ? 0.66 : 0.46
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const [r, g, b] = hue < 60 ? [chroma, second, 0] : hue < 120 ? [second, chroma, 0] : hue < 180 ? [0, chroma, second] : hue < 240 ? [0, second, chroma] : hue < 300 ? [second, 0, chroma] : [chroma, 0, second]
  const hex = (value: number): string => Math.round((value + lightness - chroma / 2) * 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** A Markdown heading as plain text, its inline marks dropped. */
export function headingText(raw: string): string {
  return raw.replace(INLINE_MARKS, '').trim()
}

/** `#` to `###` keep their level; `####` and deeper are level 4: Orca text has no smaller step. */
function headingLevel(hashes: string): HeadingLevel {
  return Math.min(hashes.length, 4) as HeadingLevel
}

/** The width an image asks for, in pixels: `300`, `300px` or `300x200`; undefined otherwise. */
function widthOf(text: string | undefined): number | undefined {
  const match = /^\s*(\d+)(?:x\d+)?(?:px)?\s*$/.exec(text || '')
  return match ? Number(match[1]) : undefined
}

function withWidth<T extends object>(image: T, width: number | undefined): T & { width?: number } {
  return width ? { ...image, width } : image
}

const IMAGE_EMBED_LINE = /^\s*!\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]\s*$/
const IMAGE_MARKDOWN_LINE = /^\s*!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)\s*$/

/**
 * The image a line holds on its own: `![[pic.png]]` by its name (Obsidian looks it up in the whole
 * vault), `![alt](pic.png)` as the vault path it leads to from `notePath`. Null for anything else.
 */
export function imageOnLine(line: string, notePath: string): { target: string; alt: string; width?: number } | null {
  const embed = IMAGE_EMBED_LINE.exec(line)
  if (embed) {
    const target = embed[1].trim()
    // `![[pic.png|300]]` gives a width, not a caption.
    const width = widthOf(embed[2])
    const alt = embed[2] && width === undefined ? embed[2].trim() : target
    return isImageName(target) ? withWidth({ target, alt }, width) : null
  }
  const markdown = IMAGE_MARKDOWN_LINE.exec(line)
  if (!markdown) return null
  const address = markdown[2] || markdown[3] || ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) return null
  const path = safeDecode(address.split('#')[0])
  return isImageName(path) ? { target: joinNotePath(notePath, path), alt: markdown[1].trim() || path.split('/').pop() || path } : null
}

const HTML_IMAGE = /<img\b[^>]*>/gi
const HTML_TAG = /<\/?[a-z][^>]*>/gi
/** HTML that lays a block out: from such a tag to its closing one the lines stay together. */
const HTML_BLOCK_OPEN = /^\s*<(div|p|center|details|table|picture|section)\b[^>]*>/i

/** An HTML attribute's value, quoted or not; undefined when the tag has none. */
function htmlAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

/** The vault image an address names from `notePath`; undefined for a web address or another file. */
function vaultImage(address: string, notePath: string): string | undefined {
  if (!address || /^[a-z][a-z0-9+.-]*:/i.test(address) || address.startsWith('//')) return undefined
  const path = safeDecode(address.split('#')[0])
  return isImageName(path) ? joinNotePath(notePath, path) : undefined
}

/**
 * A line that is an HTML `<img>` of the vault alone, `<p>` or `<a>` around it aside: the image
 * it shows. Undefined for any other line.
 */
export function htmlImageOnLine(line: string, notePath: string): { target: string; alt: string; width?: number } | undefined {
  const images = line.match(HTML_IMAGE)
  if (!images || images.length !== 1 || line.replace(HTML_IMAGE, '').replace(INLINE_WRAPPER, '').trim()) return undefined
  const src = htmlAttribute(images[0], 'src') || ''
  const target = vaultImage(src, notePath)
  if (!target) return undefined
  const alt = (htmlAttribute(images[0], 'alt') || '').trim() || target.split('/').pop() || target
  return withWidth({ target, alt }, widthOf(htmlAttribute(images[0], 'width')))
}

/** `![alt](address "title")`: the address in group 2 or 3. */
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g

/**
 * The text with each image's address changed by `change`, given the image as written: Markdown
 * images and HTML `<img>`, outside code. `change` answers the new address, or null to drop the
 * image. Web images are passed too; images of no kind it knows keep their address.
 */
export function mapImages(text: string, notePath: string, change: (image: InlineImage) => string | null): string {
  let fence: string | null = null
  return text
    .split('\n')
    .map((line) => {
      const next = fenceAfter(line, fence)
      const inCode = fence !== null || next !== null
      fence = next
      if (inCode) return line
      return mapOutsideCode(line, (prose) =>
        prose
          .replace(HTML_IMAGE, (tag) => {
            const src = htmlAttribute(tag, 'src') || ''
            const image = imageOf(src, (htmlAttribute(tag, 'alt') || '').trim(), notePath)
            if (!image) return tag
            const to = change(image)
            if (to === null) return ''
            return tag.replace(/(\ssrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${to}"`)
          })
          .replace(MARKDOWN_IMAGE, (whole, alt: string, angled?: string, bare?: string) => {
            const image = imageOf(angled || bare || '', alt.trim(), notePath)
            if (!image) return whole
            const to = change(image)
            return to === null ? '' : `![${alt}](${to})`
          })
      )
    })
    .join('\n')
}

function imageOf(src: string, alt: string, notePath: string): InlineImage | null {
  if (/^https?:\/\//i.test(src)) return { src, alt }
  const target = vaultImage(src, notePath)
  return target ? { src, alt, target } : null
}

/** A badge as Markdown (`![alt](url)`, maybe inside a link) or as an HTML `<img>`. */
const BADGE_TOKEN = /\[!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?[^)]*\)\]\([^)]*\)|!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?[^)]*\)|<img\b[^>]*>/gi
/** HTML around badges or an image that does not change how it shows. */
const INLINE_WRAPPER = /<\/?(?:p|a|span|picture|source)\b[^>]*>|<br\s*\/?>/gi

/**
 * The web images a line holds and nothing else, links and wrappers aside: a README's badges,
 * which the worker draws. Null for any other line, a vault image among them included.
 */
export function badgesOnLine(line: string): BadgeImage[] | null {
  const found: BadgeImage[] = []
  const rest = line.replace(BADGE_TOKEN, (whole, linkedAlt?: string, linkedUrl?: string, alt?: string, url?: string) => {
    const tag = whole.startsWith('<')
    const address = tag ? htmlAttribute(whole, 'src') || '' : linkedUrl || url || ''
    if (!/^https?:\/\//i.test(address)) return whole
    found.push({ alt: (tag ? htmlAttribute(whole, 'alt') || '' : linkedAlt ?? alt ?? '').trim(), url: address })
    return ''
  })
  return found.length && !rest.replace(INLINE_WRAPPER, '').trim() ? found : null
}

/** How a block's opening tag lines up its content: its `align`, or its style's `text-align`. */
function alignOf(tag: string): Align | undefined {
  const value = (htmlAttribute(tag, 'align') || /text-align\s*:\s*(\w+)/i.exec(htmlAttribute(tag, 'style') || '')?.[1] || '').toLowerCase()
  return value === 'center' || value === 'right' ? value : undefined
}

/** The images a piece of Markdown shows, each once. */
export function inlineImages(text: string, notePath: string): InlineImage[] {
  const found = new Map<string, InlineImage>()
  mapImages(text, notePath, (image) => {
    if (!found.has(image.src)) found.set(image.src, image)
    return image.src
  })
  return [...found.values()]
}

/** A prose line with its note links as bold text; inline code and HTML stay as written. */
function proseLine(line: string): string {
  return mapOutsideCode(line, replaceNoteLinks)
}

/** The vault image a heading line shows before its text, in HTML; undefined when it has none. */
function headingIcon(line: string, notePath: string): string | undefined {
  const tag = (line.match(HTML_IMAGE) || [])[0]
  return tag ? vaultImage(htmlAttribute(tag, 'src') || '', notePath) : undefined
}

/** How many of `tag` a line opens, less the ones it closes. */
function tagDepth(line: string, tag: string): number {
  const opens = line.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))?.length || 0
  const closes = line.match(new RegExp(`</${tag}\\s*>`, 'gi'))?.length || 0
  return opens - closes
}

/** A line a paragraph or list item can go on after: not a table, heading, rule or hard break. */
function isOpenProse(line: string): boolean {
  if (!line.trim() || TABLE_LINE.test(line) || HEADING.test(line)) return false
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return false
  return !/( {2}|\\|<br\s*\/?>)$/i.test(line)
}

/** A line that carries the paragraph before it on, rather than starting a block of its own. */
function continuesProse(line: string): boolean {
  if (!line.trim()) return false
  return !/^\s*(?:[-*+](?:\s|$)|\d+[.)](?:\s|$)|>|\||#{1,6}(?:\s|$)|<|`{3}|~{3}|=+\s*$|\[\^|\$\$)/.test(line)
}

/**
 * The lines with each paragraph's wrapped lines joined into one: Orca's Markdown breaks the line
 * wherever the file does, so text wrapped at 80 columns would be cut short in a narrow panel.
 * Code fences stay as written.
 */
export function joinWrappedLines(lines: readonly string[]): string[] {
  const out: string[] = []
  let fence: string | null = null
  let open = false
  for (const line of lines) {
    const next = fenceAfter(line, fence)
    const inCode = fence !== null || next !== null
    fence = next
    if (inCode) {
      out.push(line)
      open = false
      continue
    }
    if (open && continuesProse(line)) out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`
    else out.push(line)
    open = isOpenProse(out[out.length - 1])
  }
  return out
}

/** Code, a wikilink, a Markdown link or image, bold text, or a web address, in a line of text. */
const INLINE =
  /(`+)([\s\S]*?)\1|(!?)\[\[((?:[^\]|#]|\](?!\]))+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]|(!?)\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>)\]]+)/g

/** Text with the marks the panel cannot draw taken out: HTML tags, emphasis, strikethrough, escapes. */
function plainInline(text: string): string {
  return text
    .replace(HTML_TAG, '')
    .replace(/~~/g, '')
    .replace(/(^|[^*\\])\*(?=\S)([^*]+?)\*/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, '$1')
}

/**
 * A line of text as runs the panel draws: its links to notes and files as links that open
 * them, web links as they were, bold and code kept; italics and strikethrough read as plain
 * text, which Orca's Text cannot show.
 */
export function inlineRuns(line: string, notePath: string, bold: boolean = false): Inline[] {
  const runs: Inline[] = []
  const text = (value: string, code: boolean = false): void => {
    const shown = code ? value : plainInline(value)
    if (!shown) return
    const last = runs[runs.length - 1]
    if (last && last.kind === 'text' && Boolean(last.bold) === bold && Boolean(last.code) === code) last.text += shown
    else runs.push({ kind: 'text', text: shown, ...(bold ? { bold } : {}), ...(code ? { code } : {}) })
  }
  let at = 0
  for (const match of line.matchAll(INLINE)) {
    text(line.slice(at, match.index))
    at = (match.index || 0) + match[0].length
    if (match[1] !== undefined) text(match[2].trim(), true)
    else if (match[4] !== undefined) {
      const target = match[4].trim()
      const shown = (match[6] || '').trim() || (isAttachmentName(target) ? target.split('/').pop() || target : target + (match[5] || ''))
      if (match[3] === '!') text(`(${shown})`)
      else runs.push({ kind: isAttachmentName(target) ? 'file' : 'note', text: shown, target })
    } else if (match[8] !== undefined) {
      const address = match[9] || match[10] || ''
      const label = plainInline(match[8]).replace(/`/g, '').trim()
      const note = markdownNoteAddress(address)
      const file = markdownFileAddress(address)
      if (match[7] === '!') text(label ? `(${label})` : '')
      else if (/^(https?:\/\/|mailto:)/i.test(address)) runs.push({ kind: 'link', text: label || address, href: address })
      else if (note !== null) runs.push({ kind: 'note', text: label || noteTitleOf(note), target: joinNotePath(notePath, note) })
      else if (file !== null) runs.push({ kind: 'file', text: label || file.split('/').pop() || file, target: joinNotePath(notePath, file) })
      else text(label)
    } else if (match[11] !== undefined || match[12] !== undefined) {
      for (const run of inlineRuns(match[11] ?? match[12], notePath, true)) {
        const last = runs[runs.length - 1]
        if (run.kind === 'text' && last && last.kind === 'text' && last.bold && !last.code && !run.code) last.text += run.text
        else runs.push(run)
      }
    } else {
      // A bare address: the punctuation that ends the sentence is not part of it.
      const address = match[13] || match[14]
      const tail = match[13] ? '' : (/[.,;:!?]+$/.exec(address) || [''])[0]
      const href = tail ? address.slice(0, -tail.length) : address
      runs.push({ kind: 'link', text: href, href })
      text(tail)
    }
  }
  text(line.slice(at))
  return runs
}

/** Whether a line links to a note or a file, outside code: the links Orca's Markdown cannot open. */
function hasVaultLinks(line: string, notePath: string): boolean {
  return inlineRuns(line, notePath).some((run) => run.kind === 'note' || run.kind === 'file')
}

/** `- item`, `* item`, `1. item`: the indent, the marker and the text. */
const LIST_ITEM = /^([ \t]*)([-*+]|\d+[.)])\s+(.*)$/

function listLine(line: string, notePath: string): ListLine | null {
  const item = LIST_ITEM.exec(line)
  if (!item) return null
  return { level: Math.floor(item[1].replace(/\t/g, '  ').length / 2), marker: /\d/.test(item[2]) ? item[2].replace(')', '.') : '•', runs: inlineRuns(item[3], notePath) }
}

/** A line of a paragraph: not a table, a quote, a heading, a rule or HTML. */
function isParagraphLine(line: string): boolean {
  return Boolean(line.trim()) && !/^\s*(?:>|\||#{1,6}(?:\s|$)|<|=+\s*$|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|\[\^|\$\$)/.test(line) && !LIST_ITEM.test(line)
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
  // The lines gathered, as written: Markdown for Orca to draw, but for the paragraphs and
  // lists that link to notes or files, which the panel draws so their links can be pressed.
  const flushMarkdown = (): void => {
    let plain: string[] = []
    const flushPlain = (): void => {
      for (const chunk of chunkMarkdown(plain.join('\n'))) {
        const images = inlineImages(chunk, notePath)
        segments.push(images.length ? { kind: 'markdown', text: chunk, images } : { kind: 'markdown', text: chunk })
      }
      plain = []
    }
    const gathered = joinWrappedLines(pending)
    let code: string | null = null
    for (let at = 0; at < gathered.length; at++) {
      const line = gathered[at]
      const after = fenceAfter(line, code)
      const inCode = code !== null || after !== null
      code = after
      if (inCode) {
        plain.push(line)
        continue
      }
      if (LIST_ITEM.test(line)) {
        // The whole list, so its items look alike: one drawn by Orca and the next by the panel would not.
        let end = at
        while (end + 1 < gathered.length && LIST_ITEM.test(gathered[end + 1])) end++
        const block = gathered.slice(at, end + 1)
        if (block.some((item) => hasVaultLinks(item, notePath))) {
          flushPlain()
          segments.push({ kind: 'list', items: block.map((item) => listLine(item, notePath)!) })
        } else plain.push(...block.map(proseLine))
        at = end
        continue
      }
      if (isParagraphLine(line) && hasVaultLinks(line, notePath)) {
        flushPlain()
        segments.push({ kind: 'rich', runs: inlineRuns(line.trim(), notePath) })
        continue
      }
      plain.push(proseLine(line))
    }
    flushPlain()
    pending = []
  }
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (fence === null && MERMAID_FENCE.test(lines[i])) {
      const open = fenceAfter(lines[i], null)
      const block = [lines[i]]
      let closed = false
      while (i + 1 < lines.length && !closed) {
        i++
        block.push(lines[i])
        closed = fenceAfter(lines[i], open) === null
      }
      flushMarkdown()
      segments.push({ kind: 'diagram', code: block.slice(1, closed ? -1 : undefined).join('\n'), markdown: block.join('\n') })
      continue
    }
    const next = fenceAfter(lines[i], fence)
    const inCode = fence !== null || next !== null
    fence = next
    if (inCode) {
      pending.push(lines[i])
      continue
    }
    // An HTML block (a README's `<div align="center">`): what it holds is read like the rest of
    // the note, its tags dropped, and lined up as the block says. Orca's Markdown cannot do it
    // with the tags kept: it draws every image the whole width of the panel.
    const block = HTML_BLOCK_OPEN.exec(lines[i])
    if (block) {
      const held = [lines[i]]
      let depth = tagDepth(lines[i], block[1])
      let blockFence: string | null = null
      while (depth > 0 && i + 1 < lines.length) {
        i++
        held.push(lines[i])
        const after = fenceAfter(lines[i], blockFence)
        const code = blockFence !== null || after !== null
        blockFence = after
        if (!code) depth += tagDepth(lines[i], block[1])
      }
      const text = held.join('\n')
      const open = text.indexOf(block[0].trimStart()) + block[0].trimStart().length
      const close = text.toLowerCase().lastIndexOf(`</${block[1].toLowerCase()}`)
      const inner = text.slice(open, close >= open ? close : undefined)
      const align = alignOf(block[0])
      flushMarkdown()
      for (const segment of noteSegments(inner, notePath)) {
        // A block inside keeps its own alignment; only what can be lined up takes this one.
        const alignable = segment.kind === 'markdown' || segment.kind === 'heading' || segment.kind === 'image' || segment.kind === 'badges'
        segments.push(align && alignable && !('align' in segment) ? { ...segment, align } : segment)
      }
      continue
    }
    const files = fileLineLinks(lines[i], notePath)
    if (files) {
      flushMarkdown()
      const last = segments[segments.length - 1]
      if (last && last.kind === 'files') last.items.push(...files)
      else segments.push({ kind: 'files', items: files })
      continue
    }
    const badges = badgesOnLine(lines[i])
    if (badges) {
      flushMarkdown()
      const last = segments[segments.length - 1]
      if (last && last.kind === 'badges') last.items.push(...badges)
      else segments.push({ kind: 'badges', items: badges })
      continue
    }
    const image = htmlImageOnLine(lines[i], notePath) || imageOnLine(lines[i], notePath)
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
      const icon = headingIcon(lines[i], notePath)
      const raw = heading[2].replace(HTML_TAG, '').trim()
      segments.push({ kind: 'heading', level, text: headingText(raw), markdown: `${'#'.repeat(level)} ${raw}`, ...(icon ? { icon } : {}) })
      continue
    }
    const start = CALLOUT_START.exec(line)
    if (!start) {
      const task = taskOnLine(line)
      if (!task) {
        pending.push(lines[i])
        continue
      }
      flushMarkdown()
      const last = segments[segments.length - 1]
      if (last && last.kind === 'tasks') last.items.push(task)
      else segments.push({ kind: 'tasks', items: [task] })
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
      text: joinWrappedLines(inner).join('\n')
    })
  }
  flushMarkdown()
  return segments
}
