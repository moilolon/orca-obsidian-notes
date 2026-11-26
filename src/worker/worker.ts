// The worker reads the vault folders the person added and answers the panel. It writes nothing
// to a vault: the only write is the vault list, in the plugin's own storage. Every disk read is
// asynchronous, so a long search never holds up the panel's other requests.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, realpath, rename, stat, unlink, utimes } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TreeItem } from 'orca'
import type { OrcaWorkerApi } from 'orca/worker'
import { isImageName, noteLinks } from '../panel/markdown'
import { pickFolder } from './folder-picker'
import type { NoteFile } from '../protocol'
import { compareEntries, isIgnoredChange, isInside, isNote, noteTitle, obsidianUrl, resolveAttachment, resolveWikilink, SKIPPED_FOLDERS, snippetAt, toKey } from './vault'

const VAULTS_KEY = 'vaults'
const MAX_NOTE_BYTES = 1024 * 1024
const MAX_TREE_ENTRIES = 4000
const MAX_SEARCH_RESULTS = 50
const MAX_BACKLINKS = 50
/** Obsidian saves as the person types: changes closer than this reach the panel once. */
const CHANGE_DELAY_MS = 500
/** Larger images are not copied: the panel shows their name instead. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** Past this size the cache drops the images used longest ago. */
const MAX_CACHE_BYTES = 200 * 1024 * 1024

/**
 * Orca's `Image` shows only files of the plugin, so the worker copies the vault's images into
 * this folder of the plugin, as Orca installed it, and the panel names them relative to it.
 */
const CACHE_FOLDER = 'cache'
const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const CACHE_DIR = join(PLUGIN_ROOT, CACHE_FOLDER)

type Index = { items: TreeItem[]; notes: string[]; images: string[]; truncated: boolean }

/**
 * What the worker keeps of a vault: its tree, while a watcher tells it when the disk changes.
 * Without a watcher (the system refused one) the tree is read again on every request.
 */
type Watched = { vault: string; watcher: FSWatcher | null; index: Promise<Index> | null; timer: ReturnType<typeof setTimeout> | null }

const watched = new Map<string, Watched>()
/** The links each note makes, kept until the file changes, for the backlinks. */
const linkCache = new Map<string, { mtimeMs: number; targets: string[] }>()

/** The message is a code the panel words in the person's language (src/panel/i18n.ts). */
function invalid(code: string): Error {
  return Object.assign(new Error(code), { code: 'invalid_params' })
}

function sameFolder(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}

