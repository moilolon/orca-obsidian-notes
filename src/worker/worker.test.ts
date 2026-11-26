// Runs src/worker/worker.ts's activate(orca) over a mock host and a real temporary vault on disk.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'

function makeVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'obsidian-notes-'))
  mkdirSync(join(root, 'Docs'))
  mkdirSync(join(root, '.obsidian'))
  writeFileSync(join(root, 'Docs', 'TODO.md'), '# TODO\nSee [[Release]].\n')
  writeFileSync(join(root, 'Docs', 'Release.md'), '# Release\nTags and builds.\n')
  writeFileSync(join(root, 'Readme.md'), 'Top level note\n')
  writeFileSync(join(root, 'image.png'), 'not a note')
  mkdirSync(join(root, 'assets', 'img'), { recursive: true })
  writeFileSync(join(root, 'assets', 'img', 'pic.png'), 'only images here')
  writeFileSync(join(root, '.obsidian', 'app.md'), 'config, never listed')
  return root
}

test('adds a vault, lists its tree and reads a note', async () => {
  const root = makeVault()
  try {
    const worker = await mountWorker(main, { host: mockHost() })
    assert.deepEqual(await worker.request('vaults.add', { path: root }), { vaults: [root], added: root })
    // Adding it again keeps one entry and answers the stored spelling.
    assert.deepEqual(await worker.request('vaults.add', { path: root.toUpperCase() }), { vaults: [root], added: root })

    const { items, truncated, limit } = await worker.request('notes.tree', { vault: root })
    assert.equal(truncated, false)
    assert.equal(limit, 4000)
    // `assets` holds only images: no note to open, so no folder in the tree.
    assert.deepEqual(items.map((item) => item.key), ['Docs', 'Readme.md'])
    assert.deepEqual(items[0].children?.map((item) => item.label), ['Release', 'TODO'])

    const note = await worker.request('notes.read', { vault: root, path: 'Docs/TODO.md' })
    assert.equal(note.title, 'TODO')
    assert.equal(note.text, '# TODO\nSee [[Release]].\n')

    assert.deepEqual(await worker.request('notes.resolve', { vault: root, targets: ['Release', 'Missing'] }), { paths: ['Docs/Release.md', null] })
    assert.deepEqual(await worker.request('notes.search', { vault: root, query: 'builds' }), {
      results: [{ path: 'Docs/Release.md', name: 'Release', snippet: '# Release Tags and builds.' }],
      truncated: false
    })
    assert.deepEqual(await worker.request('notes.backlinks', { vault: root, path: 'Docs/Release.md' }), {
      results: [{ path: 'Docs/TODO.md', name: 'TODO' }]
    })
    await worker.deactivate()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses a folder that is not an added vault, and a path that climbs out', async () => {
  const root = makeVault()
  try {
    const worker = await mountWorker(main, { host: mockHost({ storage: { vaults: [join(root, 'Docs')] } }) })
    // Each refusal carries the code the panel translates (src/panel/i18n.ts WORKER_ERRORS).
    await assert.rejects(() => worker.request('notes.tree', { vault: root }), /not_a_vault/)
    await assert.rejects(() => worker.request('notes.read', { vault: join(root, 'Docs'), path: '../Readme.md' }), /not_a_note/)
    await assert.rejects(() => worker.request('vaults.add', { path: join(root, 'missing') }), /not_a_folder/)
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

test('says a note is gone, and refuses a link that leads out of the vault', async () => {
  const root = makeVault()
  const outside = mkdtempSync(join(tmpdir(), 'obsidian-outside-'))
  try {
    writeFileSync(join(outside, 'secret.md'), 'not in the vault')
    let linked = true
    try {
      symlinkSync(join(outside, 'secret.md'), join(root, 'Linked.md'), 'file')
    } catch {
      linked = false // Windows without the right to make links: the rest still runs.
    }
    const worker = await mountWorker(main, { host: mockHost({ storage: { vaults: [root] } }) })
    await assert.rejects(() => worker.request('notes.read', { vault: root, path: 'Docs/Gone.md' }), /note_missing/)
    if (linked) {
      await assert.rejects(() => worker.request('notes.read', { vault: root, path: 'Linked.md' }), /not_a_note/)
      const { items } = await worker.request('notes.tree', { vault: root })
      assert.ok(!items.some((item) => item.key === 'Linked.md'))
    }
    await worker.deactivate()
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('tells the panels when a note changes on disk, and lists the new one', async () => {
  const root = makeVault()
  try {
    const worker = await mountWorker(main, { host: mockHost({ storage: { vaults: [root] } }) })
    try {
      await worker.request('notes.tree', { vault: root })
      writeFileSync(join(root, 'New.md'), 'Fresh\n')
      const deadline = Date.now() + 5000
      while (!worker.posts.length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50))
      assert.deepEqual(worker.posts[0], { event: 'notes.changed', payload: { vault: root } })
      const { items } = await worker.request('notes.tree', { vault: root })
      assert.ok(items.some((item) => item.key === 'New.md'))
    } finally {
      await worker.deactivate()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('copies a vault image into the plugin cache, once, and names it for the panel', async () => {
  const root = makeVault()
  const copied: string[] = []
  try {
    mkdirSync(join(root, 'Adjuntos'))
    writeFileSync(join(root, 'Adjuntos', 'pic.png'), 'png bytes')
    const worker = await mountWorker(main, { host: mockHost({ storage: { vaults: [root] } }) })
    const first = await worker.request('notes.image', { vault: root, target: 'pic.png' })
    assert.ok(first.src && /^cache\/[0-9a-f]{24}\.png$/.test(first.src), String(first.src))
    copied.push(join(main.CACHE_DIR, first.src.slice('cache/'.length)))
    assert.equal(readFileSync(copied[0], 'utf8'), 'png bytes')
    assert.deepEqual(await worker.request('notes.image', { vault: root, target: 'Adjuntos/pic.png' }), first)
    assert.deepEqual(await worker.request('notes.image', { vault: root, target: 'missing.png' }), { src: null })
    await worker.deactivate()
  } finally {
    for (const file of copied) rmSync(file, { force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
