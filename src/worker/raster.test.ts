import { assert, test } from 'orca/testing'
import { inflateSync } from 'node:zlib'
import { systemFonts } from './font'
import { encodePng, renderPng } from './raster'

test('writes a PNG Orca can show: signature, size and pixels', () => {
  const png = encodePng(2, 1, new Float32Array([1, 0, 0, 1, 0, 0, 1, 0.5]))
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(png.readUInt32BE(16), 2)
  assert.equal(png.readUInt32BE(20), 1)
  const idat = png.indexOf('IDAT')
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)))
  assert.deepEqual([...raw], [0, 255, 0, 0, 255, 0, 0, 255, 128])
})

test('fills a shape where it is, antialiased at its edges', () => {
  const fonts = systemFonts()
  if (!fonts) return
  const png = renderPng({ width: 10, height: 10, shapes: [{ kind: 'rect', x: 2, y: 2, width: 5.5, height: 6, fill: '#ff0000' }] }, fonts, 1)
  const idat = png.indexOf('IDAT')
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)))
  const alpha = (x: number, y: number): number => raw[y * 41 + 1 + x * 4 + 3]
  assert.equal(alpha(0, 0), 0)
  assert.equal(alpha(4, 4), 255)
  assert.ok(alpha(7, 4) > 100 && alpha(7, 4) < 160, String(alpha(7, 4)))
})

test('reads a system font: its glyphs and their widths', () => {
  const fonts = systemFonts()
  if (!fonts) return
  const glyph = fonts.regular.glyphOf('A'.codePointAt(0)!)
  assert.ok(glyph > 0)
  assert.ok(fonts.regular.outline(glyph).length > 0)
  assert.ok(fonts.regular.advance(glyph) > 0)
})
