// Runs src/worker.ts's activate(orca) over a mock host and a real temporary vault on disk.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'

function makeVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'obsidian-notes-'))
  mkdirSync(join(root, 'Notas'))
  mkdirSync(join(root, '.obsidian'))
  writeFileSync(join(root, 'Notas', 'TODO.md'), '# TODO\nSee [[Release]].\n')
  writeFileSync(join(root, 'Notas', 'Release.md'), '# Release\nTags and builds.\n')
  writeFileSync(join(root, 'Readme.md'), 'Top level note\n')
  writeFileSync(join(root, 'image.png'), 'not a note')
  writeFileSync(join(root, '.obsidian', 'app.md'), 'config, never listed')
  return root
}

test('adds a vault, lists its tree and reads a note', async () => {
  const root = makeVault()
  try {
    const worker = await mountWorker(main, { host: mockHost() })
    assert.deepEqual(await worker.request('vaults.add', { path: root }), { vaults: [root] })

    const { items, truncated } = await worker.request('notes.tree', { vault: root })
    assert.equal(truncated, false)
    assert.deepEqual(items.map((item) => item.key), ['Notas', 'Readme.md'])
    assert.deepEqual(items[0].children?.map((item) => item.label), ['Release', 'TODO'])

    const note = await worker.request('notes.read', { vault: root, path: 'Notas/TODO.md' })
    assert.equal(note.title, 'TODO')
    assert.equal(note.text, '# TODO\nSee [[Release]].\n')

    assert.deepEqual(await worker.request('notes.resolve', { vault: root, target: 'Release' }), { path: 'Notas/Release.md' })
    assert.deepEqual(await worker.request('notes.search', { vault: root, query: 'builds' }), {
      results: [{ path: 'Notas/Release.md', name: 'Release' }]
    })
    await worker.deactivate()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses a folder that is not an added vault, and a path that climbs out', async () => {
  const root = makeVault()
  try {
    const worker = await mountWorker(main, { host: mockHost({ storage: { vaults: [join(root, 'Notas')] } }) })
    await assert.rejects(() => worker.request('notes.tree', { vault: root }))
    await assert.rejects(() => worker.request('notes.read', { vault: join(root, 'Notas'), path: '../Readme.md' }))
    await assert.rejects(() => worker.request('vaults.add', { path: join(root, 'missing') }))
    await worker.deactivate()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('removes a vault from the list only', async () => {
  const worker = await mountWorker(main, { host: mockHost({ storage: { vaults: ['C:\\a', 'C:\\b'] } }) })
  assert.deepEqual(await worker.request('vaults.remove', { path: 'C:\\a' }), { vaults: ['C:\\b'] })
  await worker.deactivate()
})
