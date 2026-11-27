import { assert, test } from 'orca/testing'
import { flowchartScene, parseFlowchart } from './mermaid'

test('reads a flowchart: shapes, labels with line breaks, links with text and their styles', () => {
  const chart = parseFlowchart('flowchart LR\n  A["💻 PC<br/>Windows"] <-->|"cada 5 min"| B[("GitHub")]\n  C -.->|lee| A\n  B -- sync --> D([Phone]) & E{Ok?}\n  %% a comment\n  style A fill:#f00')
  assert.ok(chart)
  assert.equal(chart.direction, 'LR')
  assert.deepEqual(chart.nodes.map((node) => [node.id, node.shape, node.lines]), [
    ['A', 'rect', ['💻 PC', 'Windows']],
    ['B', 'cylinder', ['GitHub']],
    ['C', 'rect', ['C']],
    ['D', 'stadium', ['Phone']],
    ['E', 'diamond', ['Ok?']]
  ])
  assert.deepEqual(chart.edges.map((edge) => [edge.from, edge.to, edge.style, edge.arrowStart, edge.arrowEnd, edge.lines.join(' ')]), [
    ['A', 'B', 'solid', true, true, 'cada 5 min'],
    ['C', 'A', 'dotted', false, true, 'lee'],
    ['B', 'D', 'solid', false, true, 'sync'],
    ['B', 'E', 'solid', false, true, 'sync']
  ])
})

test('reads links with no spaces and chains of them; TD is top to bottom', () => {
  const chart = parseFlowchart('graph TD\nA-->B==>C---D')
  assert.equal(chart?.direction, 'TB')
  assert.deepEqual(chart?.edges.map((edge) => `${edge.from}${edge.to}:${edge.style}:${edge.arrowEnd}`), ['AB:solid:true', 'BC:thick:true', 'CD:solid:false'])
})

/** A stand-in for the font: every character as wide. */
const measure = (text: string, size: number): number => [...text].length * size * 0.55

test('lays out only flowcharts, their text as written', () => {
  assert.equal(flowchartScene('sequenceDiagram\nA->>B: hi', 'dark', measure), null)
  const scene = flowchartScene('flowchart TB\nA["a < b & c"] --> B', 'dark', measure)!
  assert.ok(scene.shapes.some((shape) => shape.kind === 'text' && shape.text === 'a < b & c'))
  assert.ok(scene.shapes.some((shape) => shape.kind === 'path' && shape.arrowEnd))
})

test('lays a long left-to-right chart out top to bottom, to fit the narrow panel', () => {
  const long = flowchartScene('flowchart LR\nA[One long box] --> B[Two long box] --> C[Three long box] --> D[Four long box]', 'dark', measure)!
  assert.ok(long.height > long.width, `${long.width}x${long.height}`)
  const short = flowchartScene('flowchart LR\nA --> B', 'dark', measure)!
  assert.ok(short.width > short.height, `${short.width}x${short.height}`)
})
