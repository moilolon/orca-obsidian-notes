import { assert, test } from 'orca/testing'
import { chunkMarkdown, noteSegments, replaceWikilinks, sectionTones, stripFrontMatter, wikilinkTargets } from './markdown'

test('drops the YAML front matter and keeps the body', () => {
  assert.equal(stripFrontMatter('---\ntags:\n  - todo\n---\n# TODO\n'), '# TODO\n')
  assert.equal(stripFrontMatter('# No front matter\n---\n'), '# No front matter\n---\n')
})

test('lists each linked note once, leaving embeds out', () => {
  const text = 'See [[Release (GLCG-16693)]], [[Notas/TODO|the todo]] and [[Release (GLCG-16693)#Scope]]. ![[diagram.png]]'
  assert.deepEqual(wikilinkTargets(text), ['Release (GLCG-16693)', 'Notas/TODO'])
})

test('shows wikilinks as bold text and embeds as a note', () => {
  assert.equal(replaceWikilinks('[[A]] [[B|bee]] [[C#Part]] ![[pic.png]]'), '**A** **bee** **C#Part** *(pic.png)*')
})

test('turns an Obsidian callout into its own segment', () => {
  const segments = noteSegments('Intro\n\n> [!warning] One client\n> Only one at a time.\n> Really.\n\nAfter')
  assert.deepEqual(segments, [
    { kind: 'markdown', text: 'Intro\n' },
    { kind: 'callout', tone: 'warning', title: 'One client', text: 'Only one at a time.\nReally.' },
    { kind: 'markdown', text: '\nAfter' }
  ])
})

test('names an untitled callout after its type and maps unknown types to neutral', () => {
  const [callout] = noteSegments('> [!TIP]\n> Short')
  assert.deepEqual(callout, { kind: 'callout', tone: 'success', title: 'Tip', text: 'Short' })
  const [other] = noteSegments('> [!custom] Mine\n> Body')
  assert.equal(other.kind === 'callout' && other.tone, 'neutral')
})

test('makes each heading its own segment, levels past 4 drawn as 4, inline marks dropped', () => {
  const segments = noteSegments('# TODO\n\n## Tickets **en** curso\nText\n###### Deep `code`\n```\n# not a heading\n```')
  assert.deepEqual(segments, [
    { kind: 'heading', level: 1, text: 'TODO', markdown: '# TODO' },
    { kind: 'heading', level: 2, text: 'Tickets en curso', markdown: '## Tickets **en** curso' },
    { kind: 'markdown', text: 'Text' },
    { kind: 'heading', level: 4, text: 'Deep code', markdown: '#### Deep `code`' },
    { kind: 'markdown', text: '```\n# not a heading\n```' }
  ])
})

test('leaves a callout-looking line inside a code fence alone', () => {
  const segments = noteSegments('```\n> [!warning] not a callout\n```')
  assert.equal(segments.length, 1)
  assert.equal(segments[0].kind, 'markdown')
})

test('splits long Markdown at blank lines, never inside a code fence', () => {
  const paragraph = 'x'.repeat(40)
  const text = [paragraph, '', '```', paragraph, '', paragraph, '```', '', paragraph].join('\n')
  const chunks = chunkMarkdown(text, 50)
  assert.ok(chunks.length > 1)
  assert.equal(chunks.join('\n').replace(/\n+/g, '\n'), text.replace(/\n+/g, '\n'))
  assert.ok(chunks.some((chunk) => chunk.includes('```\n' + paragraph + '\n\n' + paragraph + '\n```')))
})

test('gives each section the next color and its subsections the same one', () => {
  const segments = noteSegments('# Title\nIntro\n## One\n### One.a\nText\n## Two\n## Three\n## Four\n## Five')
  const headings = segments
    .map((segment, index) => ({ segment, tone: sectionTones(segments)[index] }))
    .filter(({ segment }) => segment.kind === 'heading')
    .map(({ segment, tone }) => `${segment.kind === 'heading' ? segment.text : ''}:${tone}`)
  assert.deepEqual(headings, ['Title:accent', 'One:accent', 'One.a:accent', 'Two:success', 'Three:warning', 'Four:danger', 'Five:accent'])
})
