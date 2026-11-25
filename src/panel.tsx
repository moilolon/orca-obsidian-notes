// The sidebar panel: a toolbar, then either the notes tree, the search, the vault list or the
// open note, which takes the whole panel. Orca strips the types and compiles the JSX on load.
// Every text comes from src/i18n.ts, in Orca's language.
import {
  atom,
  Box,
  Button,
  Callout,
  Card,
  EmptyState,
  Heading,
  env,
  IconButton,
  Input,
  List,
  ListItem,
  Markdown,
  plugin,
  read,
  Row,
  Select,
  Separator,
  set,
  Spinner,
  Stack,
  Text,
  Toolbar,
  Tree,
  type PanelContext,
  type TreeItem
} from 'orca'
import { format, messagesFor, WORKER_ERRORS, type MessageKey } from './i18n'
import { noteSegments, sectionTones, wikilinkTargets, type SectionTone, type Segment } from './markdown'
import type { NoteFile } from './protocol'

type View = 'notes' | 'search' | 'vaults' | 'reading'
type OpenNote = { path: string; title: string; segments: Segment[]; links: string[] }

/** The folder dialog waits for the person: give it the longest wait Orca allows. */
const PICKER_TIMEOUT_MS = 120000
const MAX_TREE_ENTRIES = 4000
/** The add-a-vault block stays this wide on a wide panel, so the field is not a long thin bar. */
const ADD_VAULT_WIDTH = 420

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

/** The texts in Orca's language; reading it while rendering follows a language change. */
function text(key: MessageKey, values?: Record<string, string | number>): string {
  return format(messagesFor(env.locale)[key], values)
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

/** A worker error by its code, in the person's language; anything else as it came. */
function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const key = WORKER_ERRORS[message]
  return key ? text(key) : message
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
  if (!answer.path) throw new Error(text('noLinkedNote', { target }))
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
  await switchVault(answer.added)
}

async function pickVault(): Promise<void> {
  const answer = await plugin.request('vaults.pick', undefined, { timeoutMs: PICKER_TIMEOUT_MS })
  set(vaults, answer.vaults)
  if (answer.added) await switchVault(answer.added)
}

async function removeVault(path: string): Promise<void> {
  const answer = await plugin.request('vaults.remove', { path })
  set(vaults, answer.vaults)
  if (read(vault) !== path) return
  if (answer.vaults.length) return switchVault(answer.vaults[0])
  set(vault, '')
  set(tree, [])
  set(note, null)
  set(view, 'vaults')
}

