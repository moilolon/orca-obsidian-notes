// The sidebar panel: a toolbar, then either the notes tree, the search, the vault list or the
// open note, which takes the whole panel. Orca strips the types and compiles the JSX on load.
// Every text comes from src/panel/i18n.ts, in Orca's language.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Code,
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
import { LONG_PROPERTY_CHARS, fileLinks, folderCrumbs, frontMatterProperties, mapImages, plainSnippet, noteLinks, noteSegments, sectionColor, sectionIndexes, splitTags, splitTitle, type Align, type BadgeImage, type Inline, type NoteLink, type Property, type Segment, type TaskStatus } from './markdown'
import type { NoteFile } from '../protocol'

type View = 'notes' | 'search' | 'vaults' | 'reading'
/** A link of the open note: `path` is the note it leads to, null when there is none, undefined when unknown. */
type ResolvedLink = NoteLink & { path?: string | null }
/** `files`: the files the text mentions, listed below it; `placed`: those on lines of their own, drawn where they are. */
type OpenNote = { path: string; title: string; segments: Segment[]; links: ResolvedLink[]; files: ResolvedLink[]; placed: ResolvedLink[]; properties: Property[] }

/** The folder dialog waits for the person: give it the longest wait Orca allows. */
const PICKER_TIMEOUT_MS = 120000
/**
 * The worker stops when idle and starts again on the next request, which can fail while the
 * computer wakes up: the vault list is asked again after these waits, the last one from then on.
 * Past them the error shows, and the panel keeps trying until the worker answers.
 */
const LIST_RETRY_DELAYS_MS = [500, 2000, 5000]
/** The add-a-vault block stays this wide on a wide panel, so the field is not a long thin bar. */
const ADD_VAULT_WIDTH = 420

const vaults = atom<string[]>([])
/** False until the worker has answered with the vault list: until then, no "add a vault". */
const vaultsLoaded = atom(false)
const vault = atom('vault', '', { persist: 'plugin' })
const lastNote = atom('lastNote', '', { persist: 'plugin' })
/**
 * Where the person has been in the panel, oldest first, and which step is shown: back and
 * forward walk it, as in a browser. A step is a view (`notes`, `search`, `vaults`) or a note
 * (`note:` and its path).
 */
const steps = atom('steps', [] as string[], { persist: 'plugin' })
const stepsAt = atom('stepsAt', -1, { persist: 'plugin' })
/** The trail keeps this many steps: the oldest go first. */
const MAX_STEPS = 50
const NOTE_STEP = 'note:'

/** The notes read last, newest first and each once: the search view lists them, and the person can clear them. Apart from the trail, so clearing them leaves back and forward as they were. */
const recent = atom('recent', [] as string[], { persist: 'plugin' })
const MAX_RECENT = 10

/** Adds a step to the trail, dropping what was ahead, as a browser does on a new page; the step shown again adds nothing. */
function recordStep(step: string): void {
  if (read(steps)[read(stepsAt)] === step) return
  const next = [...read(steps).slice(0, read(stepsAt) + 1), step].slice(-MAX_STEPS)
  set(steps, next)
  set(stepsAt, next.length - 1)
}

/** Shows a view, and adds it to the trail: the open note when it is the reading view. */
function showView(next: View): void {
  set(view, next)
  const open = read(note)
  if (next !== 'reading') recordStep(next)
  else if (open) recordStep(NOTE_STEP + open.path)
}
const view = atom<View>('notes')
const tree = atom<TreeItem[] | null>(null)
const truncated = atom(false)
/** How many entries the worker lists at most, as it answered with the tree. */
const treeLimit = atom(0)
const expanded = atom('expanded', [] as string[], { persist: 'plugin' })
const note = atom<OpenNote | null>(null)
const query = atom('')
/** What the notes tree is narrowed to, by name. */
const treeFilter = atom('')
const results = atom<NoteFile[] | null>(null)
const resultsTruncated = atom(false)
/** While the tree is filtered, the folders the person folded: the rest, on the way to a match, are open. Emptied when the filter changes. */
const filterFolded = atom<string[]>([])
/** The folders of the search results the person folded. Emptied by a new search. */
const foldedGroups = atom<string[]>([])
/** How the search view orders the tags: the most used first, or from A to Z. Remembered. */
const tagOrder = atom('tagOrder', 'used' as 'used' | 'az', { persist: 'plugin' })
/** The vault's tags and how many notes have each; null until asked for, and again when the vault changes. */
const vaultTags = atom<{ tag: string; count: number }[] | null>(null)
/** The notes linking to the open one; null while they are being looked for. */
const backlinks = atom<NoteFile[] | null>(null)
/** Each image target of the vault as a plugin file (`cache/…`), or null when it cannot be shown. */
const imageSources = atom<Record<string, string | null>>({})
/** A drawing the worker made (a diagram, a row of badges): its PNG in the plugin and its width in CSS pixels. */
type Drawing = { src: string; width: number }
/** Each Mermaid diagram, by its colors and code, as a PNG of the plugin, or null when it cannot be drawn. */
const diagramSources = atom<Record<string, Drawing | null>>({})
/** Each row of README badges, by their addresses and alignment, as a PNG of the plugin, or null when it cannot be drawn. */
const badgeSources = atom<Record<string, Drawing | null>>({})
/** The line under a section heading, by its color, as a PNG of the plugin, or null when it cannot be drawn. */
const ruleSources = atom<Record<string, string | null>>({})
/** One pixel of each section color, as a PNG of the plugin, or null when it cannot be drawn: stretched into the line under a subsection. */
const swatchSources = atom<Record<string, string | null>>({})
/** Whether the open note's properties are unfolded; remembered from one note to the next. */
const propertiesOpen = atom('propertiesOpen', false, { persist: 'plugin' })
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

/** The vault file each file link names; unknown (pressing tries anyway) when the worker cannot say. */
async function resolveFiles(links: NoteLink[]): Promise<ResolvedLink[]> {
  if (!links.length) return []
  try {
    const answer = await plugin.request('notes.resolveFiles', { vault: read(vault), targets: links.map((link) => link.target) })
    return links.map((link, index) => ({ ...link, path: answer.paths[index] }))
  } catch {
    return links
  }
}

async function openFile(link: ResolvedLink): Promise<void> {
  await plugin.request('notes.openFile', { vault: read(vault), path: link.path || link.target })
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
  // The images of the note, those inside its text and the icon a heading shows before its text.
  const targets = segments.flatMap((segment) =>
    segment.kind === 'image'
      ? [segment.target]
      : segment.kind === 'heading' && segment.icon
        ? [segment.icon]
        : segment.kind === 'markdown' && segment.images
          ? segment.images.flatMap((image) => (image.target ? [image.target] : []))
          : []
  )
  for (const target of targets) {
    if (target in read(imageSources)) continue
    let src: string | null = null
    try {
      src = (await plugin.request('notes.image', { vault: read(vault), target })).src
    } catch {
      // Shown by its name, as before images were drawn.
    }
    set(imageSources, { ...read(imageSources), [target]: src })
  }
}

