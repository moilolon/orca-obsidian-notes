// The panel <-> worker contract, declared once: src/panel/panel.tsx and src/worker/worker.ts both read it.
import type { TreeItem } from 'orca'

export type NoteFile = {
  path: string
  name: string
  /** For a search hit found in the text: the words around the match, on one line. */
  snippet?: string
}

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
    /**
     * Every folder and `.md` note of a vault, folders first, up to `limit` entries. `refresh`
     * reads the disk again instead of the worker's copy.
     */
    'notes.tree': { input: { vault: string; refresh?: boolean }; output: { items: TreeItem[]; truncated: boolean; limit: number } }
    /** One note's Markdown. */
    'notes.read': { input: { vault: string; path: string }; output: NoteContent }
    /** Notes whose name or text contains the query, case-insensitive; `truncated` past the limit. */
    'notes.search': { input: { vault: string; query: string }; output: { results: NoteFile[]; truncated: boolean } }
    /** The note each link target points to (a `[[wikilink]]` target or a vault path), or null. */
    'notes.resolve': { input: { vault: string; targets: string[] }; output: { paths: (string | null)[] } }
    /** The notes that link to this one. */
    'notes.backlinks': { input: { vault: string; path: string }; output: { results: NoteFile[] } }
    /**
     * An image of the vault as a file of the plugin, for Orca's `Image`: the worker copies it into
     * the plugin's `cache/` folder. `src` is null when there is no such image or it is too large.
     */
    'notes.image': { input: { vault: string; target: string }; output: { src: string | null } }
    /** Opens the note in Obsidian through an `obsidian://` URL. */
    'notes.openInObsidian': { input: { vault: string; path: string }; output: { opened: boolean } }
  }
  interface PluginPanelEvents {
    /** Something in the vault changed on disk; `vault` is spelled as the vault list stores it. */
    'notes.changed': { vault: string }
  }
}
