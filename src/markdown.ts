// Turns an Obsidian note into what Orca's Markdown component can draw. No imports: the panel
// loads this file, and panels cannot reach Node.

export type CalloutTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export type HeadingLevel = 1 | 2 | 3 | 4

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'heading'; level: HeadingLevel; text: string; markdown: string }
  | { kind: 'callout'; tone: CalloutTone; title: string; text: string }

/** Orca refuses a text over 16 KiB; accented text takes two bytes per letter, so stay well under. */
const MAX_CHUNK_CHARS = 6000

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/
const WIKILINK = /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g
const CALLOUT_START = /^>\s*\[!([A-Za-z-]+)\][+-]?\s*(.*)$/
const QUOTE_LINE = /^>\s?/
const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
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

/** The note without its YAML front matter. */
export function stripFrontMatter(text: string): string {
  return text.replace(FRONT_MATTER, '')
}

/** The distinct notes a text links with `[[...]]`, embeds left out, in order of appearance. */
export function wikilinkTargets(text: string): string[] {
  const targets: string[] = []
  for (const match of text.matchAll(WIKILINK)) {
    const target = match[2].trim()
    if (match[1] !== '!' && target && !targets.includes(target)) targets.push(target)
  }
  return targets
}

/** `[[note|alias]]` as bold text (the panel lists the links below the note); embeds as a note. */
export function replaceWikilinks(text: string): string {
  return text.replace(WIKILINK, (_whole, embed: string, target: string, heading: string | undefined, alias: string | undefined) => {
    const shown = (alias || target + (heading || '')).trim()
    return embed === '!' ? `*(${shown})*` : `**${shown}**`
  })
}

function calloutTone(type: string): CalloutTone {
  return CALLOUT_TONES[type.toLowerCase()] || 'neutral'
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/** Splits long Markdown at blank lines outside code fences, so each piece fits Orca's limit. */
export function chunkMarkdown(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return text.trim() ? [text] : []
  const chunks: string[] = []
  let current: string[] = []
  let size = 0
  let inFence = false
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence
    const canBreak = !inFence && line.trim() === '' && size >= maxChars
    if (canBreak) {
      chunks.push(current.join('\n'))
      current = []
      size = 0
      continue
    }
    current.push(line)
    size += line.length + 1
  }
  if (current.join('').trim()) chunks.push(current.join('\n'))
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

/**
 * The note body as Markdown pieces, headings and Obsidian callouts, in order. Headings are
 * their own segments so the panel can draw them with Orca's heading and space the sections.
 */
export function noteSegments(text: string): Segment[] {
  const body = replaceWikilinks(stripFrontMatter(text))
  const segments: Segment[] = []
  let pending: string[] = []
  let inFence = false
  const flushMarkdown = (): void => {
    for (const chunk of chunkMarkdown(pending.join('\n'))) segments.push({ kind: 'markdown', text: chunk })
    pending = []
  }
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE.test(line)) inFence = !inFence
    const heading = inFence ? null : HEADING.exec(line)
    if (heading) {
      flushMarkdown()
      const level = headingLevel(heading[1])
      segments.push({ kind: 'heading', level, text: headingText(heading[2]), markdown: `${'#'.repeat(level)} ${heading[2]}` })
      continue
    }
    const start = inFence ? null : CALLOUT_START.exec(line)
    if (!start) {
      pending.push(line)
      continue
    }
    flushMarkdown()
    const inner: string[] = []
    while (i + 1 < lines.length && QUOTE_LINE.test(lines[i + 1])) {
      i++
      inner.push(lines[i].replace(QUOTE_LINE, ''))
    }
    segments.push({
      kind: 'callout',
      tone: calloutTone(start[1]),
      title: start[2].trim() || capitalized(start[1]),
      text: inner.join('\n')
    })
  }
  flushMarkdown()
  return segments
}
