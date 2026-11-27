import { assert, test } from 'orca/testing'
import { chunkMarkdown, noteTags, plainSnippet, fileLinks, mapImages, folderCrumbs, imageOnLine, splitTags, splitTitle, fenceAfter, frontMatterProperties, joinNotePath, noteLinks, noteSegments, replaceWikilinks, sectionColor, sectionIndexes, stripComments, stripFrontMatter, taskOnLine, utf8Length } from './markdown'

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
    { kind: 'callout', tone: 'warning', title: 'One client', text: 'Only one at a time. Really.' },
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

test('numbers the sections, each subsection with its own', () => {
  const segments = noteSegments('# Title\nIntro\n## One\n### One.a\nText\n## Two\n## Three')
  const headings = segments
    .map((segment, index) => ({ segment, section: sectionIndexes(segments)[index] }))
    .filter(({ segment }) => segment.kind === 'heading')
    .map(({ segment, section }) => `${segment.kind === 'heading' ? segment.text : ''}:${section}`)
  assert.deepEqual(headings, ['Title:0', 'One:0', 'One.a:0', 'Two:1', 'Three:2'])
})

test('gives every section a color of its own, however many there are', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const colors = Array.from({ length: 60 }, (_unused, index) => sectionColor(index, scheme))
    assert.ok(colors.every((color) => /^#[0-9a-f]{6}$/.test(color)), colors.join(' '))
    assert.equal(new Set(colors).size, colors.length)
  }
  assert.notEqual(sectionColor(0, 'light'), sectionColor(0, 'dark'))
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

test('draws a paragraph that links to notes as runs, its links to press; code and web links stay', () => {
  const segments = noteSegments('[[A]] and [b](B.md) and [web](https://x.y) and `[[code]]` **bold [[C|see]]**.\n```\n[[fenced]]\n```', 'Docs/TODO.md')
  assert.deepEqual(segments, [
    {
      kind: 'rich',
      runs: [
        { kind: 'note', text: 'A', target: 'A' },
        { kind: 'text', text: ' and ' },
        { kind: 'note', text: 'b', target: 'Docs/B.md' },
        { kind: 'text', text: ' and ' },
        { kind: 'link', text: 'web', href: 'https://x.y' },
        { kind: 'text', text: ' and ' },
        { kind: 'text', text: '[[code]]', code: true },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'bold ', bold: true },
        { kind: 'note', text: 'see', target: 'C' },
        { kind: 'text', text: '.' }
      ]
    },
    { kind: 'markdown', text: '```\n[[fenced]]\n```' }
  ])
})

test('leaves to Orca the text with no link to the vault, and draws a whole list when one item has one', () => {
  assert.deepEqual(noteSegments('Plain *text* and [web](https://x.y).\n\n- One\n- Two\n\n1. See [[A]]\n   - nested https://x.y/z.\n2. Last'), [
    { kind: 'markdown', text: 'Plain *text* and [web](https://x.y).\n\n- One\n- Two\n' },
    {
      kind: 'list',
      items: [
        { level: 0, marker: '1.', runs: [{ kind: 'text', text: 'See ' }, { kind: 'note', text: 'A', target: 'A' }] },
        { level: 1, marker: '•', runs: [{ kind: 'text', text: 'nested ' }, { kind: 'link', text: 'https://x.y/z', href: 'https://x.y/z' }, { kind: 'text', text: '.' }] },
        { level: 0, marker: '2.', runs: [{ kind: 'text', text: 'Last' }] }
      ]
    }
  ])
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
    { kind: 'image', target: 'pic.png', alt: 'pic.png', width: 300 },
    { kind: 'image', target: 'img/plan 1.jpg', alt: 'The plan' },
    { kind: 'markdown', text: 'Inline *(pic.png)* stays *(Other note)*' },
    { kind: 'badges', items: [{ alt: 'web', url: 'https://x.y/a.png' }] }
  ])
})

test('reads a README HTML block like the rest of the note, each piece lined up as the block says', () => {
  const readme = [
    '<div align="center">',
    '',
    '# <img src="assets/icon.png" alt="" width="40"> Vault',
    '',
    '**Tagline**',
    '',
    '[![Obsidian](https://img.shields.io/badge/Obsidian-7C3AED)](https://obsidian.md/)',
    '<a href="https://git-scm.com/"><img src="https://img.shields.io/badge/Git-F05032" alt="Git"></a>',
    '',
    '<img src="assets/cover.png" alt="The cover" width="820">',
    '',
    '</div>',
    '',
    '## After',
    '<p align="right"><img src="assets/cover.png" alt="Again" width="40"></p>',
    'Plain'
  ].join('\n')
  assert.deepEqual(noteSegments(readme, 'Docs/README.md'), [
    { kind: 'heading', level: 1, text: 'Vault', markdown: '# Vault', icon: 'Docs/assets/icon.png', align: 'center' },
    { kind: 'markdown', text: '\n**Tagline**\n', align: 'center' },
    {
      kind: 'badges',
      items: [
        { alt: 'Obsidian', url: 'https://img.shields.io/badge/Obsidian-7C3AED' },
        { alt: 'Git', url: 'https://img.shields.io/badge/Git-F05032' }
      ],
      align: 'center'
    },
    { kind: 'image', target: 'Docs/assets/cover.png', alt: 'The cover', width: 820, align: 'center' },
    { kind: 'heading', level: 2, text: 'After', markdown: '## After' },
    { kind: 'image', target: 'Docs/assets/cover.png', alt: 'Again', width: 40, align: 'right' },
    { kind: 'markdown', text: 'Plain' }
  ])
  assert.deepEqual(splitTitle(noteSegments(readme, 'Docs/README.md'), 'README').align, 'center')
})

