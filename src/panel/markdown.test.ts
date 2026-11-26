import { assert, test } from 'orca/testing'
import { chunkMarkdown, folderCrumbs, imageOnLine, splitTags, splitTitle, fenceAfter, frontMatterProperties, joinNotePath, noteLinks, noteSegments, replaceWikilinks, sectionTones, stripComments, stripFrontMatter, taskOnLine, utf8Length } from './markdown'

test('drops the YAML front matter and keeps the body', () => {
  assert.equal(stripFrontMatter('---\ntags:\n  - todo\n---\n# TODO\n'), '# TODO\n')
  assert.equal(stripFrontMatter('# No front matter\n---\n'), '# No front matter\n---\n')
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

test('lists each linked note once, Markdown links by their vault path, leaving embeds and code out', () => {
  const text = [
    'See [[Release (ABC-123)]], [[Docs/TODO|the todo]] and [[Release (ABC-123)#Scope]]. ![[diagram.png]]',
    'Also [the plan](../Plans/Q1%20plan.md#Goals), [web](https://example.com/x.md) and [pic](a.png).',
    '`[[In code]]` %% [[In a comment]] %%',
    '```',
    '[[In a fence]]',
    '```'
  ].join('\n')
  assert.deepEqual(noteLinks(text, 'Docs/TODO.md'), [
    { label: 'Release (ABC-123)', target: 'Release (ABC-123)' },
    { label: 'Docs/TODO', target: 'Docs/TODO' },
    { label: 'the plan', target: 'Plans/Q1 plan.md' }
  ])
})

test('joins a Markdown link to the note it is written in', () => {
  assert.equal(joinNotePath('A/B/note.md', 'other.md'), 'A/B/other.md')
  assert.equal(joinNotePath('A/B/note.md', './../C/x.md'), 'A/C/x.md')
  assert.equal(joinNotePath('A/B/note.md', '/Top.md'), 'Top.md')
})

test('shows note links as bold text, but leaves code and web links as they are', () => {
  const segments = noteSegments('[[A]] and [b](B.md) and [web](https://x.y) and `[[code]]`\n```\n[[fenced]]\n```')
  assert.deepEqual(segments, [{ kind: 'markdown', text: '**A** and **b** and [web](https://x.y) and `[[code]]`\n```\n[[fenced]]\n```' }])
})

test('hides Obsidian comments, inline and over several lines, but not inside code', () => {
  assert.equal(stripComments('Keep %%hidden%% this\n%%\nall\nof this\n%%\nAfter\n```\n%% code %%\n```'), 'Keep  this\nAfter\n```\n%% code %%\n```')
})

test('reads the front matter as properties', () => {
  const text = '---\ntags:\n  - todo\n  - "work"\nstatus: open\naliases: [One, Two]\nempty:\nup: "[[Index|Home]]"\nnested:\n  key: value\n---\nBody'
  assert.deepEqual(frontMatterProperties(text), [
    { label: 'tags', value: 'todo, work', values: ['todo', 'work'] },
    { label: 'status', value: 'open', values: ['open'] },
    { label: 'aliases', value: 'One, Two', values: ['One', 'Two'] },
    { label: 'up', value: 'Home', values: ['Home'] }
  ])
  assert.deepEqual(frontMatterProperties('No front matter'), [])
})

test('keeps a callout title plain text, its links included', () => {
  const [callout] = noteSegments('> [!note] See [[Other]]\n> Body')
  assert.equal(callout.kind === 'callout' && callout.title, 'See Other')
})

test('cuts a long block with no blank line under the byte limit, repeating a table header', () => {
  const rows = Array.from({ length: 40 }, (_, i) => `| row ${i} | ${'á'.repeat(20)} |`)
  const text = ['| Name | Value |', '| --- | --- |', ...rows].join('\n')
  const chunks = chunkMarkdown(text, 50, 400)
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) {
    assert.ok(utf8Length(chunk) <= 400 + 32, `${utf8Length(chunk)} bytes`)
    assert.ok(chunk.startsWith('| Name | Value |\n| --- | --- |'), chunk.slice(0, 40))
  }
})

test('closes and reopens a code fence cut for size', () => {
  const text = ['```ts', ...Array.from({ length: 30 }, (_, i) => `const line${i} = ${i}`), '```'].join('\n')
  const chunks = chunkMarkdown(text, 50, 200)
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) {
    assert.ok(chunk.startsWith('```ts'), chunk)
    assert.ok(chunk.trimEnd().endsWith('```'), chunk)
  }
})

