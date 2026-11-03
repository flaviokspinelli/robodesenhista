import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { buildInkPlan, createInkPlan, evaluatePlan, prepareImage } from '../server/ink-paths.ts'
import { DEFAULT_SETTINGS, imagePlacement, parseGcode, planFromGcode, planFromPaths, simplifyPath } from '../src/plotter.ts'

test('G-code is absolute metric, pen-up travels, bounded A4 and round-trips without moving artwork', () => {
  const original = [[{ x: 24.125, y: 32.75 }, { x: 24.125, y: 120.75 }, { x: 85.5, y: 150 }], [{ x: 170, y: 200 }, { x: 180, y: 210 }]]
  const plan = planFromPaths(original, DEFAULT_SETTINGS)
  assert.deepEqual(plan.strokes.map((s) => s.points), original)
  assert.equal(planFromGcode(plan.gcode).svg, plan.svg)
  assert.match(plan.gcode, /G21\nG90/)
  assert.match(plan.gcode, /M3 S90\nG4 P0.18\nG0/)
  assert.match(plan.svg, /stroke-width="0.3"/)
  assert.throws(() => planFromPaths([[{ x: 0, y: 50 }, { x: 30, y: 70 }]], DEFAULT_SETTINGS), /área útil/)
  assert.throws(() => planFromPaths([[{ x: NaN, y: 50 }, { x: 30, y: 70 }]], DEFAULT_SETTINGS), /inválido/)
})

test('parser refuses motions that would make the preview misleading', () => {
  for (const bad of ['G20', 'G91', 'G2 X30 Y30 I2 J3', 'G1 XNaN Y3', 'G1 X220 Y10', 'G1 X2 Z3', 'M3 S90\nG0 X10 Y10\nM3 S0\nG0 X20 Y20', 'G21 G91', 'M3 S25']) assert.throws(() => parseGcode(bad))
})

test('frame fitting keeps the entire canvas including white margins and preserves aspect', () => {
  const layout = imagePlacement(1000, 1500)
  assert.equal(layout.scale, .182)
  assert.equal(layout.x, 14)
  assert.equal(layout.y, 12)
  const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]
  assert.equal(simplifyPath(line, .025).length, 3)
})

const png = (contents: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/>${contents}</svg>`)).png().toBuffer()

test('thin line produces a single centre stroke, not the two outline edges', async () => {
  const input = await prepareImage(await png('<path d="M100 400.5H500" fill="none" stroke="black" stroke-width="0.9"/>'))
  const plan = await buildInkPlan(input, DEFAULT_SETTINGS, 128)
  assert.equal(plan.strokes.length, 1)
  assert.ok(plan.stats.drawingMm > 245 && plan.stats.drawingMm < 250)
})

test('filled shapes stay filled and the white hole stays empty in rendered G-code', async () => {
  const input = await prepareImage(await png('<circle cx="300" cy="400" r="48" fill="black"/><circle cx="300" cy="400" r="17" fill="white"/>'))
  const plan = await buildInkPlan(input, DEFAULT_SETTINGS, 128)
  const quality = await evaluatePlan(input, plan)
  assert.ok(quality.inkF1 > .95, String(quality.inkF1))
  const { data, info } = await sharp(Buffer.from(plan.svg)).resize(840, 1188).grayscale().raw().toBuffer({ resolveWithObject: true })
  assert.equal(data[594 * info.width + 420], 255)
  assert.ok(data[594 * info.width + 450] < 20)
})

test('separate strokes never get a drawn bridge through the white gap', async () => {
  const input = await prepareImage(await png('<path d="M100 300H295 M305 300H500" fill="none" stroke="black" stroke-width="1"/>'))
  const plan = await buildInkPlan(input, DEFAULT_SETTINGS, 170)
  const placement = imagePlacement(600, 800), centre = placement.x + placement.scale * 300
  for (const stroke of plan.strokes) assert.ok(stroke.points.every((p) => p.x < centre) || stroke.points.every((p) => p.x > centre))
})

test('empty and invalid images fail rather than yielding a blank success; excessive fill is rejected', async () => {
  await assert.rejects(createInkPlan(Buffer.from('not an image')))
  await assert.rejects(createInkPlan(await png('')), /não contém/)
  const solid = await prepareImage(await png('<rect width="600" height="800" fill="black"/>'))
  await assert.rejects(buildInkPlan(solid), /preto demais/)
})