test('points the images of a text at their copies, and leaves out those not ready', () => {
  const text = '<img src="assets/icon.png" width="40"> ![b](https://x.y/b.svg) ![c](c.png) `![code](x.png)`'
  const copies: Record<string, string> = { 'Docs/assets/icon.png': 'cache/1.png', 'https://x.y/b.svg': 'cache/2.svg' }
  assert.equal(
    mapImages(text, 'Docs/README.md', (image) => copies[image.target || image.src] ?? null),
    '<img src="cache/1.png" width="40"> ![b](cache/2.svg)  `![code](x.png)`'
  )
})

test('takes a vault icon before a heading text, outside an HTML block, and drops the tag', () => {
  const segments = noteSegments('# <img src="icon.png" width="32"> Name\nText', 'README.md')
  assert.deepEqual(segments[0], { kind: 'heading', level: 1, text: 'Name', markdown: '# Name', icon: 'icon.png' })
  assert.equal(splitTitle(segments, 'README').icon, 'icon.png')
})

test('joins the lines a paragraph or list item wraps over, and leaves code and tables', () => {
  const text = 'One\ntwo.\n\n- Item\n  goes on.\n- Next\n\n```\na\nb\n```\n| a |\n| b |\nHard  \nbreak'
  assert.deepEqual(noteSegments(text), [
    { kind: 'markdown', text: 'One two.\n\n- Item goes on.\n- Next\n\n```\na\nb\n```\n| a |\n| b |\nHard  \nbreak' }
  ])
})

test('reads a wikilink whose target holds a bracket, and lists only notes among the links', () => {
  assert.equal(replaceWikilinks('[[[V] Hours.json]]'), '**[V] Hours.json**')
  assert.deepEqual(noteLinks('[[[V] Hours.json]] [[Plan]] [[v1.2]]', 'x.md'), [
    { label: 'Plan', target: 'Plan' },
    { label: 'v1.2', target: 'v1.2' }
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

test('lists the files the text mentions, but not its drawn images, its notes or the lines of files alone', () => {
  const text = '![[[V] Hours.json]]\nSee [[plan.pdf|The plan]] [[Note]] ![[pic.png]]\n[sheet](../files/a%20b.xlsx) and [web](https://x.y/c.pdf)\n`[[code.json]]`'
  assert.deepEqual(fileLinks(text, 'Docs/TODO.md'), [
    { label: 'The plan', target: 'plan.pdf' },
    { label: 'sheet', target: 'files/a b.xlsx' }
  ])
})

test('draws lines of file links alone where they are, one segment for lines in a row', () => {
  assert.deepEqual(noteSegments('Templates\n![[[V] Hours.json]]\n- [[plan.pdf|The plan]], [sheet](a.xlsx)\nSee [[x.pdf]] here', 'Docs/TODO.md'), [
    { kind: 'markdown', text: 'Templates' },
    {
      kind: 'files',
      items: [
        { label: '[V] Hours.json', target: '[V] Hours.json' },
        { label: 'The plan', target: 'plan.pdf' },
        { label: 'sheet', target: 'Docs/a.xlsx' }
      ]
    },
    { kind: 'rich', runs: [{ kind: 'text', text: 'See ' }, { kind: 'file', text: 'x.pdf', target: 'x.pdf' }, { kind: 'text', text: ' here' }] }
  ])
})

test('makes a mermaid block a diagram segment, keeping the block to show when it cannot be drawn', () => {
  assert.deepEqual(noteSegments('Before\n```mermaid\ngraph TD\nA --> B\n```\nAfter'), [
    { kind: 'markdown', text: 'Before' },
    { kind: 'diagram', code: 'graph TD\nA --> B', markdown: '```mermaid\ngraph TD\nA --> B\n```' },
    { kind: 'markdown', text: 'After' }
  ])
})

test('tells a property that links to files from one that names them', () => {
  const properties = frontMatterProperties('---\nattachments:\n  - "[[Docs/plan.docx|The plan]]"\n  - "[[sheet.xlsx]]"\none: "[[plan.docx]]"\nnote: "[[Release]]"\nmixed: ["[[a.pdf]]", text]\nname: plan.docx\n---\n')
  assert.deepEqual(properties.map((property) => [property.label, property.value, property.files]), [
    ['attachments', 'The plan, sheet.xlsx', [{ label: 'The plan', target: 'Docs/plan.docx' }, { label: 'sheet.xlsx', target: 'sheet.xlsx' }]],
    ['one', 'plan.docx', [{ label: 'plan.docx', target: 'plan.docx' }]],
    ['note', 'Release', undefined],
    ['mixed', 'a.pdf, text', undefined],
    ['name', 'plan.docx', undefined]
  ])
})

test('reads the tags of a note from its property, not the #words of its text', () => {
  const text = '---\ntags: [Task, "#work/guess", task]\n---\nDo it #Today, see [[Note#part]] and https://x.y/#n.'
  assert.deepEqual(noteTags(text), ['task', 'work/guess'])
})

test('shows a search hit as plain text, half a link at its end included', () => {
  assert.equal(plainSnippet('…the builds. ### Inspector de **pedidos** Ticket: [GLCG-16694](https://guess.atlassian.net…'), '…the builds. Inspector de pedidos Ticket: GLCG-16694')
  assert.equal(plainSnippet('- [ ] See [[Release|the release]] and `code`'), 'See the release and code')
})
