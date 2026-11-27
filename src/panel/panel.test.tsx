// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const VAULT = 'C:\\vault'
const NOTES: Record<string, string> = {
  'Docs/TODO.md': '---\ntags:\n  - todo\n---\n# TODO\n\n- One\n    - Nested\n\n> [!warning] Careful\n> Only one client.\n\nSee [[Release]] and [[Missing]].\n',
  'Docs/Release.md': '# Release\n'
}

/** What the panel searched for, in order. */
const searched: string[] = []

/** What the panel asked the worker to open, in order. */
const opened: unknown[] = []

function host(vaults: string[] = [VAULT], notes: Record<string, string> = NOTES, listVaults?: () => { vaults: string[] }) {
  return mockHost({
    requests: {
      'vaults.list': listVaults || (() => ({ vaults })),
      'vaults.add': ({ path }) => ({ vaults: [...vaults, path], added: path }),
      'vaults.pick': () => ({ vaults: [...vaults, 'C:\\picked'], added: 'C:\\picked' }),
      'notes.tree': () => ({
        truncated: false,
        limit: 4000,
        items: [{ key: 'Docs', label: 'Docs', icon: 'folder', children: [{ key: 'Docs/Release.md', label: 'Release' }, { key: 'Docs/TODO.md', label: 'TODO' }] }]
      }),
      'notes.read': ({ path }) => {
        if (!(path in notes)) throw hostError('invalid_params', 'note_missing')
        return { path, title: path.split('/').pop()!.replace('.md', ''), text: notes[path] }
      },
      'notes.resolve': ({ targets }) => ({ paths: targets.map((target) => (`Docs/${target}.md` in notes ? `Docs/${target}.md` : null)) }),
      'notes.backlinks': ({ path }) => ({ results: path === 'Docs/Release.md' ? [{ path: 'Docs/TODO.md', name: 'TODO' }] : [] }),
      'notes.search': ({ query }) => (searched.push(query), { results: [{ path: 'Docs/Release.md', name: 'Release', snippet: '…Tags and builds…' }], truncated: true }),
      'notes.resolveFiles': ({ targets }) => ({ paths: targets.map((target) => (target === 'hours.json' ? 'Docs/hours.json' : null)) }),
      'notes.openFile': (params) => (opened.push(params), { opened: true }),
      'notes.tags': () => ({ tags: Array.from({ length: 30 }, (_unused, index) => ({ tag: index === 29 ? 'zeta' : `tag-${String(index).padStart(2, '0')}`, count: 30 - index })) }),
      'notes.openInObsidian': () => ({ opened: true })
    }
  })
}

