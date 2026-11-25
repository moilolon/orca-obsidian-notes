// The sidebar panel: a toolbar, then either the notes tree, the search, the vault list or the
// open note, which takes the whole panel. Orca strips the types and compiles the JSX on load.
import {
  atom,
  Button,
  Callout,
  EmptyState,
  IconButton,
  Input,
  List,
  ListItem,
  Markdown,
  plugin,
  read,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  Text,
  Toolbar,
  Tree,
  type PanelContext,
  type TreeItem
} from 'orca'
import { noteSegments, wikilinkTargets, type Segment } from './markdown'
import type { NoteFile } from './protocol'

type View = 'notes' | 'search' | 'vaults' | 'reading'
type OpenNote = { path: string; title: string; segments: Segment[]; links: string[] }

const vaults = atom<string[]>([])
const vault = atom('vault', '', { persist: 'plugin' })
const lastNote = atom('lastNote', '', { persist: 'plugin' })
const view = atom<View>('notes')
const tree = atom<TreeItem[] | null>(null)
const truncated = atom(false)
const expanded = atom('expanded', [] as string[], { persist: 'plugin' })
const note = atom<OpenNote | null>(null)
const query = atom('')
const results = atom<NoteFile[] | null>(null)
const newVault = atom('')
const problem = atom('')

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function guarded(action: () => Promise<void>): Promise<void> {
  set(problem, '')
  try {
    await action()
  } catch (error) {
    set(problem, errorText(error))
  }
}

async function loadTree(): Promise<void> {
  set(tree, null)
  const answer = await plugin.request('notes.tree', { vault: read(vault) })
  set(tree, answer.items)
  set(truncated, answer.truncated)
}

async function openNote(path: string): Promise<void> {
  const answer = await plugin.request('notes.read', { vault: read(vault), path })
  set(note, { path: answer.path, title: answer.title, segments: noteSegments(answer.text), links: wikilinkTargets(answer.text) })
  set(lastNote, answer.path)
  set(view, 'reading')
}

async function followLink(target: string): Promise<void> {
  const answer = await plugin.request('notes.resolve', { vault: read(vault), target })
  if (!answer.path) throw new Error(`No hay ninguna nota "${target}" en esta bóveda`)
  await openNote(answer.path)
}

async function switchVault(path: string): Promise<void> {
  set(vault, path)
  set(note, null)
  set(lastNote, '')
  set(expanded, [])
  set(results, null)
  set(view, 'notes')
  await loadTree()
}

async function addVault(): Promise<void> {
  const path = read(newVault).trim()
  if (!path) return
  const answer = await plugin.request('vaults.add', { path })
  set(vaults, answer.vaults)
  set(newVault, '')
  await switchVault(answer.vaults[answer.vaults.length - 1])
}

async function removeVault(path: string): Promise<void> {
  const answer = await plugin.request('vaults.remove', { path })
  set(vaults, answer.vaults)
  if (read(vault) === path) {
    if (answer.vaults.length) await switchVault(answer.vaults[0])
    else {
      set(vault, '')
      set(tree, [])
      set(note, null)
      set(view, 'vaults')
    }
  }
}

async function search(text: string): Promise<void> {
  set(query, text)
  if (!text.trim()) return set(results, null)
  const answer = await plugin.request('notes.search', { vault: read(vault), query: text })
  set(results, answer.results)
}

function toggleView(next: View): void {
  set(view, read(view) === next && read(note) ? 'reading' : next)
}

/** Runs once before the first render: the vault list, the tree and the note open last time. */
export function setup(_ctx: PanelContext): void {
  void guarded(async () => {
    const answer = await plugin.request('vaults.list')
    set(vaults, answer.vaults)
    if (!answer.vaults.length) return set(view, 'vaults')
    if (!answer.vaults.includes(read(vault))) set(vault, answer.vaults[0])
    await loadTree()
    if (read(lastNote)) await openNote(read(lastNote))
  })
}

function VaultsView() {
  const list = read(vaults)
  return (
    <Stack gap="sm">
      {list.length === 0 ? (
        <EmptyState icon="book" title="Añade una bóveda" description="Pega la ruta de una carpeta de notas, por ejemplo la de tu bóveda de Obsidian." />
      ) : (
        <List label="Bóvedas">
          {list.map((path) => (
            <ListItem title={folderName(path)} description={path} icon="folder" current={path === read(vault)} onPress={() => guarded(() => switchVault(path))}>
              <IconButton icon="remove" label={`Quitar ${folderName(path)}`} tooltip="Quitar de la lista (no borra nada)" variant="ghost" size="xs" onPress={() => guarded(() => removeVault(path))} />
            </ListItem>
          ))}
        </List>
      )}
      <Row gap="xs">
        <Input label="Ruta de la carpeta" labelHidden placeholder="C:\ruta\a\la\bóveda" value={read(newVault)} onChange={(value) => set(newVault, value)} onSubmit={() => guarded(addVault)} />
        <Button icon="add" onPress={() => guarded(addVault)}>Añadir</Button>
      </Row>
    </Stack>
  )
}