async function storedVaults(orca: OrcaWorkerApi): Promise<string[]> {
  const value = await orca.storage.get(VAULTS_KEY)
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** A vault the person added, as a folder and as the list spells it: the panel reaches no other. */
async function knownVault(orca: OrcaWorkerApi, vault: string): Promise<{ root: string; stored: string }> {
  const stored = (await storedVaults(orca)).find((v) => sameFolder(v, vault))
  if (!stored) throw invalid('not_a_vault')
  return { root: resolve(vault), stored }
}

/** A note inside the vault, after following any link on the way: a link out of it is refused. */
async function noteInVault(root: string, path: string): Promise<string> {
  const file = resolve(root, path)
  if (!isInside(root, file) || !isNote(file)) throw invalid('not_a_note')
  let real: string
  try {
    real = await realpath(file)
  } catch {
    throw invalid('note_missing')
  }
  if (!isInside(await realpath(root), real)) throw invalid('not_a_note')
  return file
}

type Walk = { notes: string[]; images: string[]; count: number; truncated: boolean }

/**
 * The folder's tree, folders first, leaving out folders with no notes; stops listing once it
 * holds MAX_TREE_ENTRIES entries. Images stay out of the tree, but the walk remembers them for
 * `![[pic.png]]`.
 */
async function walk(root: string, dir: string, state: Walk): Promise<TreeItem[]> {
  let entries: { name: string; isDir: boolean }[]
  try {
    const all = await readdir(dir, { withFileTypes: true })
    // Links are left out: a linked file or folder could lead out of the vault.
    for (const d of all) if (d.isFile() && isImageName(d.name)) state.images.push(toKey(root, join(dir, d.name)))
    entries = all
      .filter((d) => (d.isDirectory() ? !SKIPPED_FOLDERS.has(d.name) && !d.name.startsWith('.') : d.isFile() && isNote(d.name)))
      .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
      .sort(compareEntries)
  } catch {
    return []
  }
  const items: TreeItem[] = []
  for (const entry of entries) {
    if (state.count >= MAX_TREE_ENTRIES) {
      state.truncated = true
      break
    }
    state.count++
    const full = join(dir, entry.name)
    const key = toKey(root, full)
    if (entry.isDir) {
      const children = await walk(root, full, state)
      // A folder with no note anywhere under it (attachments, assets) has nothing to open.
      if (children.length) items.push({ key, label: entry.name, icon: 'folder', children })
      else state.count--
    } else {
      state.notes.push(key)
      items.push({ key, label: noteTitle(entry.name), icon: 'file-text' })
    }
  }
  return items
}

async function readIndex(root: string): Promise<Index> {
  const state: Walk = { notes: [], images: [], count: 0, truncated: false }
  const items = await walk(root, root, state)
  return { items, notes: state.notes, images: state.images, truncated: state.truncated }
}

/**
 * The vault image as a file of the plugin: `cache/<hash>.<ext>`, named by the file and its
 * version, so an unchanged image is copied once and a changed one gets a new name.
 */
async function cachedImage(root: string, key: string): Promise<string | null> {
  const file = resolve(root, key)
  let real: string
  try {
    real = await realpath(file)
  } catch {
    return null
  }
  if (!isInside(await realpath(root), real)) return null
  const { size, mtimeMs } = await stat(real)
  if (size > MAX_IMAGE_BYTES) return null
  const name = `${createHash('sha1').update(`${real}\n${mtimeMs}\n${size}`).digest('hex').slice(0, 24)}${extname(real).toLowerCase()}`
  const target = join(CACHE_DIR, name)
  const now = new Date()
  try {
    // Already copied: mark it used, so the cache keeps it over older ones.
    await utimes(target, now, now)
  } catch {
    await mkdir(CACHE_DIR, { recursive: true })
    // Copied under a temporary name first: the panel never sees half a file.
    const partial = `${target}.${process.pid}.part`
    await copyFile(real, partial)
    await rename(partial, target)
    void pruneCache()
  }
  return `${CACHE_FOLDER}/${name}`
}

/** Drops the images used longest ago until the cache is under MAX_CACHE_BYTES. */
async function pruneCache(): Promise<void> {
  try {
    const files = await Promise.all(
      (await readdir(CACHE_DIR)).map(async (name) => {
        const { size, mtimeMs } = await stat(join(CACHE_DIR, name))
        return { name, size, mtimeMs }
      })
    )
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= MAX_CACHE_BYTES) break
      await unlink(join(CACHE_DIR, file.name)).catch(() => undefined)
      total -= file.size
    }
  } catch {
    // No cache yet, or a file went while reading it: nothing to prune.
  }
}

function forget(root: string): void {
  const entry = watched.get(root.toLowerCase())
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.watcher?.close()
  watched.delete(root.toLowerCase())
}

/** Starts watching a vault the first time it is read; a change drops the tree and tells the panels. */
function watchedVault(orca: OrcaWorkerApi, root: string, stored: string): Watched {
  const existing = watched.get(root.toLowerCase())
  if (existing) return existing
  const entry: Watched = { vault: stored, watcher: null, index: null, timer: null }
  watched.set(root.toLowerCase(), entry)
  try {
    entry.watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (filename && isIgnoredChange(String(filename))) return
      entry.index = null
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        entry.timer = null
        orca.panels.post('notes.changed', { vault: entry.vault })
      }, CHANGE_DELAY_MS)
      entry.timer.unref()
    })
    // Neither the watcher nor its timer keeps the worker alive on their own.
    entry.watcher.unref()
    entry.watcher.on('error', () => {
      entry.watcher?.close()
      entry.watcher = null
      entry.index = null
    })
  } catch {
    entry.watcher = null
  }
  return entry
}

async function vaultIndex(orca: OrcaWorkerApi, vault: string, refresh: boolean = false): Promise<{ root: string; index: Index }> {
  const { root, stored } = await knownVault(orca, vault)
  const entry = watchedVault(orca, root, stored)
  if (refresh || !entry.watcher || !entry.index) {
    const reading = readIndex(root)
    entry.index = entry.watcher ? reading : null
    return { root, index: await reading }
  }
  return { root, index: await entry.index }
}

