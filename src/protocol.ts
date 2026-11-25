// The panel <-> worker contract, declared once: src/panel/panel.tsx and src/worker/worker.ts both read it.
import type { TreeItem } from 'orca'

export type NoteFile = { path: string; name: string }

export type NoteContent = {
  /** Vault-relative path with forward slashes, `.md` included. */
  path: string
  /** File name without `.md`. */
  title: string
  /** The raw Markdown, front matter included: the panel decides what to show. */
  text: string
}

declare module 'orca' {
  interface PluginRequests {
    /** The vault folders the person added, in the order they were added. */
    'vaults.list': { output: { vaults: string[] } }
    /** Adds an existing folder as a vault; refuses a path that is not a folder. */
    'vaults.add': { input: { path: string }; output: { vaults: string[]; added: string } }
    /** Opens the system folder dialog and adds the chosen folder; `added` is null on cancel. */
    'vaults.pick': { output: { vaults: string[]; added: string | null } }
    /** Removes a vault from the list. Never touches its files. */
    'vaults.remove': { input: { path: string }; output: { vaults: string[] } }
    /** Every folder and `.md` note of a vault, folders first. */
    'notes.tree': { input: { vault: string }; output: { items: TreeItem[]; truncated: boolean } }
    /** One note's Markdown. */
    'notes.read': { input: { vault: string; path: string }; output: NoteContent }
    /** Notes whose name or text contains the query, case-insensitive. */
    'notes.search': { input: { vault: string; query: string }; output: { results: NoteFile[] } }
    /** The note a `[[wikilink]]` target points to, or null. */
    'notes.resolve': { input: { vault: string; target: string }; output: { path: string | null } }
    /** Opens the note in Obsidian through an `obsidian://` URL. */
    'notes.openInObsidian': { input: { vault: string; path: string }; output: { opened: boolean } }
  }
}
