// The sidebar panel: a toolbar, then either the notes tree, the search, the vault list or the
// open note, which takes the whole panel. Orca strips the types and compiles the JSX on load.
// Every text comes from src/panel/i18n.ts, in Orca's language.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Collapsible,
  EmptyState,
  Heading,
  env,
  IconButton,
  Image,
  Input,
  KeyValue,
  Link,
  List,
  ListItem,
  Markdown,
  plugin,
  read,
  Row,
  Select,
  Separator,
  set,
  Skeleton,
  Spinner,
  Stack,
  Text,
  Toolbar,
  Tree,
  type PanelContext,
  type TreeItem
} from 'orca'
import { format, messagesFor, WORKER_ERRORS, type MessageKey } from './i18n'
import { folderCrumbs, frontMatterProperties, noteLinks, noteSegments, sectionTones, splitTags, splitTitle, type NoteLink, type Property, type SectionTone, type Segment } from './markdown'
import type { NoteFile } from '../protocol'

type View = 'notes' | 'search' | 'vaults' | 'reading'
/** A link of the open note: `path` is the note it leads to, null when there is none, undefined when unknown. */
type ResolvedLink = NoteLink & { path?: string | null }
type OpenNote = { path: string; title: string; segments: Segment[]; links: ResolvedLink[]; properties: Property[] }

/** The folder dialog waits for the person: give it the longest wait Orca allows. */
const PICKER_TIMEOUT_MS = 120000
/** The add-a-vault block stays this wide on a wide panel, so the field is not a long thin bar. */
const ADD_VAULT_WIDTH = 420

const vaults = atom<string[]>([])
const vault = atom('vault', '', { persist: 'plugin' })
const lastNote = atom('lastNote', '', { persist: 'plugin' })
const view = atom<View>('notes')
const tree = atom<TreeItem[] | null>(null)
const truncated = atom(false)
/** How many entries the worker lists at most, as it answered with the tree. */
const treeLimit = atom(0)
const expanded = atom('expanded', [] as string[], { persist: 'plugin' })
const note = atom<OpenNote | null>(null)
const query = atom('')
const results = atom<NoteFile[] | null>(null)
const resultsTruncated = atom(false)
/** The notes linking to the open one; null while they are being looked for. */
const backlinks = atom<NoteFile[] | null>(null)
/** Each image target of the vault as a plugin file (`cache/…`), or null when it cannot be shown. */
const imageSources = atom<Record<string, string | null>>({})
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

/**
 * The vault's tree. `quiet` keeps the tree on screen while it loads (a change on disk); a
 * failure puts back what was there, so the spinner never stays.
 */
async function loadTree(options: { refresh?: boolean; quiet?: boolean } = {}): Promise<void> {
  const before = read(tree)
  if (!options.quiet) set(tree, null)
  try {
    const answer = await plugin.request('notes.tree', { vault: read(vault), refresh: options.refresh === true })
    set(tree, answer.items)
    set(truncated, answer.truncated)
    set(treeLimit, answer.limit)
  } catch (error) {
    set(tree, before || [])
    throw error
  }
}

/** The note each link leads to; unknown (pressing resolves it then) when the worker cannot say. */
async function resolveLinks(links: NoteLink[]): Promise<ResolvedLink[]> {
  if (!links.length) return []
  try {
    const answer = await plugin.request('notes.resolve', { vault: read(vault), targets: links.map((link) => link.target) })
    return links.map((link, index) => ({ ...link, path: answer.paths[index] }))
  } catch {
    return links
  }
}

async function loadBacklinks(path: string): Promise<void> {
  set(backlinks, null)
  let found: NoteFile[] = []
  try {
    found = (await plugin.request('notes.backlinks', { vault: read(vault), path })).results
  } catch {
    // The backlinks are extra: the note reads the same without them.
  }
  const open = read(note)
  if (open && open.path === path) set(backlinks, found)
}

/** Asks the worker for the note's images it has not copied yet, one after another. */
async function loadImages(segments: readonly Segment[]): Promise<void> {
  for (const segment of segments) {
    if (segment.kind !== 'image' || segment.target in read(imageSources)) continue
    let src: string | null = null
    try {
      src = (await plugin.request('notes.image', { vault: read(vault), target: segment.target })).src
    } catch {
      // Shown by its name, as before images were drawn.
    }
    set(imageSources, { ...read(imageSources), [segment.target]: src })
  }
}

