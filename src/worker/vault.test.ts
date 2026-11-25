import { assert, test } from 'orca/testing'
import { join } from 'node:path'
import { compareEntries, isInside, noteTitle, obsidianUrl, resolveWikilink, toKey } from './vault'

const ROOT = join('C:', 'vault')

test('keeps paths inside the vault and refuses the ones that climb out', () => {
  assert.equal(isInside(ROOT, join(ROOT, 'Notas', 'TODO.md')), true)
  assert.equal(isInside(ROOT, ROOT), true)
  assert.equal(isInside(ROOT, join(ROOT, '..', 'other', 'x.md')), false)
})

test('keys a file by its vault-relative path with forward slashes', () => {
  assert.equal(toKey(ROOT, join(ROOT, 'Guess', 'Notas', 'TODO.md')), 'Guess/Notas/TODO.md')
})

test('titles a note by its file name without .md', () => {
  assert.equal(noteTitle('Guess/Notas/Release (GLCG-16693).md'), 'Release (GLCG-16693)')
})

test('lists folders before notes, alphabetically', () => {
  const entries = [
    { name: 'b.md', isDir: false },
    { name: 'Zeta', isDir: true },
    { name: 'a.md', isDir: false },
    { name: 'alpha', isDir: true }
  ]
  assert.deepEqual(entries.sort(compareEntries).map((e) => e.name), ['alpha', 'Zeta', 'a.md', 'b.md'])
})

test('resolves a wikilink by path first, then by note name', () => {
  const notes = ['Guess/Notas/TODO.md', 'Mis Notas/TODO.md', 'Guess/Notas/Release (GLCG-16693).md']
  assert.equal(resolveWikilink(notes, 'Mis Notas/TODO'), 'Mis Notas/TODO.md')
  assert.equal(resolveWikilink(notes, 'release (glcg-16693)'), 'Guess/Notas/Release (GLCG-16693).md')
  assert.equal(resolveWikilink(notes, 'TODO'), 'Guess/Notas/TODO.md')
  assert.equal(resolveWikilink(notes, 'Missing'), null)
})

test('opens a note in Obsidian by its absolute path', () => {
  const url = obsidianUrl(join(ROOT, 'Notas', 'TODO.md'))
  assert.ok(url.startsWith('obsidian://open?path='))
  assert.ok(decodeURIComponent(url.slice('obsidian://open?path='.length)).endsWith(join('Notas', 'TODO.md')))
})
