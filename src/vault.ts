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
 * The note a `[[target]]` points to, Obsidian's way: a vault-relative path when it has a
 * folder, otherwise the first note with that name.
 */
export function resolveWikilink(notes: readonly string[], target: string): string | null {
  const wanted = target.trim().replace(/\.md$/i, '').toLowerCase()
  if (!wanted) return null
  const exact = notes.find((key) => key.slice(0, -NOTE_EXTENSION.length).toLowerCase() === wanted)
  if (exact) return exact
  return notes.find((key) => noteTitle(key).toLowerCase() === wanted) || null
}

/** Obsidian opens a file by its absolute path, in whichever registered vault holds it. */
export function obsidianUrl(file: string): string {
  return `obsidian://open?path=${encodeURIComponent(resolve(file))}`
}
