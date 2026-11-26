// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const VAULT = 'C:\\vault'
const NOTES: Record<string, string> = {
  'Notas/TODO.md': '---\ntags:\n  - todo\n---\n# TODO\n\n- One\n    - Nested\n\n> [!warning] Careful\n> Only one client.\n\nSee [[Release]] and [[Missing]].\n',
  'Notas/Release.md': '# Release\n'
}

function host(vaults: string[] = [VAULT], notes: Record<string, string> = NOTES, listVaults?: () => { vaults: string[] }) {
  return mockHost({
    requests: {
      'vaults.list': listVaults || (() => ({ vaults })),
      'vaults.add': ({ path }) => ({ vaults: [...vaults, path], added: path }),
      'vaults.pick': () => ({ vaults: [...vaults, 'C:\\picked'], added: 'C:\\picked' }),
      'notes.tree': () => ({
        truncated: false,
        limit: 4000,
        items: [{ key: 'Notas', label: 'Notas', icon: 'folder', children: [{ key: 'Notas/Release.md', label: 'Release' }, { key: 'Notas/TODO.md', label: 'TODO' }] }]
      }),
      'notes.read': ({ path }) => {
        if (!(path in notes)) throw hostError('invalid_params', 'note_missing')
        return { path, title: path.split('/').pop()!.replace('.md', ''), text: notes[path] }
      },
      'notes.resolve': ({ targets }) => ({ paths: targets.map((target) => (`Notas/${target}.md` in notes ? `Notas/${target}.md` : null)) }),
      'notes.backlinks': ({ path }) => ({ results: path === 'Notas/Release.md' ? [{ path: 'Notas/TODO.md', name: 'TODO' }] : [] }),
      'notes.search': () => ({ results: [{ path: 'Notas/Release.md', name: 'Release', snippet: '…Tags and builds…' }], truncated: true }),
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
  await view.selectItem({ label: 'Notes tree' }, 'Notas/TODO.md')
  const summary = view.summary().join(' | ')
  assert.ok(summary.includes('Careful'), summary)
  assert.ok(view.find({ text: '#todo' }), summary)
  assert.equal(view.find({ label: 'Notes tree' }), null)
  // A link to no note is drawn, but cannot be pressed.
  assert.equal(view.find({ text: 'Missing' })?.disabled, true)
  await view.press({ text: 'Release' })
  await view.settled()
  assert.ok(view.find({ type: 'Heading', text: 'Release' }))
  // Release is linked from TODO: its backlink leads back.
  await view.press({ text: 'TODO' })
  assert.ok(view.find({ type: 'Heading', text: 'TODO' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('reopens the last note when the panel opens again', async () => {
  const view = await mount(panel, { host: host(), persisted: { plugin: { vault: VAULT, lastNote: 'Notas/Release.md' } } })
  assert.ok(view.find({ type: 'Heading', text: 'Release' }))
  await view.unmount()
})

test('starts from the tree, with no error, when the last note is gone', async () => {
  const view = await mount(panel, { host: host(), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Notas/Gone.md' } } })
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
  const view = await mount(panel, { host: host([VAULT], notes), locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Notas/Release.md' } } })
  notes['Notas/Release.md'] = '# Release\nShipped on Friday.\n'
  await view.post('notes.changed', { vault: VAULT })
  await view.settled()
  assert.ok(view.find({ text: /Shipped on Friday/ }), view.summary().join(' | '))
  await view.unmount()
})

test('shows where each search hit matched and says when the list is cut', async () => {
  const view = await mount(panel, { host: host(), locale: 'en' })
  await view.press({ label: 'Search' })
  await view.type({ label: 'Search', type: 'Input' }, 'builds', { submit: true })
  assert.ok(view.find({ text: '…Tags and builds…' }), view.summary().join(' | '))
  assert.ok(view.find({ text: 'Only the first 1 results are shown.' }))
  await view.unmount()
})

test('draws an image of the note from the copy the worker made, and names one it could not', async () => {
  const notes: Record<string, string> = { ...NOTES, 'Notas/Release.md': '# Release\n![[pic.png]]\n![[huge.png]]\n' }
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
    persisted: { plugin: { vault: VAULT, lastNote: 'Notas/Release.md' } }
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
    'Notas/TODO.md': '---\ntags: [todo, "#work"]\nestado: abierta\n---\n# Mi lista\n\n## Hoy\nAlgo\n'
  }
  const testHost = host([VAULT], notes)
  const view = await mount(panel, { host: testHost, locale: 'en', persisted: { plugin: { vault: VAULT, lastNote: 'Notas/TODO.md' } } })
  await view.settled()
  assert.equal(view.findAll({ type: 'Heading', text: 'Mi lista' }).length, 1)
  assert.ok(view.find({ text: '#todo' }) && view.find({ text: '#work' }))
  assert.ok(view.find({ label: 'Properties (1)' }), view.summary().join(' | '))
  assert.equal(view.find({ text: 'Notas/TODO.md' }), null)
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.errors, [])
  // A folder of the path opens the notes tree, unfolded down to it.
  await view.press({ text: 'Notas' })
  assert.ok(view.find({ label: 'Notes tree' }), view.summary().join(' | '))
  assert.deepEqual(view.expandedOf({ label: 'Notes tree' }), ['Notas'])
  await view.unmount()
})