function NotesView() {
  const items = read(tree)
  if (items === null) return <Spinner label="Leyendo la bóveda" />
  if (items.length === 0) return <EmptyState icon="file-text" title="No hay notas" description="Esta carpeta no tiene ficheros .md." />
  return (
    <Stack gap="xs">
      <Tree
        label="Árbol de notas"
        items={items}
        selected={read(lastNote) || undefined}
        expanded={read(expanded)}
        maxHeight="none"
        onToggle={({ key, expanded: open }) => set(expanded, open ? [...read(expanded), key] : read(expanded).filter((k) => k !== key))}
        onSelect={({ key }) => {
          if (key.toLowerCase().endsWith('.md')) void guarded(() => openNote(key))
        }}
      />
      {read(truncated) ? <Text muted size="xs">La bóveda es muy grande: solo se listan las primeras 4000 entradas.</Text> : null}
    </Stack>
  )
}

function SearchView() {
  const found = read(results)
  return (
    <Stack gap="sm">
      <Input label="Buscar" labelHidden type="search" placeholder="Buscar en nombre y contenido" value={read(query)} onChange={(value) => set(query, value)} onSubmit={(value) => guarded(() => search(value))} />
      {found === null ? null : found.length === 0 ? (
        <Text muted>Sin resultados.</Text>
      ) : (
        <List label="Resultados">
          {found.map((hit) => (
            <ListItem title={hit.name} description={hit.path} icon="file-text" onPress={() => guarded(() => openNote(hit.path))} />
          ))}
        </List>
      )}
    </Stack>
  )
}

function SegmentView(segment: Segment) {
  if (segment.kind === 'markdown') return <Markdown content={segment.text} />
  return (
    <Callout tone={segment.tone} title={segment.title}>
      <Markdown content={segment.text} />
    </Callout>
  )
}

function ReadingView() {
  const open = read(note)
  if (!open) return <EmptyState icon="file-text" title="Elige una nota" description="Ábrela desde el árbol o la búsqueda." />
  return (
    <Stack gap="sm">
      <Text muted size="xs" truncate>{open.path}</Text>
      {open.segments.map((segment) => SegmentView(segment))}
      {open.links.length ? (
        <Stack gap="xs">
          <Text muted size="xs">Enlaces</Text>
          <Row gap="xs" wrap>
            {open.links.map((target) => (
              <Button size="xs" variant="outline" icon="link" onPress={() => guarded(() => followLink(target))}>{target}</Button>
            ))}
          </Row>
        </Stack>
      ) : null}
    </Stack>
  )
}

export default function Panel() {
  const current = read(view)
  const list = read(vaults)
  const open = read(note)
  return (
    <Stack gap="sm">
      <Toolbar label="Notas">
        {list.length > 1 ? (
          <Select label="Bóveda" labelHidden value={read(vault)} options={list.map((path) => ({ value: path, label: folderName(path) }))} onChange={(path) => guarded(() => switchVault(path))} />
        ) : null}
        <IconButton icon="folder" label="Notas" tooltip="Árbol de notas" variant={current === 'notes' ? 'solid' : 'ghost'} size="sm" onPress={() => toggleView('notes')} />
        <IconButton icon="search" label="Buscar" tooltip="Buscar" variant={current === 'search' ? 'solid' : 'ghost'} size="sm" onPress={() => toggleView('search')} />
        <IconButton icon="file-text" label="Nota" tooltip="Volver a la nota" variant={current === 'reading' ? 'solid' : 'ghost'} size="sm" disabled={!open} onPress={() => set(view, 'reading')} />
        <IconButton icon="open-external" label="Abrir en Obsidian" tooltip="Abrir en Obsidian" variant="ghost" size="sm" disabled={!open} onPress={() => guarded(async () => { await plugin.request('notes.openInObsidian', { vault: read(vault), path: open ? open.path : '' }) })} />
        <IconButton icon="refresh" label="Recargar" tooltip="Recargar" variant="ghost" size="sm" disabled={!read(vault)} onPress={() => guarded(async () => { await loadTree(); if (open) await openNote(open.path) })} />
        <IconButton icon="settings" label="Bóvedas" tooltip="Bóvedas" variant={current === 'vaults' ? 'solid' : 'ghost'} size="sm" onPress={() => toggleView('vaults')} />
      </Toolbar>
      {read(problem) ? <Callout tone="danger" title="No se pudo">{read(problem)}</Callout> : null}
      {current === 'vaults' ? VaultsView() : current === 'search' ? SearchView() : current === 'notes' ? NotesView() : ReadingView()}
    </Stack>
  )
}