/** The diagrams asked for and not answered yet, so a render does not ask twice. */
const diagramsAsked = new Set<string>()

/** Asks the worker to draw a Mermaid diagram; until it answers, the panel shows a placeholder. */
async function loadDiagram(key: string, code: string, scheme: 'light' | 'dark'): Promise<void> {
  if (diagramsAsked.has(key)) return
  diagramsAsked.add(key)
  let drawing: Drawing | null = null
  try {
    const answer = await plugin.request('notes.diagram', { code, scheme })
    drawing = answer.src ? { src: answer.src, width: answer.width } : null
  } catch {
    // Shown as code, as before diagrams were drawn.
  }
  diagramsAsked.delete(key)
  set(diagramSources, { ...read(diagramSources), [key]: drawing })
}

/** Asks the worker for the color swatches not drawn yet, all at once. */
async function loadSwatches(colors: string[]): Promise<void> {
  const key = (color: string): string => `swatch:${color}`
  const missing = colors.filter((color) => !(color in read(swatchSources)) && !diagramsAsked.has(key(color)))
  if (!missing.length) return
  missing.forEach((color) => diagramsAsked.add(key(color)))
  let srcs: (string | null)[] = missing.map(() => null)
  try {
    srcs = (await plugin.request('notes.swatches', { colors: missing })).srcs
  } catch {
    // No line: the heading reads without it.
  }
  missing.forEach((color) => diagramsAsked.delete(key(color)))
  set(swatchSources, { ...read(swatchSources), ...Object.fromEntries(missing.map((color, index) => [color, srcs[index] ?? null])) })
}

/** Asks the worker for the section lines not drawn yet, all at once. */
async function loadRules(colors: string[]): Promise<void> {
  const missing = colors.filter((color) => !(color in read(ruleSources)) && !diagramsAsked.has(color))
  if (!missing.length) return
  missing.forEach((color) => diagramsAsked.add(color))
  let srcs: (string | null)[] = missing.map(() => null)
  try {
    srcs = (await plugin.request('notes.rules', { colors: missing })).srcs
  } catch {
    // A plain rule instead.
  }
  missing.forEach((color) => diagramsAsked.delete(color))
  set(ruleSources, { ...read(ruleSources), ...Object.fromEntries(missing.map((color, index) => [color, srcs[index] ?? null])) })
}

/** Asks the worker to draw a row of README badges; until it answers, a placeholder. */
async function loadBadges(key: string, items: BadgeImage[], centre: boolean): Promise<void> {
  if (diagramsAsked.has(key)) return
  diagramsAsked.add(key)
  let drawing: Drawing | null = null
  try {
    const answer = await plugin.request('notes.badges', { items, centre })
    drawing = answer.src ? { src: answer.src, width: answer.width } : null
  } catch {
    // Their texts instead.
  }
  diagramsAsked.delete(key)
  set(badgeSources, { ...read(badgeSources), [key]: drawing })
}

/**
 * Reads a note into the panel; `show` switches to it, otherwise the current view stays.
 * `record` adds it to the trail when it is shown; going back or forward, or reading the
 * same note again, leaves the trail as it is.
 */
async function openNote(path: string, show: boolean = true, record: boolean = true): Promise<void> {
  const answer = await plugin.request('notes.read', { vault: read(vault), path })
  if (record && show) recordStep(NOTE_STEP + answer.path)
  if (show) set(recent, [answer.path, ...read(recent).filter((path) => path !== answer.path)].slice(0, MAX_RECENT))
  const changed = read(note)?.path !== answer.path
  const segments = noteSegments(answer.text, answer.path)
  const properties = frontMatterProperties(answer.text)
  // The files drawn where they are: on lines of their own, and as the values of a property.
  const onLines = [...segments.flatMap((segment) => (segment.kind === 'files' ? segment.items : [])), ...properties.flatMap((property) => property.files || [])]
  const [links, files, placed] = await Promise.all([resolveLinks(noteLinks(answer.text, answer.path)), resolveFiles(fileLinks(answer.text, answer.path)), resolveFiles(onLines)])
  set(note, {
    path: answer.path,
    title: answer.title,
    segments,
    links,
    files,
    placed,
    properties
  })
  set(lastNote, answer.path)
  // The tree is open down to the note read, so it is in sight there.
  const folders = folderCrumbs(answer.path).map((crumb) => crumb.path)
  if (folders.some((folder) => !read(expanded).includes(folder))) set(expanded, [...new Set([...read(expanded), ...folders])])
  if (show) set(view, 'reading')
  if (changed || show) void loadBacklinks(answer.path)
  void loadImages(segments)
}

/** Shows the step before (-1) or after (1) the one shown in the trail; a note gone since is skipped over. */
async function walkTrail(direction: -1 | 1): Promise<void> {
  for (let at = read(stepsAt) + direction; at >= 0 && at < read(steps).length; at += direction) {
    const step = read(steps)[at]
    try {
      if (step.startsWith(NOTE_STEP)) await openNote(step.slice(NOTE_STEP.length), true, false)
      else set(view, step as View)
      set(stepsAt, at)
      return
    } catch {
      // Moved or deleted since it was read: on to the next.
    }
  }
}

async function followLink(link: ResolvedLink): Promise<void> {
  const path = link.path === undefined ? (await plugin.request('notes.resolve', { vault: read(vault), targets: [link.target] })).paths[0] : link.path
  if (!path) throw new Error(text('noLinkedNote', { target: link.target }))
  await openNote(path)
}

/** The vault changed on disk: the tree and the open note follow it without a spinner. */
async function followDisk(): Promise<void> {
  set(vaultTags, null)
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
  set(steps, [])
  set(stepsAt, -1)
  set(recent, [])
  set(vaultTags, null)
  set(expanded, [])
  set(results, null)
  set(backlinks, null)
  set(imageSources, {})
  set(tree, [])
  showView('notes')
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

/** The search that waits for the person to stop typing. */
let searchTimer: ReturnType<typeof setTimeout> | null = null
/** How long after the last key a search starts: each key would otherwise read the whole vault. */
const SEARCH_DELAY_MS = 250

async function search(value: string): Promise<void> {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
  set(query, value)
  if (!value.trim()) return set(results, null)
  const answer = await plugin.request('notes.search', { vault: read(vault), query: value })
  // A slower answer to an older query does not replace a newer one.
  if (read(query) !== value) return
  set(foldedGroups, [])
  set(results, answer.results)
  set(resultsTruncated, answer.truncated)
}

/** Searches as the person types, once they pause. */
function searchSoon(value: string): void {
  set(query, value)
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void guarded(() => search(value)), SEARCH_DELAY_MS)
}