/** A note's text when it is small enough to read; null otherwise or when it cannot be read. */
async function readSmallNote(file: string): Promise<string | null> {
  try {
    if ((await stat(file)).size > MAX_NOTE_BYTES) return null
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function readNote(file: string): Promise<string> {
  if ((await stat(file)).size > MAX_NOTE_BYTES) throw invalid('note_too_large')
  return readFile(file, 'utf8')
}

async function searchVault(root: string, notes: readonly string[], query: string): Promise<{ results: NoteFile[]; truncated: boolean }> {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return { results: [], truncated: false }
  const results: NoteFile[] = []
  for (const key of notes) {
    const name = noteTitle(key)
    let hit: NoteFile | null = name.toLowerCase().includes(wanted) ? { path: key, name } : null
    if (!hit) {
      const text = await readSmallNote(join(root, key))
      const at = text === null ? -1 : text.toLowerCase().indexOf(wanted)
      if (text !== null && at >= 0) hit = { path: key, name, snippet: snippetAt(text, at, wanted.length) }
    }
    if (!hit) continue
    if (results.length >= MAX_SEARCH_RESULTS) return { results, truncated: true }
    results.push(hit)
  }
  return { results, truncated: false }
}

/** The link targets a note makes, read once per version of the file. */
async function linkTargets(root: string, key: string): Promise<string[]> {
  const file = join(root, key)
  try {
    const { mtimeMs, size } = await stat(file)
    const cached = linkCache.get(file)
    if (cached && cached.mtimeMs === mtimeMs) return cached.targets
    const targets = size > MAX_NOTE_BYTES ? [] : noteLinks(await readFile(file, 'utf8'), key).map((link) => link.target)
    linkCache.set(file, { mtimeMs, targets })
    return targets
  } catch {
    return []
  }
}

async function backlinks(root: string, notes: readonly string[], path: string): Promise<NoteFile[]> {
  const wanted = path.toLowerCase()
  const results: NoteFile[] = []
  for (const key of notes) {
    if (key.toLowerCase() === wanted) continue
    const targets = await linkTargets(root, key)
    if (targets.some((target) => resolveWikilink(notes, target)?.toLowerCase() === wanted)) {
      results.push({ path: key, name: noteTitle(key) })
      if (results.length >= MAX_BACKLINKS) break
    }
  }
  return results
}

/** Hands the URL to the operating system, which passes `obsidian://` to Obsidian. */
function openUrl(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]]
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('vaults.list', async () => ({ vaults: await storedVaults(orca) }))

  /** Stores a folder as a vault, once; answers the list and the folder as it was stored. */
  async function addVault(path: string): Promise<{ vaults: string[]; added: string }> {
    const folder = resolve(path.trim().replace(/^"|"$/g, ''))
    const isFolder = await stat(folder).then((s) => s.isDirectory(), () => false)
    if (!isFolder) throw invalid('not_a_folder')
    const vaults = await storedVaults(orca)
    const known = vaults.find((v) => sameFolder(v, folder))
    if (!known) vaults.push(folder)
    await orca.storage.set(VAULTS_KEY, vaults)
    return { vaults, added: known || folder }
  }

  orca.panels.handle('vaults.add', async ({ path }) => addVault(path))

  orca.panels.handle('vaults.pick', async () => {
    const picked = await pickFolder()
    return picked ? addVault(picked) : { vaults: await storedVaults(orca), added: null }
  })

  orca.panels.handle('vaults.remove', async ({ path }) => {
    const vaults = (await storedVaults(orca)).filter((v) => !sameFolder(v, path))
    await orca.storage.set(VAULTS_KEY, vaults)
    forget(resolve(path))
    return { vaults }
  })

  orca.panels.handle('notes.tree', async ({ vault, refresh }) => {
    const { index } = await vaultIndex(orca, vault, refresh === true)
    return { items: index.items, truncated: index.truncated, limit: MAX_TREE_ENTRIES }
  })

  orca.panels.handle('notes.read', async ({ vault, path }) => {
    const { root } = await knownVault(orca, vault)
    const file = await noteInVault(root, path)
    return { path: toKey(root, file), title: noteTitle(file.split(/[\\/]/).pop() || path), text: await readNote(file) }
  })

  orca.panels.handle('notes.search', async ({ vault, query }) => {
    const { root, index } = await vaultIndex(orca, vault)
    return searchVault(root, index.notes, query)
  })

  orca.panels.handle('notes.resolve', async ({ vault, targets }) => {
    const { index } = await vaultIndex(orca, vault)
    return { paths: targets.map((target) => resolveWikilink(index.notes, target)) }
  })

  orca.panels.handle('notes.backlinks', async ({ vault, path }) => {
    const { root, index } = await vaultIndex(orca, vault)
    return { results: await backlinks(root, index.notes, path) }
  })

  orca.panels.handle('notes.image', async ({ vault, target }) => {
    const { root, index } = await vaultIndex(orca, vault)
    const key = resolveAttachment(index.images, target)
    return { src: key ? await cachedImage(root, key) : null }
  })

  orca.panels.handle('notes.openInObsidian', async ({ vault, path }) => {
    const { root } = await knownVault(orca, vault)
    openUrl(obsidianUrl(await noteInVault(root, path)))
    return { opened: true }
  })
}

/** Stops every watcher before the worker goes. */
export function deactivate(): void {
  for (const root of [...watched.keys()]) forget(root)
  linkCache.clear()
}