test('asks for a vault in English when none is added', async () => {
  const view = await mount(panel, { host: host([]), locale: 'en-US' })
  const summary = view.summary().join(' | ')
  assert.ok(summary.includes('Add a vault'), summary)
  assert.ok(view.find({ text: 'Browse…' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('speaks Spanish when Orca does', async () => {
  const view = await mount(panel, { host: host([]), locale: 'es-ES' })
  const summary = view.summary().join(' | ')
  assert.ok(summary.includes('Añade una bóveda'), summary)
  assert.ok(view.find({ text: 'Examinar…' }))
  await view.unmount()
})

test('adds the folder picked in the system dialog and shows its notes', async () => {
  const testHost = host([])
  const view = await mount(panel, { host: testHost, locale: 'en' })
  await view.press({ text: 'Browse…' })
  assert.ok(view.find({ label: 'Notes tree' }), view.summary().join(' | '))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('opens a note from the tree over the whole panel, with its properties, callout and links', async () => {
  const view = await mount(panel, { host: host(), locale: 'en' })
  await view.selectItem({ label: 'Notes tree' }, 'Docs/TODO.md')
  const summary = view.summary().join(' | ')
  assert.ok(summary.includes('Careful'), summary)
  assert.ok(view.find({ text: '#todo' }), summary)
  assert.equal(view.find({ label: 'Notes tree' }), null)
  // A link to no note is drawn, but cannot be pressed.
  const missing = view.find({ type: 'ListItem', text: /Missing/ })
  assert.equal(missing?.disabled, true)
  await view.press({ type: 'ListItem', text: /^Release/ })
  await view.settled()
  assert.ok(view.find({ type: 'Heading', text: 'Release' }))
  // Release is linked from TODO: its backlink leads back.
  await view.press({ type: 'ListItem', text: /^TODO/ })
  assert.ok(view.find({ type: 'Heading', text: 'TODO' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('reopens the last note when the panel opens again', async () => {
  const view = await mount(panel, { host: host(), persisted: { plugin: { vault: VAULT, lastNote: 'Docs/Release.md' } } })
  assert.ok(view.find({ type: 'Heading', text: 'Release' }))
  await view.unmount()
})

test('starts from the tree, with no error, when the last note is gone', async () => {
  const view = await mount(panel, { host: host(), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/Gone.md' } } })
  await view.settled()
  assert.ok(view.find({ label: 'Notes tree' }), view.summary().join(' | '))
  assert.equal(view.find({ text: 'Something went wrong' }), null)
  assert.equal(view.persisted.plugin.lastNote, '')
  await view.unmount()
})

test('shows the error, not an endless spinner, when the tree cannot be read', async () => {
  const failing = mockHost({
    requests: {
      'vaults.list': () => ({ vaults: [VAULT] }),
      'notes.tree': () => {
        throw hostError('invalid_params', 'not_a_vault')
      }
    }
  })
  const view = await mount(panel, { host: failing, locale: 'en' })
  await view.settled()
  assert.ok(view.find({ text: /That folder is not in the vault list/ }), view.summary().join(' | '))
  assert.equal(view.find({ label: 'Reading the vault' }), null)
  assert.equal(view.find({ label: 'No notes' }), null)
  await view.unmount()
})

/** Waits, on the real clock, until `found` holds or `ms` have passed. */
async function eventually(view: { settled(): Promise<void> }, found: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms
  await view.settled()
  while (!found() && Date.now() < end) {
    await new Promise((done) => setTimeout(done, 100))
    await view.settled()
  }
}

test('asks for the vault list again when the worker is starting, rather than ask for a vault', async () => {
  let calls = 0
  const waking = host([VAULT], NOTES, () => {
    calls++
    if (calls === 1) throw hostError('unavailable', 'worker starting')
    return { vaults: [VAULT] }
  })
  const view = await mount(panel, { host: waking, locale: 'en' })
  await eventually(view, () => view.find({ label: 'Notes tree' }) !== null, 3000)
  assert.ok(view.find({ label: 'Notes tree' }), view.summary().join(' | '))
  assert.equal(view.find({ text: 'Add a vault' }), null)
  await view.unmount()
})

test('shows the error while the vault list keeps failing, and loads on its own once it answers', async () => {
  let failing = true
  const broken = host([VAULT], NOTES, () => {
    if (failing) throw hostError('unavailable', 'worker down')
    return { vaults: [VAULT] }
  })
  const view = await mount(panel, { host: broken, locale: 'en' })
  await eventually(view, () => view.find({ text: 'Try again' }) !== null, 10000)
  assert.ok(view.find({ text: 'Try again' }), view.summary().join(' | '))
  assert.equal(view.find({ text: 'Browse…' }), null)
  failing = false
  await eventually(view, () => view.find({ label: 'Notes tree' }) !== null, 7000)
  assert.ok(view.find({ label: 'Notes tree' }), view.summary().join(' | '))
  assert.equal(view.find({ text: /Something went wrong/ }), null)
  await view.unmount()
})

test('the retry button asks for the vault list at once', async () => {
  let failing = true
  const broken = host([VAULT], NOTES, () => {
    if (failing) throw hostError('unavailable', 'worker down')
    return { vaults: [VAULT] }
  })
  const view = await mount(panel, { host: broken, locale: 'en' })
  await eventually(view, () => view.find({ text: 'Try again' }) !== null, 10000)
  failing = false
  const pressed = Date.now()
  await view.press({ text: 'Try again' })
  await eventually(view, () => view.find({ label: 'Notes tree' }) !== null, 3000)
  assert.ok(view.find({ label: 'Notes tree' }), view.summary().join(' | '))
  assert.ok(Date.now() - pressed < 2000, `took ${Date.now() - pressed} ms`)
  await view.unmount()
})

test('follows a change on disk: the open note is read again', async () => {
  const notes = { ...NOTES }
  const view = await mount(panel, { host: host([VAULT], notes), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/Release.md' } } })
  notes['Docs/Release.md'] = '# Release\nShipped on Friday.\n'
  await view.post('notes.changed', { vault: VAULT })
  await view.settled()
  assert.ok(view.find({ text: /Shipped on Friday/ }), view.summary().join(' | '))
  await view.unmount()
})

test('shows where each search hit matched and says when the list is cut', async () => {
  const view = await mount(panel, { host: host(), locale: 'en' })
  await view.press({ type: 'Button', text: 'Search' })
  await view.type({ label: 'Search', type: 'Input' }, 'builds', { submit: true })
  assert.ok(view.find({ type: 'ListItem', text: /Tags and builds/ }), view.summary().join(' | '))
  assert.ok(view.find({ text: 'Only the first 1 results are shown.' }))
  await view.unmount()
})

test('draws an image of the note from the copy the worker made, and names one it could not', async () => {
  const notes: Record<string, string> = { ...NOTES, 'Docs/Release.md': '# Release\n![[pic.png]]\n![[huge.png]]\n' }
  const view = await mount(panel, {
    host: mockHost({
      requests: {
        'vaults.list': () => ({ vaults: [VAULT] }),
        'notes.tree': () => ({ truncated: false, limit: 4000, items: [] }),
        'notes.read': ({ path }) => ({ path, title: 'Release', text: notes[path] }),
        'notes.backlinks': () => ({ results: [] }),
        'notes.image': ({ target }) => ({ src: target === 'pic.png' ? 'cache/abc.png' : null })
      }
    }),
    locale: 'en',
    persisted: { plugin: { vault: VAULT, lastNote: 'Docs/Release.md' } }
  })
  await view.settled()
  assert.equal(view.find({ type: 'Image' })?.props.src, 'cache/abc.png')
  assert.ok(view.find({ text: '(huge.png)' }), view.summary().join(' | '))
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('lists the vaults with a button to open each and one to remove it', async () => {
  const other = 'C:\\other'
  const view = await mount(panel, { host: host([VAULT, other]), locale: 'en' })
  await view.press({ label: 'Vaults' })
  assert.deepEqual(view.errors, [])
  assert.equal(view.find({ label: 'Use vault' }), null)
  await view.press({ label: 'Use other' })
  assert.deepEqual(view.errors, [])
  assert.equal(view.persisted.plugin.vault, other)
  await view.unmount()
})

test('heads the note with its folders, its title once and its tags; other properties fold away', async () => {
  const notes: Record<string, string> = {
    'Docs/TODO.md': '---\ntags: [todo, "#work"]\nstatus: open\n---\n# My list\n\n## Today\nSomething\n'
  }
  const testHost = host([VAULT], notes)
  const view = await mount(panel, { host: testHost, locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/TODO.md' } } })
  await view.settled()
  assert.equal(view.findAll({ type: 'Heading', text: 'My list' }).length, 1)
  assert.ok(view.find({ text: '#todo' }) && view.find({ text: '#work' }))
  assert.ok(view.find({ type: 'Button', text: 'Properties (1)' }), view.summary().join(' | '))
  assert.equal(view.find({ text: 'Docs/TODO.md' }), null)
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.errors, [])
  // A folder of the path opens the notes tree, unfolded down to it.
  await view.press({ text: 'Docs' })
  assert.ok(view.find({ label: 'Notes tree' }), view.summary().join(' | '))
  assert.deepEqual(view.expandedOf({ label: 'Notes tree' }), ['Docs'])
  await view.unmount()
})

test('narrows the tree to the notes whose name matches, with their folders open', async () => {
  const view = await mount(panel, { host: host(), locale: 'en' })
  await view.type({ label: 'Filter notes', type: 'Input' }, 'rele')
  assert.deepEqual(view.expandedOf({ label: 'Notes tree' }), ['Docs'])
  const items = view.find({ label: 'Notes tree' })?.props.items as { children: { key: string }[] }[]
  assert.deepEqual(items[0].children.map((item) => item.key), ['Docs/Release.md'])
  await view.type({ label: 'Filter notes', type: 'Input' }, 'nothing like it', { replace: true })
  assert.ok(view.find({ text: 'No note matches.' }), view.summary().join(' | '))
  await view.unmount()
})

test('lists the files a note links to and opens one in its app; a missing one cannot be pressed', async () => {
  const testHost = host([VAULT], { ...NOTES, 'Docs/Release.md': '# Release\n![[hours.json]] [[gone.pdf]]\n' })
  const view = await mount(panel, { host: testHost, locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/Release.md' } } })
  await view.settled()
  assert.equal(view.find({ type: 'ListItem', text: /gone\.pdf/ })?.disabled, true)
  await view.press({ type: 'ListItem', text: /^hours\.json/ })
  assert.deepEqual(opened, [{ vault: VAULT, path: 'Docs/hours.json' }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('shows a list too long for a row whole: its count in its row of the list, each value a badge under it', async () => {
  const dates = Array.from({ length: 40 }, (_unused, day) => `2026-10-${String(day + 1).padStart(2, '0')}`)
  const notes: Record<string, string> = { 'Docs/TODO.md': `---\nstatus: open\ndone:\n${dates.map((date) => `  - ${date}`).join('\n')}\n---\n# List\n` }
  const view = await mount(panel, { host: host([VAULT], notes), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/TODO.md' } } })
  await view.settled()
  await view.press({ type: 'Button', text: 'Properties (2)' })
  const items = view.find({ type: 'KeyValue' })?.props.items as { label: string; value: string }[]
  assert.deepEqual(items, [{ label: 'status', value: 'open' }, { label: 'done', value: '40' }])
  assert.ok(view.find({ type: 'Badge', text: '2026-10-40' }), view.summary().join(' | '))
  assert.equal(view.find({ text: /…/ }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('draws a property that links to files as rows that open them', async () => {
  const notes: Record<string, string> = { 'Docs/TODO.md': '---\nstatus: open\nattachments: "[[hours.json]]"\n---\n# List\n' }
  const view = await mount(panel, { host: host([VAULT], notes), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/TODO.md' } } })
  await view.settled()
  await view.press({ type: 'Button', text: 'Properties (2)' })
  const items = view.find({ type: 'KeyValue' })?.props.items as { label: string; value: string }[]
  assert.deepEqual(items, [{ label: 'status', value: 'open' }, { label: 'attachments', value: '1' }])
  opened.length = 0
  await view.press({ type: 'ListItem', text: /^hours\.json/ })
  assert.deepEqual(opened, [{ vault: VAULT, path: 'Docs/hours.json' }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('opens a note from its box inside the text; a link to no note is drawn, but cannot be pressed', async () => {
  const view = await mount(panel, { host: host(), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/TODO.md' } } })
  await view.settled()
  assert.equal(view.find({ type: 'Button', text: 'Missing' })?.disabled, true)
  await view.press({ type: 'Button', text: 'Release' })
  await view.settled()
  assert.ok(view.find({ type: 'Heading', text: 'Release' }), view.summary().join(' | '))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('goes back and forward through the views and the notes opened, like a browser', async () => {
  const view = await mount(panel, { host: host(), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/TODO.md' } } })
  await view.settled()
  assert.equal(view.find({ type: 'Button', text: '←' })?.disabled, true)
  await view.press({ type: 'Button', text: 'Release' })
  await view.settled()
  await view.press({ type: 'Button', text: 'Search' })
  assert.ok(view.find({ label: 'Search', type: 'Input' }))
  assert.deepEqual(view.persisted.plugin.steps, ['note:Docs/TODO.md', 'note:Docs/Release.md', 'search'])
  // Back from the search to the note before it, then to the first one.
  await view.press({ type: 'Button', text: '←' })
  await view.settled()
  assert.ok(view.find({ type: 'Heading', text: 'Release' }), view.summary().join(' | '))
  await view.press({ type: 'Button', text: '←' })
  await view.settled()
  assert.ok(view.find({ type: 'Heading', text: 'TODO' }), view.summary().join(' | '))
  assert.equal(view.find({ type: 'Button', text: '←' })?.disabled, true)
  // Forward twice lands on the search again.
  await view.press({ type: 'Button', text: '→' })
  await view.settled()
  await view.press({ type: 'Button', text: '→' })
  await view.settled()
  assert.ok(view.find({ label: 'Search', type: 'Input' }))
  assert.equal(view.find({ type: 'Button', text: '→' })?.disabled, true)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('searches for the notes that share a tag when the tag is pressed', async () => {
  const view = await mount(panel, { host: host(), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/TODO.md' } } })
  await view.settled()
  searched.length = 0
  await view.press({ type: 'Button', text: '#todo' })
  await view.settled()
  assert.deepEqual(searched, ['#todo'])
  assert.ok(view.find({ type: 'ListItem', text: /Tags and builds/ }), view.summary().join(' | '))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('lists the notes read last in the search view, and clears them when asked', async () => {
  const view = await mount(panel, { host: host(), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Docs/TODO.md' } } })
  await view.settled()
  await view.press({ type: 'Button', text: 'Release' })
  await view.settled()
  await view.press({ type: 'Button', text: 'Search' })
  await view.settled()
  // The open note is left out: TODO, read before it, is the recent one.
  assert.ok(view.find({ type: 'ListItem', text: /^TODO/ }), view.summary().join(' | '))
  assert.equal(view.find({ type: 'ListItem', text: /^Release/ }), null)
  await view.press({ label: 'Clear the recent notes' })
  assert.equal(view.find({ type: 'ListItem', text: /^TODO/ }), null)
  assert.deepEqual(view.persisted.plugin.recent, [])
  // Back and forward keep their trail.
  assert.equal(view.find({ type: 'Button', text: '←' })?.disabled, false)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('lists the tags, the most used first or from A to Z under their initials, and only those typed while typing', async () => {
  const view = await mount(panel, { host: host(), locale: 'en' })
  await view.press({ type: 'Button', text: 'Search' })
  await view.settled()
  assert.ok(view.find({ type: 'Button', text: '#tag-00 · 30' }), view.summary().join(' | '))
  assert.ok(view.find({ type: 'Button', text: '#zeta · 1' }))
  assert.equal(view.find({ text: 'Z' }), null)
  await view.press({ type: 'Button', text: 'A–Z' })
  assert.ok(view.find({ text: 'Z' }), view.summary().join(' | '))
  assert.equal(view.persisted.plugin.tagOrder, 'az')
  // Typing narrows the tags to the ones that hold it, with or without the #.
  await view.type({ label: 'Search', type: 'Input' }, '#ZET')
  assert.ok(view.find({ type: 'Button', text: '#zeta · 1' }), view.summary().join(' | '))
  assert.equal(view.find({ type: 'Button', text: '#tag-00 · 30' }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('folds and unfolds the tree while it is filtered, and the folders of the search results', async () => {
  const view = await mount(panel, { host: host(), locale: 'en' })
  await view.type({ label: 'Filter notes', type: 'Input' }, 'rele')
  // What the panel tells the tree to show open.
  const open = (): unknown => view.find({ label: 'Notes tree' })?.props.expanded
  assert.deepEqual(open(), ['Docs'])
  await view.press({ label: 'Collapse all folders' })
  assert.deepEqual(open(), [])
  await view.press({ label: 'Expand all folders' })
  assert.deepEqual(open(), ['Docs'])
  // The search results fold by folder: one by one, and all at once.
  await view.press({ type: 'Button', text: 'Search' })
  await view.type({ label: 'Search', type: 'Input' }, 'builds', { submit: true })
  assert.ok(view.find({ type: 'ListItem', text: /^Release/ }), view.summary().join(' | '))
  await view.press({ label: 'Collapse Docs' })
  assert.equal(view.find({ type: 'ListItem', text: /^Release/ }), null)
  await view.press({ label: 'Expand all folders' })
  assert.ok(view.find({ type: 'ListItem', text: /^Release/ }))
  await view.press({ label: 'Collapse all folders' })
  assert.equal(view.find({ type: 'ListItem', text: /^Release/ }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