/** Reads a note into the panel; `show` switches to it, otherwise the current view stays. */
async function openNote(path: string, show: boolean = true): Promise<void> {
  const answer = await plugin.request('notes.read', { vault: read(vault), path })
  const changed = read(note)?.path !== answer.path
  const links = await resolveLinks(noteLinks(answer.text, answer.path))
  const segments = noteSegments(answer.text, answer.path)
  set(note, {
    path: answer.path,
    title: answer.title,
    segments,
    links,
    properties: frontMatterProperties(answer.text)
  })
  set(lastNote, answer.path)
  if (show) set(view, 'reading')
  if (changed || show) void loadBacklinks(answer.path)
  void loadImages(segments)
}

async function followLink(link: ResolvedLink): Promise<void> {
  const path = link.path === undefined ? (await plugin.request('notes.resolve', { vault: read(vault), targets: [link.target] })).paths[0] : link.path
  if (!path) throw new Error(text('noLinkedNote', { target: link.target }))
  await openNote(path)
}

/** The vault changed on disk: the tree and the open note follow it without a spinner. */
async function followDisk(): Promise<void> {
  // An image may have changed too: its copy gets a new name, so ask again.
  set(imageSources, {})
  await loadTree({ quiet: true })
  const open = read(note)
  if (!open) return
  try {
    await openNote(open.path, false)
  } catch {
    // Renamed or deleted: the panel keeps showing what it read last.
  }
}

async function switchVault(path: string): Promise<void> {
  set(vault, path)
  set(note, null)
  set(lastNote, '')
  set(expanded, [])
  set(results, null)
  set(backlinks, null)
  set(imageSources, {})
  set(tree, [])
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
  set(resultsTruncated, answer.truncated)
}

function toggleView(next: View): void {
  set(view, read(view) === next && read(note) ? 'reading' : next)
}

/**
 * Runs once before the first render: the vault list, the tree and the note open last time, and
 * from then on the worker's word that the vault changed on disk.
 */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('notes.changed', ({ vault: changed }) => {
      if (changed === read(vault)) void guarded(followDisk)
    })
  )
  void guarded(async () => {
    const answer = await plugin.request('vaults.list')
    set(vaults, answer.vaults)
    if (!answer.vaults.length) return set(view, 'vaults')
    if (!answer.vaults.includes(read(vault))) set(vault, answer.vaults[0])
    await loadTree()
    if (!read(lastNote)) return
    try {
      await openNote(read(lastNote))
    } catch {
      // Moved or deleted since: start from the tree, with no error for a note nobody asked for.
      set(lastNote, '')
    }
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

/**
 * One vault: its name and path, then its buttons on the right. Not a ListItem: Orca draws a
 * ListItem's children under the text, and a pressable one cannot hold other controls.
 */
function VaultRow(path: string) {
  const current = path === read(vault)
  return (
    <Box direction="row" align="center" gap="sm" paddingX="sm" paddingY="xs" radius="md" background={current ? 'muted' : 'none'}>
      <Box grow>
        <Stack gap="none">
          <Text weight={current ? 'semibold' : 'regular'} truncate>{folderName(path)}</Text>
          <Text muted size="xs" truncate>{path}</Text>
        </Stack>
      </Box>
      {current ? null : (
        <IconButton icon="check" label={text('useVault', { name: folderName(path) })} tooltip={text('useVaultTooltip')} variant="ghost" size="sm" onPress={() => guarded(() => switchVault(path))} />
      )}
      <IconButton icon="delete" label={text('removeVault', { name: folderName(path) })} tooltip={text('removeVaultTooltip')} variant="ghost" size="sm" onPress={() => guarded(() => removeVault(path))} />
    </Box>
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
      <Stack gap="xs">{list.map(VaultRow)}</Stack>
      <Card title={text('addAnotherVault')}>{AddVault()}</Card>
    </Stack>
  )
}

function NotesView() {
  const items = read(tree)
  if (items === null) return <Spinner label={text('readingVault')} />
  // After a failed read the error says what happened: "no notes" would mislead.
  if (items.length === 0 && read(problem)) return null
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
      {read(truncated) ? <Text muted size="xs">{text('truncated', { count: read(treeLimit) })}</Text> : null}
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
            <ListItem title={hit.name} description={hit.path} icon="file-text" onPress={() => guarded(() => openNote(hit.path))}>
              {hit.snippet ? <Text muted size="xs">{hit.snippet}</Text> : null}
            </ListItem>
          ))}
        </List>
      )}
      {found && read(resultsTruncated) ? <Text muted size="xs">{text('searchTruncated', { count: found.length })}</Text> : null}
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
        <Heading level={2}>{segment.text}</Heading>
      </Box>
    </Box>
  )
}