test('counts UTF-8 bytes as Orca does', () => {
  assert.equal(utf8Length('aá€😀'), 1 + 2 + 3 + 4)
})

test('a fence closes only with its own marker', () => {
  assert.equal(fenceAfter('```', null), '```')
  assert.equal(fenceAfter('~~~', '```'), '```')
  assert.equal(fenceAfter('````', '```'), null)
  assert.equal(fenceAfter('```js', '```'), '```')
})

test('makes an image on a line of its own a segment, by name or by its path from the note', () => {
  const segments = noteSegments('Before\n![[pic.png|300]]\n![The plan](../img/plan%201.jpg)\nInline ![[pic.png]] stays\n![[Other note]]\n![web](https://x.y/a.png)', 'Docs/TODO.md')
  assert.deepEqual(segments, [
    { kind: 'markdown', text: 'Before' },
    { kind: 'image', target: 'pic.png', alt: 'pic.png' },
    { kind: 'image', target: 'img/plan 1.jpg', alt: 'The plan' },
    { kind: 'markdown', text: 'Inline *(pic.png)* stays\n*(Other note)*\n![web](https://x.y/a.png)' }
  ])
})

test('reads an image caption, but not a width, as its alt text', () => {
  assert.deepEqual(imageOnLine('![[a/pic.webp|Our logo]]', 'x.md'), { target: 'a/pic.webp', alt: 'Our logo' })
  assert.equal(imageOnLine('![[notes.pdf]]', 'x.md'), null)
})

test('lists the folders a note sits in, outermost first', () => {
  assert.deepEqual(folderCrumbs('Work/Docs/TODO.md'), [
    { label: 'Work', path: 'Work' },
    { label: 'Docs', path: 'Work/Docs' }
  ])
  assert.deepEqual(folderCrumbs('Top.md'), [])
})

test('takes the opening # heading as the title, or the file name', () => {
  const segments = noteSegments('# Mi lista\n\nText')
  assert.deepEqual(splitTitle(segments, 'TODO'), { title: 'Mi lista', body: [{ kind: 'markdown', text: '\nText' }] })
  assert.equal(splitTitle(noteSegments('Text\n# Later'), 'TODO').title, 'TODO')
})

test('splits the tags from the other properties', () => {
  const properties = frontMatterProperties('---\ntags: [a, "#b"]\ntag: c d\nestado: x\n---\n')
  assert.deepEqual(splitTags(properties), { tags: ['a', 'b', 'c', 'd'], others: [{ label: 'estado', value: 'x', values: ['x'] }] })
})

test('reads a task line: its level, status and text', () => {
  assert.deepEqual(taskOnLine('- [ ] Buy'), { level: 0, status: 'todo', text: 'Buy' })
  assert.deepEqual(taskOnLine('\t* [x] Done'), { level: 1, status: 'done', text: 'Done' })
  assert.deepEqual(taskOnLine('    - [-] Dropped'), { level: 2, status: 'cancelled', text: 'Dropped' })
  assert.deepEqual(taskOnLine('- [?] Odd'), { level: 0, status: 'todo', text: 'Odd' })
  assert.equal(taskOnLine('- plain'), null)
})

test('makes tasks in a row one segment, apart from the prose, their links as bold text', () => {
  assert.deepEqual(noteSegments('Intro\n- [ ] One [[A]]\n\n- [/] Two\nAfter'), [
    { kind: 'markdown', text: 'Intro' },
    { kind: 'tasks', items: [{ level: 0, status: 'todo', text: 'One **A**' }, { level: 0, status: 'doing', text: 'Two' }] },
    { kind: 'markdown', text: 'After' }
  ])
})
