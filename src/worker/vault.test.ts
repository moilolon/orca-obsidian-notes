import { assert, test } from 'orca/testing'
import { join } from 'node:path'
import { compareEntries, isIgnoredChange, isInside, noteTitle, obsidianUrl, resolveAttachment, resolveWikilink, snippetAt, toKey } from './vault'

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

test('resolves a partial path by its end, as Obsidian does', () => {
  const notes = ['Guess/Notas/TODO.md', 'Mis Notas/Otra.md']
  assert.equal(resolveWikilink(notes, 'Notas/TODO'), 'Guess/Notas/TODO.md')
  assert.equal(resolveWikilink(notes, '/Mis Notas/Otra.md'), 'Mis Notas/Otra.md')
})

test('ignores changes that cannot alter the notes', () => {
  assert.equal(isIgnoredChange(join('.obsidian', 'workspace.json')), true)
  assert.equal(isIgnoredChange(join('Notas', 'doc.pdf')), true)
  assert.equal(isIgnoredChange(join('Notas', 'pic.png')), false)
  assert.equal(isIgnoredChange(join('Notas', 'TODO.md')), false)
  assert.equal(isIgnoredChange('Release v1.2'), false)
})

test('cuts a search snippet to one line around the match', () => {
  const text = `${'a'.repeat(100)}\nthe match\n${'b'.repeat(100)}`
  const snippet = snippetAt(text, text.indexOf('match'), 5, 10)
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'), snippet)
  assert.ok(snippet.includes('the match'), snippet)
  assert.ok(!snippet.includes('\n'))
})

test('finds an attachment by path, by the end of its path, then by name', () => {
  const files = ['Adjuntos/pic.png', 'Notas/img/plan.jpg']
  assert.equal(resolveAttachment(files, 'Adjuntos/pic.png'), 'Adjuntos/pic.png')
  assert.equal(resolveAttachment(files, 'img/plan.jpg'), 'Notas/img/plan.jpg')
  assert.equal(resolveAttachment(files, 'PIC.png'), 'Adjuntos/pic.png')
  assert.equal(resolveAttachment(files, 'missing.png'), null)
})
