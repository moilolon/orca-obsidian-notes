// Rules over vault paths, without touching the disk: the worker does the reading.
import { isAbsolute, relative, resolve } from 'node:path'

/** Folders a vault keeps for itself or for tools: never listed or searched. */
export const SKIPPED_FOLDERS = new Set(['.obsidian', '.trash', '.git', '.claudian', 'node_modules'])

export const NOTE_EXTENSION = '.md'

/** True when `target` is `root` itself or inside it, after resolving `..`. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The vault-relative path with forward slashes, the key the panel uses. */
export function toKey(root: string, file: string): string {
  return relative(resolve(root), resolve(file)).split('\\').join('/')
}

export function isNote(name: string): boolean {
  return name.toLowerCase().endsWith(NOTE_EXTENSION)
}

export function noteTitle(name: string): string {
  const base = name.split('/').pop() || name
  return isNote(base) ? base.slice(0, -NOTE_EXTENSION.length) : base
}

/** Folders first, then notes, each alphabetically as a person reads them. */
export function compareEntries(a: { name: string; isDir: boolean }, b: { name: string; isDir: boolean }): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
}

/**
 * The note a `[[target]]` points to, Obsidian's way: the vault-relative path, then a path that
 * ends with the target (`[[Docs/TODO]]` for `Work/Docs/TODO.md`), then the first note with
 * that name.
 */
export function resolveWikilink(notes: readonly string[], target: string): string | null {
  const wanted = target.trim().replace(/^\/+/, '').replace(/\.md$/i, '').toLowerCase()
  if (!wanted) return null
  const bare = (key: string): string => key.slice(0, -NOTE_EXTENSION.length).toLowerCase()
  return (
    notes.find((key) => bare(key) === wanted) ||
    notes.find((key) => bare(key).endsWith(`/${wanted}`)) ||
    notes.find((key) => noteTitle(key).toLowerCase() === wanted) ||
    null
  )
}

/**
 * The file an attachment target names, the way Obsidian finds `![[pic.png]]`: the vault path,
 * then a path ending with it, then the first file with that name anywhere in the vault.
 */
export function resolveAttachment(files: readonly string[], target: string): string | null {
  const wanted = target.trim().replace(/^\/+/, '').toLowerCase()
  if (!wanted) return null
  const name = wanted.split('/').pop() || wanted
  return (
    files.find((key) => key.toLowerCase() === wanted) ||
    files.find((key) => key.toLowerCase().endsWith(`/${wanted}`)) ||
    files.find((key) => (key.split('/').pop() || key).toLowerCase() === name) ||
    null
  )
}

/**
 * A change the watcher reports that cannot alter the notes or their images: hidden or tool
 * folders, other kinds of file.
 */
export function isIgnoredChange(filename: string): boolean {
  const parts = filename.split(/[\\/]/).filter(Boolean)
  if (parts.some((part) => part.startsWith('.') || SKIPPED_FOLDERS.has(part))) return true
  const last = parts[parts.length - 1] || ''
  return /\.(pdf|canvas|json|base|css|js|mp3|mp4|webm)$/i.test(last)
}

/** One line of the text around `index`, for a search hit. */
export function snippetAt(text: string, index: number, length: number, around: number = 50): string {
  const start = Math.max(0, index - around)
  const end = Math.min(text.length, index + length + around)
  const words = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${words}${end < text.length ? '…' : ''}`
}

/** Obsidian opens a file by its absolute path, in whichever registered vault holds it. */
export function obsidianUrl(file: string): string {
  return `obsidian://open?path=${encodeURIComponent(resolve(file))}`
}