/** An image of the vault: a placeholder while the worker copies it, its name when it cannot. */
function ImageView(segment: Extract<Segment, { kind: 'image' }>) {
  const src = read(imageSources)[segment.target]
  if (src === undefined) return <Skeleton shape="block" label={text('loadingImage')} />
  if (src === null) return <Text muted size="sm">{`(${segment.alt})`}</Text>
  return <Image src={src} alt={segment.alt} size="full" fit="contain" rounded />
}

function SegmentView(segment: Segment, tone: SectionTone) {
  if (segment.kind === 'markdown') return <Markdown content={segment.text} />
  if (segment.kind === 'image') return ImageView(segment)
  if (segment.kind === 'heading') return HeadingView(segment, tone)
  return (
    <Callout tone={segment.tone} title={segment.title}>
      <Markdown content={segment.text} />
    </Callout>
  )
}

/** A link of the note as a button; a link to no note is drawn, but cannot be pressed. */
function LinkButton(link: ResolvedLink) {
  const missing = link.path === null
  return (
    <Button size="xs" variant="outline" icon="link" disabled={missing} tooltip={missing ? text('linkMissing') : link.path || link.target} onPress={() => guarded(() => followLink(link))}>
      {link.label}
    </Button>
  )
}

/** Shows the notes tree opened down to a folder (`''`, the vault itself, leaves it as it was). */
function showInTree(path: string): void {
  const parts = path ? path.split('/') : []
  const ancestors = parts.map((_part, index) => parts.slice(0, index + 1).join('/'))
  set(expanded, [...new Set([...read(expanded), ...ancestors])])
  set(view, 'notes')
}

/**
 * The note's head: the folders it sits in, each opening the notes tree there; the title, the
 * opening `#` heading or the file name; the tags as badges; the other properties folded away.
 * A rule sets it apart from the note.
 */
function NoteHeader(open: OpenNote) {
  const { title } = splitTitle(open.segments, open.title)
  const { tags, others } = splitTags(open.properties)
  const crumbs = [{ label: folderName(read(vault)), path: '' }, ...folderCrumbs(open.path)]
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center" wrap>
        {crumbs.map((crumb, index) => [
          index > 0 ? <Text muted size="xs">›</Text> : null,
          // Orca's Link holds only text, at the size of the text around it.
          <Link onPress={() => showInTree(crumb.path)}>{crumb.label}</Link>
        ])}
      </Row>
      <Heading level={1}>{title}</Heading>
      {tags.length ? (
        <Row gap="xs" wrap>
          {tags.map((tag) => (
            <Badge tone="accent">{`#${tag}`}</Badge>
          ))}
        </Row>
      ) : null}
      {others.length ? (
        <Collapsible title={text('propertiesCount', { count: others.length })}>
          <KeyValue label={text('properties')} items={others.map(({ label, value }) => ({ label, value }))} />
        </Collapsible>
      ) : null}
      <Separator />
    </Stack>
  )
}

function ReadingView() {
  const open = read(note)
  if (!open) return <EmptyState icon="file-text" title={text('chooseNoteTitle')} description={text('chooseNoteDescription')} />
  const linkedFrom = read(backlinks) || []
  return (
    <Stack gap="sm">
      {NoteHeader(open)}
      {(() => {
        const { body } = splitTitle(open.segments, open.title)
        const tones = sectionTones(body)
        return body.map((segment, index) => SegmentView(segment, tones[index]))
      })()}
      {open.links.length || linkedFrom.length ? (
        // Apart from the note: a rule and room above, like a section of its own.
        <Box paddingY="md">
          <Stack gap="sm">
            <Separator />
            {open.links.length ? (
              <Stack gap="xs">
                <Text muted size="xs" weight="medium">{text('links')}</Text>
                <Row gap="xs" wrap>{open.links.map(LinkButton)}</Row>
              </Stack>
            ) : null}
            {linkedFrom.length ? (
              <Stack gap="xs">
                <Text muted size="xs" weight="medium">{text('backlinks')}</Text>
                <Row gap="xs" wrap>
                  {linkedFrom.map((hit) => (
                    <Button size="xs" variant="ghost" icon="file-text" tooltip={hit.path} onPress={() => guarded(() => openNote(hit.path))}>{hit.name}</Button>
                  ))}
                </Row>
              </Stack>
            ) : null}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  )
}

async function openInObsidian(path: string): Promise<void> {
  await plugin.request('notes.openInObsidian', { vault: read(vault), path })
}

/** Reads the disk again, whatever the worker kept; the view stays where it is. */
async function reload(open: OpenNote | null): Promise<void> {
  set(imageSources, {})
  await loadTree({ refresh: true })
  if (open) await openNote(open.path, read(view) === 'reading')
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
