// The worker reads the vault folders the person added and answers the panel. It writes nothing
// to a vault: the only write is the vault list, in the plugin's own storage.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { TreeItem } from 'orca'
import type { OrcaWorkerApi } from 'orca/worker'
import { pickFolder } from './folder-picker'
import type { NoteFile } from '../protocol'
import { compareEntries, isInside, isNote, noteTitle, obsidianUrl, resolveWikilink, SKIPPED_FOLDERS, toKey } from './vault'

const VAULTS_KEY = 'vaults'
const MAX_NOTE_BYTES = 1024 * 1024
const MAX_TREE_ENTRIES = 4000
const MAX_SEARCH_RESULTS = 50

/** The message is a code the panel words in the person's language (src/panel/i18n.ts). */
function invalid(code: string): Error {
  return Object.assign(new Error(code), { code: 'invalid_params' })
}

async function storedVaults(orca: OrcaWorkerApi): Promise<string[]> {
  const value = await orca.storage.get(VAULTS_KEY)
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** A vault the person added: the panel never reaches a folder that is not one. */
async function knownVault(orca: OrcaWorkerApi, vault: string): Promise<string> {
  const root = resolve(vault)
  const vaults = await storedVaults(orca)
  if (!vaults.some((v) => resolve(v).toLowerCase() === root.toLowerCase())) throw invalid('not_a_vault')
  return root
}

function noteInVault(root: string, path: string): string {
  const file = resolve(root, path)
  if (!isInside(root, file) || !isNote(file)) throw invalid('not_a_note')
  return file
}

type Walked = { items: TreeItem[]; notes: string[]; count: number; truncated: boolean }

/** The folder's tree, folders first; stops listing once it holds MAX_TREE_ENTRIES entries. */
function walk(root: string, dir: string, state: Walked): TreeItem[] {
  let entries: { name: string; isDir: boolean }[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() ? !SKIPPED_FOLDERS.has(d.name) && !d.name.startsWith('.') : isNote(d.name)))
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
      items.push({ key, label: entry.name, icon: 'folder', children: walk(root, full, state) })
    } else {
      state.notes.push(key)
      items.push({ key, label: noteTitle(entry.name), icon: 'file-text' })
    }
  }
  return items
}

function listVault(root: string): Walked {
  const state: Walked = { items: [], notes: [], count: 0, truncated: false }
  state.items = walk(root, root, state)
  return state
}

function readNote(file: string): string {
  if (statSync(file).size > MAX_NOTE_BYTES) throw invalid('note_too_large')
  return readFileSync(file, 'utf8')
}

function searchVault(root: string, query: string): NoteFile[] {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return []
  const results: NoteFile[] = []
  for (const key of listVault(root).notes) {
    if (results.length >= MAX_SEARCH_RESULTS) break
    const file = join(root, key)
    const byName = noteTitle(key).toLowerCase().includes(wanted)
    const byText = !byName && statSync(file).size <= MAX_NOTE_BYTES && readFileSync(file, 'utf8').toLowerCase().includes(wanted)
    if (byName || byText) results.push({ path: key, name: noteTitle(key) })
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
    if (!existsSync(folder) || !statSync(folder).isDirectory()) throw invalid('not_a_folder')
    const vaults = await storedVaults(orca)
    const known = vaults.find((v) => resolve(v).toLowerCase() === folder.toLowerCase())
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
    const target = resolve(path).toLowerCase()
    const vaults = (await storedVaults(orca)).filter((v) => resolve(v).toLowerCase() !== target)
    await orca.storage.set(VAULTS_KEY, vaults)
    return { vaults }
  })

  orca.panels.handle('notes.tree', async ({ vault }) => {
    const { items, truncated } = listVault(await knownVault(orca, vault))
    return { items, truncated }
  })

  orca.panels.handle('notes.read', async ({ vault, path }) => {
    const root = await knownVault(orca, vault)
    const file = noteInVault(root, path)
    return { path: toKey(root, file), title: noteTitle(file.split(/[\\/]/).pop() || path), text: readNote(file) }
  })

  orca.panels.handle('notes.search', async ({ vault, query }) => ({ results: searchVault(await knownVault(orca, vault), query) }))

  orca.panels.handle('notes.resolve', async ({ vault, target }) => {
    const root = await knownVault(orca, vault)
    return { path: resolveWikilink(listVault(root).notes, target) }
  })

  orca.panels.handle('notes.openInObsidian', async ({ vault, path }) => {
    const root = await knownVault(orca, vault)
    openUrl(obsidianUrl(noteInVault(root, path)))
    return { opened: true }
  })
}