/** Asks the worker for the vault's tags, once per vault and per change of it. */
async function loadTags(): Promise<void> {
  if (read(vaultTags) !== null || diagramsAsked.has('tags')) return
  diagramsAsked.add('tags')
  try {
    set(vaultTags, (await plugin.request('notes.tags', { vault: read(vault) })).tags)
  } catch {
    // The search works without them.
    set(vaultTags, [])
  }
  diagramsAsked.delete('tags')
}

/**
 * A tag as a small pill that searches for the notes sharing it: a tinted box, lower than a
 * button, with a button in it for the press. Orca's Badge cannot be pressed, its Link is
 * underlined under the pointer, and its smallest button is taller than the text beside it:
 * the box sets the pill's height and the button, a little taller, is centred over it.
 */
function TagChip(tag: string, label: string) {
  return (
    <Box background="accent" radius="full" height={18} direction="row" align="center">
      <Button variant="ghost" size="xs" tooltip={text('searchTag', { tag })} onPress={() => guarded(() => searchTag(tag))}>{label}</Button>
    </Box>
  )
}

/** Shows the notes that have a tag, in the search view. */
async function searchTag(tag: string): Promise<void> {
  showView('search')
  await search(`#${tag}`)
}

function toggleView(next: View): void {
  showView(read(view) === next && read(note) ? 'reading' : next)
}

/** Ends the wait before the next try at the vault list: the retry button. */
let tryNow: (() => void) | null = null
/** Aborted when the panel closes, so its tries stop with it. */
let panelSignal: AbortSignal | null = null

function waitBeforeRetry(ms: number): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms)
    tryNow = () => {
      clearTimeout(timer)
      done()
    }
  })
}

/**
 * The vault list, asked again until the worker answers, so a worker starting up is never "no
 * vaults". Null when the panel closed first.
 */
async function listVaults(): Promise<string[] | null> {
  for (let attempt = 0; !panelSignal?.aborted; attempt++) {
    try {
      const { vaults: list } = await plugin.request('vaults.list')
      set(problem, '')
      return list
    } catch (error) {
      if (attempt >= LIST_RETRY_DELAYS_MS.length) set(problem, errorText(error))
      await waitBeforeRetry(LIST_RETRY_DELAYS_MS[Math.min(attempt, LIST_RETRY_DELAYS_MS.length - 1)])
      tryNow = null
    }
  }
  return null
}

/**
 * The vault list, the tree and the note open last time. Until the list arrives the panel shows
 * no vault page: while it cannot be read, the error and a button to try again at once.
 */
async function start(): Promise<void> {
  const list = await listVaults()
  if (!list) return
  set(vaults, list)
  set(vaultsLoaded, true)
  if (!list.length) return set(view, 'vaults')
  if (!list.includes(read(vault))) set(vault, list[0])
  await loadTree()
  if (!read(lastNote)) return recordStep('notes')
  try {
    await openNote(read(lastNote))
  } catch {
    // Moved or deleted since: start from the tree, with no error for a note nobody asked for.
    set(lastNote, '')
    recordStep('notes')
  }
}

/**
 * Runs once before the first render: the vault list, the tree and the note open last time, and
 * from then on the worker's word that the vault changed on disk.
 */
export function setup(ctx: PanelContext): void {
  panelSignal = ctx.signal
  ctx.signal.addEventListener('abort', () => tryNow?.())
  ctx.subscriptions.push(
    plugin.on('notes.changed', ({ vault: changed }) => {
      if (changed === read(vault)) void guarded(followDisk)
    })
  )
  void guarded(start)
}

