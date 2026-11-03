import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { buildInkPlan, evaluatePlan, prepareImage } from '../server/ink-paths.ts'
import { DEFAULT_SETTINGS, imagePlacement, type DrawingPlan } from '../src/plotter.ts'

const directory = 'qa/toolpaths'
await mkdir(directory, { recursive: true })
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['sample-drawing', 'style-realista', 'style-anime', 'style-infantil', 'style-caricatura']
const summaries = []
for (const name of names) {
  const buffer = await readFile(`public/assets/${name}.png`)
  const input = await prepareImage(buffer)
  const alternatives: Array<{ pen: number; threshold: number; quality: number; detail: number; seconds: number; paths: number }> = []
  let best: DrawingPlan | null = null
  for (const penWidthMm of process.env.QUALITY_SWEEP ? [.2, .3] : [DEFAULT_SETTINGS.penWidthMm]) for (const threshold of [128, 170, 210]) {
    const start = performance.now()
    const plan = await buildInkPlan(input, { ...DEFAULT_SETTINGS, penWidthMm }, threshold)
    const quality = await evaluatePlan(input, plan)
    plan.quality = { ...quality, threshold }
    const candidate = { pen: penWidthMm, threshold, quality: quality.inkF1, detail: quality.detailF1, seconds: (performance.now() - start) / 1000, paths: plan.strokes.length }
    alternatives.push(candidate); console.log(name, candidate)
    await writeFile(`${directory}/${name}-${penWidthMm}-${threshold}.svg`, plan.svg)
    if (!best || quality.inkF1 + quality.detailF1 > best.quality!.inkF1 + best.quality!.detailF1) best = plan
  }
  const selected = best!
  await writeFile(`${directory}/${name}-plan.json`, JSON.stringify(selected))
  await writeFile(`${directory}/${name}.gcode`, selected.gcode)
  const metadata = await sharp(buffer).metadata(), placement = imagePlacement(metadata.width!, metadata.height!)
  const reference = `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297"><rect width="210" height="297" fill="white"/><image x="${placement.x}" y="${placement.y}" width="${metadata.width! * placement.scale}" height="${metadata.height! * placement.scale}" href="data:image/png;base64,${buffer.toString('base64')}"/></svg>`
  const panels = await Promise.all([reference, selected.svg].map((svg) => sharp(Buffer.from(svg)).resize(630, 891).png().toBuffer()))
  const labels = `<svg width="1260" height="50"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="22" fill="#13213a" text-anchor="middle"><text x="315" y="32">PNG original</text><text x="945" y="32">Trajetos do G-code • caneta ${selected.penWidthMm} mm</text></g></svg>`
  await sharp({ create: { width: 1260, height: 941, channels: 3, background: 'white' } }).composite([{ input: Buffer.from(labels), left: 0, top: 0 }, ...panels.map((input, i) => ({ input, left: i * 630, top: 50 }))]).jpeg({ quality: 95 }).toFile(`${directory}/${name}-comparison.jpg`)
  const summary = { name, after: selected.quality, pen: selected.penWidthMm, stats: selected.stats, alternatives }
  summaries.push(summary)
  console.log(JSON.stringify(summary))
}
await writeFile(`${directory}/quality.json`, JSON.stringify(summaries, null, 2))