async function search(value: string): Promise<void> {
  set(query, value)
  if (!value.trim()) return set(results, null)
  const answer = await plugin.request('notes.search', { vault: read(vault), query: value })
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

/** Browse first, the pasted path as the alternative: one centered block of a readable width. */
function AddVault() {
  return (
    <Row justify="center">
      <Box width="100%" maxWidth={ADD_VAULT_WIDTH}>
        <Stack gap="md" align="stretch">
          <Row justify="center">
            <Button icon="folder" variant="solid" tone="accent" onPress={() => guarded(pickVault)}>{text('browse')}</Button>
          </Row>
          <Row justify="center">
            <Text muted size="xs">{text('orPastePath')}</Text>
          </Row>
          <Row gap="xs" align="center">
            <Box grow>
              <Input label={text('folderPath')} labelHidden placeholder={text('folderPlaceholder')} value={read(newVault)} onChange={(value) => set(newVault, value)} onSubmit={() => guarded(addVault)} />
            </Box>
            <Button icon="add" variant="outline" disabled={!read(newVault).trim()} onPress={() => guarded(addVault)}>{text('add')}</Button>
          </Row>
        </Stack>
      </Box>
    </Row>
  )
}

function VaultsView() {
  const list = read(vaults)
  if (list.length === 0) {
    return (
      <Stack gap="lg">
        <EmptyState icon="book" title={text('addVaultTitle')} description={text('addVaultDescription')} />
        {AddVault()}
      </Stack>
    )
  }
  return (
    <Stack gap="lg">
      <List label={text('vaultList')}>
        {list.map((path) => (
          <ListItem title={folderName(path)} description={path} icon="folder" current={path === read(vault)} onPress={() => guarded(() => switchVault(path))}>
            <IconButton icon="remove" label={text('removeVault', { name: folderName(path) })} tooltip={text('removeVaultTooltip')} variant="ghost" size="xs" onPress={() => guarded(() => removeVault(path))} />
          </ListItem>
        ))}
      </List>
      <Card title={text('addAnotherVault')}>{AddVault()}</Card>
    </Stack>
  )
}

function NotesView() {
  const items = read(tree)
  if (items === null) return <Spinner label={text('readingVault')} />
  if (items.length === 0) return <EmptyState icon="file-text" title={text('noNotesTitle')} description={text('noNotesDescription')} />
  return (
    <Stack gap="xs">
      <Tree
        label={text('notesTree')}
        items={items}
        selected={read(lastNote) || undefined}
        expanded={read(expanded)}
        maxHeight="none"
        onToggle={({ key, expanded: open }) => set(expanded, open ? [...read(expanded), key] : read(expanded).filter((k) => k !== key))}
        onSelect={({ key }) => {
          if (key.toLowerCase().endsWith('.md')) void guarded(() => openNote(key))
        }}
      />
      {read(truncated) ? <Text muted size="xs">{text('truncated', { count: MAX_TREE_ENTRIES })}</Text> : null}
    </Stack>
  )
}

function SearchView() {
  const found = read(results)
  return (
    <Stack gap="sm">
      <Input label={text('searchLabel')} labelHidden type="search" placeholder={text('searchPlaceholder')} value={read(query)} onChange={(value) => set(query, value)} onSubmit={(value) => guarded(() => search(value))} />
      {found === null ? null : found.length === 0 ? (
        <Text muted>{text('noResults')}</Text>
      ) : (
        <List label={text('results')}>
          {found.map((hit) => (
            <ListItem title={hit.name} description={hit.path} icon="file-text" onPress={() => guarded(() => openNote(hit.path))} />
          ))}
        </List>
      )}
    </Stack>
  )
}

/**
 * A heading, drawn by the Markdown viewer (its sizes read best), with room around it; a `##`
 * section also opens with a rule, so each section stands apart from the one before.
 */
function HeadingView(segment: Extract<Segment, { kind: 'heading' }>, tone: SectionTone) {
  if (segment.level === 1) return <Markdown content={segment.markdown} />
  // Subsections take their section's color, at body size: below the section, still its own.
  if (segment.level === 3) {
    return (
      <Box paddingY="xs">
        <Text tone={tone} weight="semibold">{segment.text}</Text>
      </Box>
    )
  }
  // `####` and deeper: the section's color still, one step smaller and lighter than `###`.
  if (segment.level === 4) {
    return (
      <Box paddingY="xs">
        <Text tone={tone} size="sm" weight="medium">{segment.text}</Text>
      </Box>
    )
  }
  // A `##` section opens on a band of its own color, with clear room after the section before.
  // Orca's Heading carries no margins of its own, so the band centers the title evenly.
  return (
    <Box paddingY="lg">
      <Box background={tone} border={tone} radius="md" paddingX="sm" paddingY="sm" direction="row" align="center">
        <Heading level={1}>{segment.text}</Heading>
      </Box>
    </Box>
  )
}

function SegmentView(segment: Segment, tone: SectionTone) {
  if (segment.kind === 'markdown') return <Markdown content={segment.text} />
  if (segment.kind === 'heading') return HeadingView(segment, tone)
  return (
    <Callout tone={segment.tone} title={segment.title}>
      <Markdown content={segment.text} />
    </Callout>
  )
}

function ReadingView() {
  const open = read(note)
  if (!open) return <EmptyState icon="file-text" title={text('chooseNoteTitle')} description={text('chooseNoteDescription')} />
  return (
    <Stack gap="sm">
      <Text muted size="xs" truncate>{open.path}</Text>
      {(() => {
        const tones = sectionTones(open.segments)
        return open.segments.map((segment, index) => SegmentView(segment, tones[index]))
      })()}
      {open.links.length ? (
        // Apart from the note: a rule and room above, like a section of its own.
        <Box paddingY="md">
          <Stack gap="sm">
            <Separator />
            <Text muted size="xs" weight="medium">{text('links')}</Text>
            <Row gap="xs" wrap>
              {open.links.map((target) => (
                <Button size="xs" variant="outline" icon="link" onPress={() => guarded(() => followLink(target))}>{target}</Button>
              ))}
            </Row>
          </Stack>
        </Box>
      ) : null}
    </Stack>
  )
}

async function openInObsidian(path: string): Promise<void> {
  await plugin.request('notes.openInObsidian', { vault: read(vault), path })
}

async function reload(open: OpenNote | null): Promise<void> {
  await loadTree()
  if (open) await openNote(open.path)
}

export default function Panel() {
  const current = read(view)
  const list = read(vaults)
  const open = read(note)
  // Until there is a vault, the only thing to do is add one: no toolbar to distract from it.
  if (list.length === 0) {
    return (
      <Stack gap="sm">
        {read(problem) ? <Callout tone="danger" title={text('errorTitle')}>{read(problem)}</Callout> : null}
        {VaultsView()}
      </Stack>
    )
  }
  return (
    <Stack gap="sm">
      <Toolbar label={text('toolbar')}>
        {list.length > 1 ? (
          <Select label={text('vaultSelect')} labelHidden value={read(vault)} options={list.map((path) => ({ value: path, label: folderName(path) }))} onChange={(path) => guarded(() => switchVault(path))} />
        ) : null}
        <IconButton icon="folder" label={text('treeButton')} tooltip={text('treeTooltip')} variant={current === 'notes' ? 'solid' : 'ghost'} size="sm" onPress={() => toggleView('notes')} />
        <IconButton icon="search" label={text('searchButton')} tooltip={text('searchButton')} variant={current === 'search' ? 'solid' : 'ghost'} size="sm" onPress={() => toggleView('search')} />
        <IconButton icon="file-text" label={text('noteButton')} tooltip={text('noteTooltip')} variant={current === 'reading' ? 'solid' : 'ghost'} size="sm" disabled={!open} onPress={() => set(view, 'reading')} />
        <IconButton icon="open-external" label={text('openInObsidian')} tooltip={text('openInObsidian')} variant="ghost" size="sm" disabled={!open} onPress={() => guarded(() => openInObsidian(open ? open.path : ''))} />
        <IconButton icon="refresh" label={text('reload')} tooltip={text('reload')} variant="ghost" size="sm" disabled={!read(vault)} onPress={() => guarded(() => reload(open))} />
        <IconButton icon="settings" label={text('vaultsButton')} tooltip={text('vaultsButton')} variant={current === 'vaults' ? 'solid' : 'ghost'} size="sm" onPress={() => toggleView('vaults')} />
      </Toolbar>
      {read(problem) ? <Callout tone="danger" title={text('errorTitle')}>{read(problem)}</Callout> : null}
      {current === 'vaults' ? VaultsView() : current === 'search' ? SearchView() : current === 'notes' ? NotesView() : ReadingView()}
    </Stack>
  )
}