/** Browse first, the pasted path as the alternative: one centered block of a readable width. */
function AddVault() {
  return (
    <Row justify="center">
      <Box width="100%" maxWidth={ADD_VAULT_WIDTH}>
        <Stack gap="md" align="stretch">
          {/* The whole width and neutral, as Orca's own sidebars draw their main action ("Stage All"). */}
          <Button icon="folder" variant="outline" onPress={() => guarded(pickVault)}>{text('browse')}</Button>
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

/**
 * A section's head the way Orca's own sidebars draw it (CHANGES 1, COMMITS 40): its name in
 * small capitals, muted, and how many it holds beside it.
 */
function SectionHeader(title: string, count?: number) {
  return (
    <Box direction="row" align="center" gap="xs" paddingY="xs">
      <Text muted size="xs" weight="semibold">{title.toLocaleUpperCase(env.locale)}</Text>
      {count === undefined ? null : <Text muted size="xs">{String(count)}</Text>}
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
    <Stack gap="md">
      <Stack gap="xs">
        {SectionHeader(text('vaultsButton'), list.length)}
        {list.map(VaultRow)}
      </Stack>
      <Separator />
      <Stack gap="sm">
        {SectionHeader(text('addAnotherVault'))}
        {AddVault()}
      </Stack>
    </Stack>
  )
}

/** The notes of a tree, folders left out. */
function countNotes(items: readonly TreeItem[]): number {
  return items.reduce((sum, item) => sum + (item.children ? countNotes(item.children) : item.key.toLowerCase().endsWith('.md') ? 1 : 0), 0)
}

/**
 * The tree narrowed to the entries whose name holds `words`, with the folders on the way to
 * them; a folder whose name holds them keeps all it has.
 */
function filterTree(items: readonly TreeItem[], words: string): TreeItem[] {
  const wanted = words.trim().toLocaleLowerCase()
  if (!wanted) return [...items]
  const kept: TreeItem[] = []
  for (const item of items) {
    if (item.label.toLocaleLowerCase().includes(wanted)) kept.push(item)
    else if (item.children) {
      const children = filterTree(item.children, wanted)
      if (children.length) kept.push({ ...item, children })
    }
  }
  return kept
}

function folderKeys(items: readonly TreeItem[]): string[] {
  return items.flatMap((item) => (item.children ? [item.key, ...folderKeys(item.children)] : []))
}

/** The tree with, beside each folder, how many notes it holds. */
function withCounts(items: readonly TreeItem[]): TreeItem[] {
  return items.map((item) => (item.children ? { ...item, description: String(countNotes(item.children)), children: withCounts(item.children) } : item))
}

function NotesView() {
  const items = read(tree)
  if (items === null) return <Spinner label={text('readingVault')} />
  // After a failed read the error says what happened: "no notes" would mislead.
  if (items.length === 0 && read(problem)) return null
  if (items.length === 0) return <EmptyState icon="file-text" title={text('noNotesTitle')} description={text('noNotesDescription')} />
  const filter = read(treeFilter)
  const shown = filterTree(items, filter)
  const folders = folderKeys(items)
  const filtering = Boolean(filter.trim())
  return (
    <Stack gap="sm">
      {/* The filter and, beside it, the tree's two actions: unfold and fold every folder. */}
      <Box direction="row" align="center" gap="xs">
        <Box grow minWidth={0}>
          <Input
            label={text('filterNotes')}
            labelHidden
            type="search"
            placeholder={text('filterNotes')}
            value={filter}
            onChange={(value) => {
              set(treeFilter, value)
              set(filterFolded, [])
            }}
          />
        </Box>
        {/* Orca's Input takes no icon inside it: the funnel sits after it, as the magnifier after the search box. Dimmed with nothing typed; with a filter, pressing it shows every match again, the folders folded since unfolded. */}
        <IconButton icon="filter" label={text('filterNotes')} tooltip={text('filterNotes')} variant="ghost" size="xs" disabled={!filtering} onPress={() => set(filterFolded, [])} />
        {folders.length ? (
          <Toolbar label={text('treeActions')} gap="none">
            {/* Filtering, they fold and unfold what the filter shows, and leave the tree's own folding as it was. */}
            <IconButton icon="expand" label={text('expandAll')} tooltip={text('expandAll')} variant="ghost" size="xs" onPress={() => (filtering ? set(filterFolded, []) : set(expanded, folders))} />
            <IconButton icon="collapse" label={text('collapseAll')} tooltip={text('collapseAll')} variant="ghost" size="xs" onPress={() => (filtering ? set(filterFolded, folderKeys(shown)) : set(expanded, []))} />
          </Toolbar>
        ) : null}
      </Box>
      {shown.length === 0 ? (
        <Text muted size="sm">{text('noMatches')}</Text>
      ) : (
        <Tree
          label={text('notesTree')}
          items={withCounts(shown)}
          selected={read(lastNote) || undefined}
          // While filtering, every folder on the way to a match is open, but for the ones the person folded.
          expanded={filtering ? folderKeys(shown).filter((key) => !read(filterFolded).includes(key)) : read(expanded)}
          maxHeight="none"
          onToggle={({ key, expanded: open }) => {
            if (filtering) set(filterFolded, open ? read(filterFolded).filter((k) => k !== key) : [...read(filterFolded), key])
            else set(expanded, open ? [...read(expanded), key] : read(expanded).filter((k) => k !== key))
          }}
          onSelect={({ key }) => {
            if (key.toLowerCase().endsWith('.md')) void guarded(() => openNote(key))
          }}
        />
      )}
      {read(truncated) ? <Text muted size="xs">{text('truncated', { count: read(treeLimit) })}</Text> : null}
    </Stack>
  )
}

/** The folder a note sits in, for a search hit; the vault's name for a note at its root. */
function folderOf(path: string): string {
  return path.split('/').slice(0, -1).join(' / ') || folderName(read(vault))
}

/** The search hits by the folder they sit in, folders in the order their first hit came. */
function byFolder(hits: readonly NoteFile[]): { folder: string; hits: NoteFile[] }[] {
  const groups = new Map<string, NoteFile[]>()
  for (const hit of hits) {
    const folder = folderOf(hit.path)
    groups.set(folder, [...(groups.get(folder) || []), hit])
  }
  return [...groups].map(([folder, list]) => ({ folder, hits: list }))
}

/** A group's head, as Orca's own lists have it: a band the whole width, its name and, at the right, how many it holds. */
function GroupHeader(name: string, count: number, folded: boolean) {
  const toggle = (): void => set(foldedGroups, folded ? read(foldedGroups).filter((group) => group !== name) : [...read(foldedGroups), name])
  return (
    <Box direction="row" align="center" gap="xs" background="muted" radius="md" paddingX="xs" paddingY="xs">
      <IconButton icon={folded ? 'expand' : 'collapse'} label={text(folded ? 'unfoldGroup' : 'foldGroup', { name })} variant="ghost" size="xs" onPress={toggle} />
      <Box grow minWidth={0}>
        <Text size="sm" weight="semibold" truncate>{name}</Text>
      </Box>
      <Badge>{String(count)}</Badge>
    </Box>
  )
}

/** The notes read last, the open one left out: where a search often starts. */
function recentNotes(): string[] {
  const open = read(note)?.path
  return read(recent).filter((path) => path !== open).slice(0, 5)
}

/**
 * The vault's tags to pick from, so one can be found among many: all of them in a box that
 * scrolls on its own, so many tags do not push the rest of the view away. As the person types,
 * only those that hold what is typed, with or without its `#`. The most used first, or from A
 * to Z under their initials, as the person chooses.
 */
function TagPicker(tags: readonly { tag: string; count: number }[], typed: string) {
  const wanted = typed.trim().toLowerCase().replace(/^#/, '')
  const matching = wanted ? tags.filter(({ tag }) => tag.includes(wanted)) : tags
  if (!matching.length) return null
  const order = read(tagOrder)
  const chip = ({ tag, count }: { tag: string; count: number }) => TagChip(tag, `#${tag} · ${count}`)
  // From A to Z, a row per initial: the letter, then its tags.
  const initials = new Map<string, { tag: string; count: number }[]>()
  for (const item of [...matching].sort((a, b) => a.tag.localeCompare(b.tag))) {
    const initial = (item.tag[0] || '').toLocaleUpperCase(env.locale)
    initials.set(initial, [...(initials.get(initial) || []), item])
  }
  const choice = (value: 'used' | 'az', label: string) => (
    <Button variant={order === value ? 'solid' : 'ghost'} tone="neutral" size="xs" onPress={() => set(tagOrder, value)}>{label}</Button>
  )
  return (
    <Stack gap="xs">
      <Box direction="row" align="center" gap="xs">
        <Box grow>{SectionHeader(text('tags'), matching.length)}</Box>
        <Toolbar label={text('tagOrder')} gap="none">
          {choice('used', text('topTags'))}
          {choice('az', text('azTags'))}
        </Toolbar>
      </Box>
      <Box border radius="md" padding="sm" maxHeight={176} scroll="y">
        {order === 'used' ? (
          <Row gap="xs" wrap>{matching.map(chip)}</Row>
        ) : (
          <Stack gap="xs">
            {[...initials].map(([initial, items]) => (
              <Box direction="row" align="start" gap="sm">
                <Box width={14} shrink={false}>
                  <Text muted size="xs" weight="semibold">{initial}</Text>
                </Box>
                <Box grow minWidth={0}>
                  <Row gap="xs" wrap>{items.map(chip)}</Row>
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}

function SearchView() {
  const found = read(results)
  const tags = read(vaultTags)
  void loadTags()
  const typed = read(query)
  const picker = tags && tags.length ? TagPicker(tags, typed) : null
  const shownRecent = found === null ? recentNotes() : []
  return (
    <Stack gap="sm">
      {/* Orca's Input takes no icon inside it: the magnifier is a button after it, which searches at once. */}
      <Box direction="row" align="center" gap="xs">
        <Box grow minWidth={0}>
          <Input label={text('searchLabel')} labelHidden type="search" placeholder={text('searchPlaceholder')} value={read(query)} onChange={searchSoon} onSubmit={(value) => guarded(() => search(value))} />
        </Box>
        <IconButton icon="search" label={text('searchNow')} tooltip={text('searchNow')} variant="ghost" size="xs" disabled={!read(query).trim()} onPress={() => guarded(() => search(read(query)))} />
      </Box>
      {found === null ? (
        // Nothing asked yet: the vault's tags and the notes read last, to start from.
        <Stack gap="md">
          {picker}
          {shownRecent.length ? (
            <Stack gap="xs">
              <Box direction="row" align="center" gap="xs">
                <Box grow>{SectionHeader(text('recent'), shownRecent.length)}</Box>
                <IconButton icon="delete" label={text('clearRecent')} tooltip={text('clearRecent')} variant="ghost" size="xs" onPress={() => set(recent, [])} />
              </Box>
              <List label={text('recent')}>
                {shownRecent.map((path) => (
                  <ListItem title={(path.split('/').pop() || path).replace(/\.md$/i, '')} description={folderOf(path)} icon="file-text" onPress={() => guarded(() => openNote(path))} />
                ))}
              </List>
            </Stack>
          ) : null}
          {picker || shownRecent.length ? null : <Text muted size="sm">{text('searchHint')}</Text>}
        </Stack>
      ) : found.length === 0 ? (
        <Stack gap="md">
          {picker}
          <EmptyState icon="search" title={text('noResults')} description={text('searchHint')} />
        </Stack>
      ) : (
        <Stack gap="sm">
          {/* The tags that hold what was typed, over the notes that do: a tag is one press away. */}
          {picker}
          <Box direction="row" align="center" gap="xs">
            <Box grow>{SectionHeader(text('results'), found.length)}</Box>
            <Toolbar label={text('treeActions')} gap="none">
              <IconButton icon="expand" label={text('expandAll')} tooltip={text('expandAll')} variant="ghost" size="xs" onPress={() => set(foldedGroups, [])} />
              <IconButton icon="collapse" label={text('collapseAll')} tooltip={text('collapseAll')} variant="ghost" size="xs" onPress={() => set(foldedGroups, byFolder(found).map((group) => group.folder))} />
            </Toolbar>
          </Box>
          {/* By folder, each under its band, which folds it: the hit's name and, under it, the text around the match. */}
          {byFolder(found).map((group) => {
            const folded = read(foldedGroups).includes(group.folder)
            return (
              <Stack gap="xs">
                {GroupHeader(group.folder, group.hits.length, folded)}
                {folded ? null : (
                  <List label={group.folder}>
                    {group.hits.map((hit) => (
                      <ListItem title={hit.name} description={hit.snippet ? plainSnippet(hit.snippet) : undefined} icon="file-text" onPress={() => guarded(() => openNote(hit.path))} />
                    ))}
                  </List>
                )}
              </Stack>
            )
          })}
        </Stack>
      )}
      {found && read(resultsTruncated) ? <Text muted size="xs">{text('searchTruncated', { count: found.length })}</Text> : null}
    </Stack>
  )
}

/** Lined up as its HTML block says: centred or to the right; as it was when it says nothing. */
function aligned(align: Align | undefined, node: ReturnType<typeof Text>) {
  if (!align) return node
  return <Row justify={align === 'center' ? 'center' : 'end'}>{node}</Row>
}

/** Markdown lined up as its HTML block says: Orca's Markdown keeps a `<div align>`. */
function alignedMarkdown(content: string, align: Align | undefined): string {
  return align ? `<div align="${align}">\n\n${content}\n\n</div>` : content
}

/**
 * A heading, drawn by the Markdown viewer (its sizes read best), with room around it; a `##`
 * section also opens with a rule, so each section stands apart from the one before.
 */
function HeadingView(segment: Extract<Segment, { kind: 'heading' }>, section: number) {
  if (segment.level === 1) return <Markdown content={alignedMarkdown(segment.markdown, segment.align)} />
  const color = sectionColor(section, env.theme.colorScheme === 'light' ? 'light' : 'dark')
  // Subsections carry their section's color as a line under them, as long as their text, so
  // they stand apart from the lists around them and still read as its. The text is Orca's own,
  // in the font Orca is set to, and nothing measures it: a box in a row is as wide as what it
  // holds, the heading, and the line fills that box. The line is one pixel of the color,
  // stretched; its box is 3 pixels tall and Orca's Image clips to it, round at the ends.
  if (segment.level === 3 || segment.level === 4) {
    const swatch = read(swatchSources)[color]
    return (
      <Box paddingY={segment.level === 3 ? 'sm' : 'xs'}>
        <Row justify={segment.align === 'center' ? 'center' : segment.align === 'right' ? 'end' : 'start'}>
          <Box gap="xs">
            {segment.level === 3 ? <Heading level={3}>{segment.text}</Heading> : <Text size="sm" weight="semibold">{segment.text}</Text>}
            {swatch ? (
              <Box height={segment.level === 3 ? 3 : 2}>
                <Image src={swatch} alt="" size="full" fit="cover" rounded />
              </Box>
            ) : null}
          </Box>
        </Row>
      </Box>
    )
  }
  // A `##` section opens on a band, with clear room after the section before; inside the band,
  // under the title, a line in the section's own color: Orca's tones are four, so they would
  // repeat from the fifth section on. Orca's Heading carries no margins of its own, so the
  // band's padding spaces the title.
  const rule = read(ruleSources)[color]
  return (
    <Box paddingY="lg">
      {/* The line is the band's own bottom edge: no padding around it, and it is drawn with the band's round corners. */}
      <Box background="muted" radius="md">
        <Box paddingX="sm">
          <Box height={6} />
          <Row align="center" justify={segment.align === 'center' ? 'center' : segment.align === 'right' ? 'end' : 'start'}>
            <Heading level={2}>{segment.text}</Heading>
          </Row>
          <Box height={rule ? 4 : 6} />
        </Box>
        {rule ? <Image src={rule} alt="" size="full" fit="contain" /> : null}
      </Box>
    </Box>
  )
}

/**
 * Orca's image size closest to a width in CSS pixels (xs 48, sm 96, md 160, lg 256); the whole
 * panel when there is none or it is wider.
 */
function imageSize(width: number | undefined): 'xs' | 'sm' | 'md' | 'lg' | 'full' {
  if (!width) return 'full'
  if (width <= 64) return 'xs'
  if (width <= 120) return 'sm'
  if (width <= 200) return 'md'
  if (width <= 320) return 'lg'
  return 'full'
}

/** An image of the vault: a placeholder while the worker copies it, its name when it cannot. */
function ImageView(segment: Extract<Segment, { kind: 'image' }>) {
  const src = read(imageSources)[segment.target]
  if (src === undefined) return <Skeleton shape="block" label={text('loadingImage')} />
  if (src === null) return aligned(segment.align, <Text muted size="sm">{`(${segment.alt})`}</Text>)
  return aligned(segment.align, <Image src={src} alt={segment.alt} size={imageSize(segment.width)} fit="contain" rounded />)
}

/**
 * A Mermaid diagram drawn in the colors of Orca's theme (a switch draws it again); as code
 * while the worker draws it and when it cannot, such as a kind other than a flowchart.
 */
function DiagramView(segment: Extract<Segment, { kind: 'diagram' }>) {
  const scheme = env.theme.colorScheme === 'light' ? 'light' : 'dark'
  const key = `${scheme}\n${segment.code}`
  const sources = read(diagramSources)
  if (!(key in sources)) {
    void loadDiagram(key, segment.code, scheme)
    return <Skeleton shape="block" label={text('loadingImage')} />
  }
  const drawing = sources[key]
  if (!drawing) return <Markdown content={segment.markdown} />
  return aligned('center', <Image src={drawing.src} alt={segment.code.split('\n')[0]} size={imageSize(drawing.width)} fit="contain" />)
}

/**
 * README badges, drawn by the worker from their addresses as one picture per row (Orca shows
 * no web image); their texts as Orca badges while it draws them or when it cannot.
 */
function BadgesView(segment: Extract<Segment, { kind: 'badges' }>) {
  const centre = segment.align === 'center'
  const key = `${centre}\n${segment.items.map((item) => item.url).join('\n')}`
  const sources = read(badgeSources)
  if (!(key in sources)) void loadBadges(key, segment.items, centre)
  const drawing = sources[key]
  if (!drawing) {
    return aligned(
      segment.align,
      <Row gap="xs" wrap>
        {segment.items.map((item) => (item.alt ? <Badge>{item.alt}</Badge> : null))}
      </Row>
    )
  }
  return aligned(segment.align, <Image src={drawing.src} alt={segment.items.map((item) => item.alt).filter(Boolean).join(', ')} size={imageSize(drawing.width)} fit="contain" />)
}

/**
 * Markdown with its vault images pointed at their copies in the plugin, the only files Orca's
 * Markdown shows; a web image, or one not ready yet, is left out rather than taken from the
 * plugin's own files. Lined up as its HTML block says.
 */
function MarkdownView(segment: Extract<Segment, { kind: 'markdown' }>) {
  const images = read(imageSources)
  const content = segment.images ? mapImages(segment.text, read(note)?.path || '', (image) => (image.target ? images[image.target] ?? null : null)) : segment.text
  return <Markdown content={alignedMarkdown(content, segment.align)} />
}

/** The box each task status shows. */
const TASK_BOXES: Record<TaskStatus, string> = { todo: '⬜', done: '✅', cancelled: '❌', doing: '🔄' }
/** As wide as the bullet column of Orca's Markdown lists, so a task's text lines up with theirs. */
const TASK_BOX_WIDTH = 22

/**
 * Tasks a line each: the box in a column as wide as a list bullet's, the text beside it, nested
 * tasks one column further in. Done and cancelled tasks are struck through, as Obsidian shows them.
 */
function TasksView(segment: Extract<Segment, { kind: 'tasks' }>) {
  return (
    <Stack gap="xs">
      {segment.items.map((task) => (
        <Box direction="row" align="start">
          {task.level ? <Box width={task.level * TASK_BOX_WIDTH} shrink={false} /> : null}
          <Box width={TASK_BOX_WIDTH} shrink={false} align="center">
            <Text>{TASK_BOXES[task.status]}</Text>
          </Box>
          <Box grow>
            <Markdown content={task.status === 'done' || task.status === 'cancelled' ? `~~${task.text}~~` : task.text} />
          </Box>
        </Box>
      ))}
    </Stack>
  )
}

/** Text and web links in a row, as one piece of text: what sits between two link boxes. */
function TextPiece(runs: readonly Inline[]) {
  return (
    <Text>
      {runs.map((run) => {
        if (run.kind === 'link') return <Link href={run.href}>{run.text}</Link>
        if (run.kind !== 'text') return run.text
        return run.code ? <Code>{run.text}</Code> : run.bold ? <Text weight="semibold">{run.text}</Text> : run.text
      })}
    </Text>
  )
}

/**
 * A line that links to notes or files of the vault, drawn by the panel: in Orca's Markdown
 * such a link is text that does nothing. Each link is a small box with its icon, as the
 * note's links are drawn elsewhere, which opens the note or the file; the text around them
 * flows in the same row. A link to nothing in the vault is drawn, but cannot be pressed.
 */
function Runs(runs: readonly Inline[]) {
  const open = read(note)
  const find = (links: readonly ResolvedLink[] | undefined, target: string): ResolvedLink | undefined => links?.find((link) => link.target.toLowerCase() === target.toLowerCase())
  const pieces: ReturnType<typeof Text>[] = []
  let between: Inline[] = []
  const flush = (): void => {
    // The row spaces its pieces: the text's own spaces at its ends would double the room.
    const trimmed = between.map((run, index) => {
      if (run.kind !== 'text' || run.code) return run
      const text = index === 0 ? run.text.trimStart() : run.text
      return { ...run, text: index === between.length - 1 ? text.trimEnd() : text }
    })
    const shown = trimmed.filter((run) => run.text)
    if (shown.length) pieces.push(TextPiece(shown))
    between = []
  }
  for (const run of runs) {
    if (run.kind !== 'note' && run.kind !== 'file') {
      between.push(run)
      continue
    }
    flush()
    const link = run.kind === 'note' ? find(open?.links, run.target) : find(open?.files, run.target)
    const missing = !link || link.path === null
    pieces.push(
      <Button
        size="xs"
        variant="outline"
        icon={run.kind === 'note' ? 'link' : 'file'}
        disabled={missing}
        tooltip={missing ? text(run.kind === 'note' ? 'linkMissing' : 'fileMissing') : link.path || link.target}
        onPress={() => guarded(async () => (link ? (run.kind === 'note' ? followLink(link) : openFile(link)) : undefined))}
      >
        {run.text}
      </Button>
    )
  }
  flush()
  return (
    <Row gap="xs" align="center" wrap>
      {pieces}
    </Row>
  )
}

/**
 * A list whose items link to notes or files: the bullet or number in a column as wide as a
 * Markdown list's, the text beside it, nested items one column further in.
 */
function ListView(segment: Extract<Segment, { kind: 'list' }>) {
  return (
    <Stack gap="xs">
      {segment.items.map((item) => (
        <Box direction="row" align="start">
          {item.level ? <Box width={item.level * TASK_BOX_WIDTH} shrink={false} /> : null}
          <Box width={TASK_BOX_WIDTH} shrink={false} align="center">
            <Text muted={item.marker !== '•'}>{item.marker}</Text>
          </Box>
          <Box grow>{Runs(item.runs)}</Box>
        </Box>
      ))}
    </Stack>
  )
}

function SegmentView(segment: Segment, section: number) {
  if (segment.kind === 'rich') return Runs(segment.runs)
  if (segment.kind === 'list') return ListView(segment)
  if (segment.kind === 'markdown') return MarkdownView(segment)
  if (segment.kind === 'badges') return BadgesView(segment)
  if (segment.kind === 'files') return FilesView(segment)
  if (segment.kind === 'image') return ImageView(segment)
  if (segment.kind === 'diagram') return DiagramView(segment)
  if (segment.kind === 'tasks') return TasksView(segment)
  if (segment.kind === 'heading') return HeadingView(segment, section)
  return (
    <Callout tone={segment.tone} title={segment.title}>
      <Markdown content={segment.text} />
    </Callout>
  )
}

/** A link of the note as a row; a link to no note is drawn, but cannot be pressed. */
function LinkItem(link: ResolvedLink) {
  const missing = link.path === null
  return (
    <ListItem title={link.label} description={missing ? text('linkMissing') : link.path || link.target} icon="link" disabled={missing} onPress={() => guarded(() => followLink(link))} />
  )
}

/** A file the note links to, as a row that opens it in the system's app; one not in the vault cannot be pressed. */
function FileItem(link: ResolvedLink) {
  const missing = link.path === null
  // The path only when it says more than the name: a file in a folder.
  const path = link.path || link.target
  const description = missing ? text('fileMissing') : path.includes('/') ? path : undefined
  return <ListItem title={link.label} description={description} icon="file" disabled={missing} onPress={() => guarded(() => openFile(link))} />
}

/** Files on lines of their own, as rows where the note has them: pressing one opens it. */
function FilesView(segment: Extract<Segment, { kind: 'files' }>) {
  const placed = read(note)?.placed || []
  const resolved = segment.items.map((item, index) => placed.find((link) => link.target === item.target) || { ...item, key: index })
  return <List label={text('files')}>{resolved.map(FileItem)}</List>
}

/** Shows the notes tree opened down to a folder (`''`, the vault itself, leaves it as it was). */
function showInTree(path: string): void {
  const parts = path ? path.split('/') : []
  const ancestors = parts.map((_part, index) => parts.slice(0, index + 1).join('/'))
  set(expanded, [...new Set([...read(expanded), ...ancestors])])
  showView('notes')
}

/**
 * The files a property links to, a row each that opens it, under the list of properties: its
 * row there holds how many they are. `named` says whose they are, when several groups follow.
 */
function FileProperty(property: Property, named: boolean) {
  return (
    <Stack gap="none">
      {named ? <Text muted size="sm">{property.label}</Text> : null}
      {FilesView({ kind: 'files', items: property.files || [] })}
    </Stack>
  )
}

/**
 * A long list's values, as badges that wrap, under the list of properties: its row there
 * holds how many they are. `named` says whose they are, when several long lists follow.
 */
function LongList(property: Property, named: boolean) {
  return (
    <Stack gap="xs">
      {named ? <Text muted size="sm">{property.label}</Text> : null}
      <Row gap="xs" wrap>
        {property.values.map((value) => (
          <Badge>{value}</Badge>
        ))}
      </Row>
    </Stack>
  )
}

/** A single text too long for a row: its name, then all of it. */
function LongText(property: Property) {
  return (
    <Stack gap="xs">
      <Text muted size="sm">{property.label}</Text>
      <Text size="sm">{property.value}</Text>
    </Stack>
  )
}

/**
 * The note's head: the folders it sits in, each opening the notes tree there; the title, the
 * opening `#` heading or the file name; the tags as badges; the other properties folded away.
 * A rule sets it apart from the note.
 */
function NoteHeader(open: OpenNote) {
  const { title, icon, align } = splitTitle(open.segments, open.title)
  const iconSrc = icon ? read(imageSources)[icon] : null
  const { tags, others } = splitTags(open.properties)
  // A value too long for a row of the list would be cut: it is drawn under the list, whole.
  const short = others.filter((property) => !property.files && property.value.length <= LONG_PROPERTY_CHARS)
  const long = others.filter((property) => !property.files && property.value.length > LONG_PROPERTY_CHARS)
  const lists = long.filter((property) => property.values.length > 1)
  // A property that links to files (attachments): rows that open them, under the list.
  const attached = others.filter((property) => property.files)
  // The folders the note sits in; the vault itself is the icon before them.
  const folders = folderCrumbs(open.path)
  return (
    // A card, as Orca's own sidebars frame an item's details: where the note is, small and
    // muted, over its title and tags; its properties fold away under a rule.
    <Box border radius="md" background="card" paddingX="sm" paddingY="sm">
      <Stack gap="sm">
        <Stack gap="xs">
          {/* Where the note is and, at the right, its tags and the small toggle of its properties
              (not Orca's Collapsible, whose bold title made them look like more): all that matters
              less than the title, small, in one row over it. In a narrow panel they wrap. */}
          <Box direction="row" align="center" gap="sm" wrap>
            <Box grow minWidth={0}>
              {/* One folder icon for the whole path: the vault itself, which opens the tree from the top. After it, each folder a quiet button, like the ones beside it, that opens the tree there. */}
              <Row gap="none" align="center" wrap>
                <IconButton icon="folder" label={folderName(read(vault))} tooltip={folderName(read(vault))} variant="ghost" size="xs" onPress={() => showInTree('')} />
                {folders.map((crumb, index) => [
                  index > 0 ? <Text muted size="xs">›</Text> : null,
                  <Button variant="ghost" size="xs" tooltip={text('showInTree')} onPress={() => showInTree(crumb.path)}>{crumb.label}</Button>
                ])}
              </Row>
            </Box>
            {tags.length || others.length ? (
              <Row gap="xs" align="center" wrap>
                {/* A tag searches for the notes that share it: a button, at the smallest size Orca has, since its Badge cannot be pressed. */}
                {tags.map((tag) => (
                  TagChip(tag, `#${tag}`)
                ))}
                {others.length ? (
                  <Button variant="ghost" size="xs" icon={read(propertiesOpen) ? 'collapse' : 'expand'} onPress={() => set(propertiesOpen, !read(propertiesOpen))}>
                    {text('propertiesCount', { count: others.length })}
                  </Button>
                ) : null}
              </Row>
            ) : null}
          </Box>
          {/* The title, after its icon when it has one, lined up as the note's HTML says. The
              spacer starts it where the folder icon above is drawn, 6 pixels inside its button. */}
          <Box direction="row">
            {align ? null : <Box width={6} shrink={false} />}
            <Box grow minWidth={0}>
              <Row gap="sm" align="center" justify={align === 'center' ? 'center' : align === 'right' ? 'end' : 'start'}>
                {iconSrc ? <Image src={iconSrc} alt="" size="xs" fit="contain" rounded /> : null}
                <Heading level={1}>{title}</Heading>
              </Row>
            </Box>
          </Box>
        </Stack>
        {others.length && read(propertiesOpen) ? <Separator /> : null}
      {others.length && read(propertiesOpen) ? (
          <Stack gap="sm">
            {/* A long list, or a list of files, keeps its row, last in the list and spaced and lined up like the rest: how many values it has; the values go right under. */}
            {short.length || lists.length || attached.length ? (
              <KeyValue
                label={text('properties')}
                items={[
                  ...short.map(({ label, value }) => ({ label, value })),
                  ...lists.map(({ label, values }) => ({ label, value: String(values.length) })),
                  ...attached.map(({ label, files }) => ({ label, value: String((files || []).length) }))
                ]}
              />
            ) : null}
            {lists.map((property) => LongList(property, lists.length + attached.length > 1))}
            {attached.map((property) => FileProperty(property, lists.length + attached.length > 1))}
            {long.filter((property) => property.values.length <= 1).map(LongText)}
          </Stack>
      ) : null}
      </Stack>
    </Box>
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
        const tones = sectionIndexes(body)
        // Every section's line, in this theme's colors, asked for at once.
        const scheme = env.theme.colorScheme === 'light' ? 'light' : 'dark'
        void loadRules([...new Set(tones)].map((section) => sectionColor(section, scheme)))
        void loadSwatches([...new Set(body.flatMap((segment, index) => (segment.kind === 'heading' && segment.level > 2 ? [sectionColor(tones[index], scheme)] : [])))])
        return body.map((segment, index) => SegmentView(segment, tones[index]))
      })()}
      {open.links.length || open.files.length || linkedFrom.length ? (
        // Apart from the note: a rule and room above, then a section each, as Orca's sidebars list.
        <Box paddingY="md">
          <Stack gap="sm">
            <Separator />
            {open.links.length ? (
              <Stack gap="none">
                {SectionHeader(text('links'), open.links.length)}
                <List label={text('links')}>{open.links.map(LinkItem)}</List>
              </Stack>
            ) : null}
            {open.files.length ? (
              <Stack gap="none">
                {SectionHeader(text('files'), open.files.length)}
                <List label={text('files')}>{open.files.map(FileItem)}</List>
              </Stack>
            ) : null}
            {linkedFrom.length ? (
              <Stack gap="none">
                {SectionHeader(text('backlinks'), linkedFrom.length)}
                <List label={text('backlinks')}>
                  {linkedFrom.map((hit) => (
                    <ListItem title={hit.name} description={hit.path} icon="file-text" onPress={() => guarded(() => openNote(hit.path))} />
                  ))}
                </List>
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

/** One segment of the views band: a button as wide as its share, raised when its view is the open one. */
function Segment(value: View, label: string, current: View, disabled: boolean = false) {
  return (
    <Box grow align="stretch" minWidth={0}>
      <Button variant={current === value ? 'solid' : 'ghost'} tone="neutral" size="xs" disabled={disabled} onPress={() => showView(value)}>{label}</Button>
    </Box>
  )
}

export default function Panel() {
  const current = read(view)
  const list = read(vaults)
  const open = read(note)
  // Coming back to the panel reads the vault list again: wait for it rather than flash the
  // add-a-vault page.
  if (!read(vaultsLoaded)) {
    if (!read(problem)) return <Spinner label={text('readingVault')} />
    return (
      <Stack gap="sm">
        <Callout tone="danger" title={text('errorTitle')}>{read(problem)}</Callout>
        <Row>
          <Button icon="refresh" variant="outline" onPress={() => tryNow?.()}>{text('retry')}</Button>
        </Row>
      </Stack>
    )
  }
  // Until there is a vault, the only thing to do is add one: no toolbar to distract from it.
  if (list.length === 0) {
    return (
      <Stack gap="sm">
        {read(problem) ? <Callout tone="danger" title={text('errorTitle')}>{read(problem)}</Callout> : null}
        {VaultsView()}
      </Stack>
    )
  }
  const items = read(tree)
  const count = items ? countNotes(items) : 0
  return (
    <Stack gap="sm">
      {/* The head, as Orca's own sidebars have it: back and forward, the vault and what it holds, the actions on the right. */}
      <Box direction="row" align="center" gap="xs">
        <Toolbar label={text('history')} gap="none">
          <Button variant="ghost" size="xs" tooltip={text('back')} disabled={read(stepsAt) <= 0} onPress={() => guarded(() => walkTrail(-1))}>←</Button>
          <Button variant="ghost" size="xs" tooltip={text('forward')} disabled={read(stepsAt) >= read(steps).length - 1} onPress={() => guarded(() => walkTrail(1))}>→</Button>
        </Toolbar>
        <Box grow minWidth={0}>
          <Stack gap="none">
            <Text weight="semibold" truncate>{folderName(read(vault))}</Text>
            <Text muted size="xs" truncate>{items ? text('noteCount', { count: read(truncated) ? `${count}+` : count }) : text('readingVault')}</Text>
          </Stack>
        </Box>
        <Toolbar label={text('actions')} gap="none">
          {list.length > 1 ? (
            <Select label={text('vaultSelect')} labelHidden value={read(vault)} options={list.map((path) => ({ value: path, label: folderName(path) }))} onChange={(path) => guarded(() => switchVault(path))} />
          ) : null}
          <IconButton icon="open-external" label={text('openInObsidian')} tooltip={text('openInObsidian')} variant="ghost" size="xs" disabled={!open} onPress={() => guarded(() => openInObsidian(open ? open.path : ''))} />
          <IconButton icon="refresh" label={text('reload')} tooltip={text('reload')} variant="ghost" size="xs" disabled={!read(vault)} onPress={() => guarded(() => reload(open))} />
          <IconButton icon="settings" label={text('vaultsButton')} tooltip={text('vaultsButton')} variant={current === 'vaults' ? 'solid' : 'ghost'} size="xs" onPress={() => toggleView('vaults')} />
        </Toolbar>
      </Box>
      <Separator />
      {read(problem) ? <Callout tone="danger" title={text('errorTitle')}>{read(problem)}</Callout> : null}
      {current === 'vaults' ? (
        VaultsView()
      ) : (
        <Stack gap="sm">
          {/* The views as Orca's own sidebars switch theirs ("Names | Contents"): one band the whole width, a segment each, the open one raised. */}
          <Box direction="row" gap="xs" padding="xs" radius="md" border>
            {Segment('notes', text('treeButton'), current)}
            {Segment('search', text('searchButton'), current)}
            {Segment('reading', text('noteButton'), current, !open)}
          </Box>
          {current === 'search' ? SearchView() : current === 'notes' ? NotesView() : ReadingView()}
        </Stack>
      )}
    </Stack>
  )
}
