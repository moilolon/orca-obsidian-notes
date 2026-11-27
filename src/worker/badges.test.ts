import { assert, test } from 'orca/testing'
import { badgeOf, badgesScene } from './badges'

test('reads a static shields.io badge: its label, message, colors and size', () => {
  assert.deepEqual(badgeOf('Git', 'https://img.shields.io/badge/Git_Sync-F05032?style=for-the-badge&logo=git'), {
    label: '',
    message: 'Git Sync',
    color: '#f05032',
    labelColor: '#555555',
    large: true
  })
  assert.deepEqual(badgeOf('', 'https://img.shields.io/badge/build--tool-passing-brightgreen?labelColor=333'), {
    label: 'build-tool',
    message: 'passing',
    color: '#44cc11',
    labelColor: '#333',
    large: false
  })
})

test('shows any other badge by its alt text on grey', () => {
  assert.deepEqual(badgeOf('CI', 'https://github.com/a/b/actions/workflows/ci.yml/badge.svg'), {
    label: '',
    message: 'CI',
    color: '#555555',
    labelColor: '#555555',
    large: false
  })
})

test('lays badges out in rows that wrap, centred when asked', () => {
  const measure = (text: string, size: number): number => [...text].length * size * 0.6
  const badges = ['https://img.shields.io/badge/Obsidian-7C3AED?style=for-the-badge', 'https://img.shields.io/badge/license-MIT-blue'].map((url) => badgeOf('', url))
  const scene = badgesScene(badges, measure, true)
  const texts = scene.shapes.flatMap((shape) => (shape.kind === 'text' ? [shape.text] : []))
  assert.deepEqual(texts, ['OBSIDIAN', 'license', 'MIT'])
  assert.ok(scene.shapes.some((shape) => shape.kind === 'rect' && shape.fill === '#7c3aed'))
  const many = badgesScene(Array.from({ length: 12 }, () => badges[0]), measure)
  assert.ok(many.width <= 400 && many.height > 28, `${many.width}x${many.height}`)
})
