// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const VAULT = 'C:\\vault'
const NOTES = {
  'Notas/TODO.md': '---\ntags:\n  - todo\n---\n# TODO\n\n- One\n    - Nested\n\n> [!warning] Careful\n> Only one client.\n\nSee [[Release]].\n',
  'Notas/Release.md': '# Release\n'
}

function host(vaults: string[] = [VAULT]) {
  return mockHost({
    requests: {
      'vaults.list': () => ({ vaults }),
      'vaults.add': ({ path }) => ({ vaults: [...vaults, path], added: path }),
      'vaults.pick': () => ({ vaults: [...vaults, 'C:\\picked'], added: 'C:\\picked' }),
      'notes.tree': () => ({
        truncated: false,
        items: [{ key: 'Notas', label: 'Notas', icon: 'folder', children: [{ key: 'Notas/Release.md', label: 'Release' }, { key: 'Notas/TODO.md', label: 'TODO' }] }]
      }),
      'notes.read': ({ path }) => ({ path, title: path.split('/').pop()!.replace('.md', ''), text: NOTES[path as keyof typeof NOTES] }),
      'notes.resolve': ({ target }) => ({ path: `Notas/${target}.md` }),
      'notes.search': () => ({ results: [{ path: 'Notas/Release.md', name: 'Release' }] }),
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

test('opens a note from the tree over the whole panel, with its callout and links', async () => {
  const view = await mount(panel, { host: host(), locale: 'en' })
  await view.selectItem({ label: 'Notes tree' }, 'Notas/TODO.md')
  const summary = view.summary().join(' | ')
  assert.ok(summary.includes('Careful'), summary)
  assert.equal(view.find({ label: 'Notes tree' }), null)
  await view.press({ text: 'Release' })
  assert.ok(view.find({ text: 'Notas/Release.md' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('reopens the last note when the panel opens again', async () => {
  const view = await mount(panel, { host: host(), persisted: { plugin: { vault: VAULT, lastNote: 'Notas/Release.md' } } })
  assert.ok(view.find({ text: 'Notas/Release.md' }))
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
