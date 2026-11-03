import sharp from 'sharp'
import { contours } from 'd3-contour'
import { setImmediate } from 'node:timers/promises'
import { DEFAULT_SETTINGS, distance, imagePlacement, pathLength, planFromPaths, simplifyPath, type DrawingPlan, type PlotSettings, type Point } from '../src/plotter.ts'

const DX = [0, 1, 1, 1, 0, -1, -1, -1]
const DY = [-1, -1, 0, 1, 1, 1, 0, -1]

// Euclidean distance transform, separable lower envelopes of parabolas.
// Distances are from pixel centres; subtract half a pixel to locate the edge.
export function distanceField(mask: Uint8Array, width: number, height: number) {
  const field = Float32Array.from(mask, (p) => p ? 1e12 : 0)
  const length = Math.max(width, height), f = new Float64Array(length), d = new Float64Array(length)
  const v = new Int32Array(length), z = new Float64Array(length + 1)
  const transform = (n: number) => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity
    for (let q = 1; q < n; q++) {
      let s: number
      do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p)); if (s <= z[k]) k--; else break } while (k >= 0)
      k++; v[k] = q; z[k] = s!; z[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]] }
  }
  for (let x = 0; x < width; x++) { for (let y = 0; y < height; y++) f[y] = field[y * width + x]; transform(height); for (let y = 0; y < height; y++) field[y * width + x] = d[y] }
  for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) f[x] = field[y * width + x]; transform(width); for (let x = 0; x < width; x++) field[y * width + x] = Math.max(0, Math.sqrt(d[x]) - .5) }
  return field
}

export async function thinMask(mask: Uint8Array, width: number, height: number) {
  const pixels = mask.slice()
  let active: number[] = []
  for (let i = width; i < pixels.length - width; i++) if (pixels[i]) active.push(i)
  let changed = true, pass = 0
  while (changed) {
    changed = false
    for (let second = 0; second < 2; second++) {
      const remove: number[] = []
      for (const i of active) {
        if (!pixels[i]) continue
        const a = pixels[i - width], b = pixels[i - width + 1], c = pixels[i + 1], d = pixels[i + width + 1]
        const e = pixels[i + width], f = pixels[i + width - 1], g = pixels[i - 1], h = pixels[i - width - 1]
        const count = a + b + c + d + e + f + g + h
        if (count < 2 || count > 6) continue
        const transitions = (!a && b ? 1 : 0) + (!b && c ? 1 : 0) + (!c && d ? 1 : 0) + (!d && e ? 1 : 0) + (!e && f ? 1 : 0) + (!f && g ? 1 : 0) + (!g && h ? 1 : 0) + (!h && a ? 1 : 0)
        if (transitions !== 1) continue
        if (second ? a * c * g || a * e * g : a * c * e || c * e * g) continue
        remove.push(i)
      }
      if (remove.length) changed = true
      for (const i of remove) pixels[i] = 0
    }
    if (++pass % 8 === 0) { active = active.filter((i) => pixels[i]); await setImmediate() }
  }
  return pixels
}

export function traceSkeleton(pixels: Uint8Array, width: number, height: number): Point[][] {
  const edges = new Uint8Array(pixels.length), visited = new Uint8Array(pixels.length), degree = new Uint8Array(pixels.length)
  const active: number[] = []
  const offsets = DX.map((dx, k) => dx + DY[k] * width)
  for (let i = width + 1; i < pixels.length - width - 1; i++) if (pixels[i]) {
    active.push(i)
    for (let k = 0; k < 8; k++) {
      if (!pixels[i + offsets[k]]) continue
      // Don't form a triangle across an already connected orthogonal corner.
      if (DX[k] && DY[k] && (pixels[i + DX[k]] || pixels[i + DY[k] * width])) continue
      edges[i] |= 1 << k; degree[i]++
    }
  }
  const point = (i: number): Point => ({ x: i % width + .5, y: Math.floor(i / width) + .5 })
  const paths: Point[][] = []
  const walk = (start: number, direction: number) => {
    const result = [point(start)]
    let current = start, k = direction
    while (true) {
      const next = current + offsets[k]
      visited[current] |= 1 << k; visited[next] |= 1 << ((k + 4) % 8)
      current = next; result.push(point(current))
      const remaining = edges[current] & ~visited[current]
      if (!remaining) break
      const previous = result[Math.max(0, result.length - 5)], here = result[result.length - 1]
      const ux = here.x - previous.x, uy = here.y - previous.y
      let best = -Infinity
      for (let candidate = 0; candidate < 8; candidate++) if (remaining & (1 << candidate)) {
        const score = (ux * DX[candidate] + uy * DY[candidate]) / Math.hypot(DX[candidate], DY[candidate])
        if (score > best) { best = score; k = candidate }
      }
    }
    return result
  }
  for (const starts of [active.filter((i) => degree[i] === 1), active]) for (const start of starts) {
    if (!degree[start]) { const p = point(start); paths.push([p, { x: p.x + .01, y: p.y }]); continue }
    for (let k = 0; k < 8; k++) if (edges[start] & ~visited[start] & (1 << k)) paths.push(walk(start, k))
  }
  return paths
}

function smoothPath(path: Point[]) {
  if (path.length < 4) return path
  const closed = distance(path[0], path[path.length - 1]) < .001
  const n = closed ? path.length - 1 : path.length
  const result = path.slice(0, n).map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return p
    const a = path[(i + n - 1) % n], b = path[(i + 1) % n]
    return { x: a.x * .2 + p.x * .6 + b.x * .2, y: a.y * .2 + p.y * .6 + b.y * .2 }
  })
  if (closed) result.push({ ...result[0] })
  return result
}

// A second stroke is useful only when its nib covers new black pixels. This
// removes short skeleton branches already covered by an inset/fill stroke.
function removeCoveredPaths(paths: Point[][], mask: Uint8Array, width: number, height: number, radius: number) {
  const covered = new Uint8Array(mask.length), seen = new Uint32Array(mask.length)
  const selected: Point[][] = []
  const sorted = paths.map((points) => ({ points, length: pathLength(points) })).sort((a, b) => b.length - a.length)
  let stamp = 0
  const r = radius * .92, radiusSquared = r * r
  for (const { points } of sorted) {
    stamp++
    const footprint: number[] = []
    let additional = 0
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1], b = points[k], dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy
      for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - r)); y <= Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + r)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - r)); x <= Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + r)); x++) {
          const index = y * width + x
          if (!mask[index] || seen[index] === stamp) continue
          const t = squared ? Math.max(0, Math.min(1, ((x + .5 - a.x) * dx + (y + .5 - a.y) * dy) / squared)) : 0
          if ((x + .5 - a.x - t * dx) ** 2 + (y + .5 - a.y - t * dy) ** 2 > radiusSquared) continue
          seen[index] = stamp; footprint.push(index)
          if (!covered[index]) additional++
        }
      }
    }
    if (additional < Math.max(1, Math.PI * r * r * .08)) continue
    selected.push(points)
    for (const i of footprint) covered[i] = 1
  }
  return selected
}

// Only reorder/reverse existing strokes. Never connect across white space.
export function orderPaths(paths: Point[][], canConnect?: (a: Point, b: Point) => boolean) {
  const used = new Uint8Array(paths.length), ordered: Point[][] = []
  let pen = { x: 12, y: 12 }
  for (let step = 0; step < paths.length; step++) {
    let best = -1, reverse = false, nearest = Infinity
    for (let i = 0; i < paths.length; i++) if (!used[i]) {
      const path = paths[i], first = distance(pen, path[0]), last = distance(pen, path[path.length - 1])
      if (Math.min(first, last) < nearest) { nearest = Math.min(first, last); best = i; reverse = last < first }
    }
    used[best] = 1
    let path = reverse ? paths[best].slice().reverse() : paths[best]
    if (distance(path[0], path[path.length - 1]) < .001) {
      let closest = 0
      for (let i = 1; i < path.length - 1; i++) if (distance(pen, path[i]) < distance(pen, path[closest])) closest = i
      if (closest) path = [...path.slice(closest, -1), ...path.slice(0, closest + 1)]
    }
    if (ordered.length && canConnect?.(pen, path[0])) ordered[ordered.length - 1].push(...path)
    else ordered.push(path)
    pen = path[path.length - 1]
  }
  return ordered
}

export async function prepareImage(input: Buffer) {
  const image = sharp(input, { limitInputPixels: 24_000_000 }).rotate().flatten({ background: 'white' })
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height) throw new Error('Imagem sem dimensões.')
  const resizeScale = Math.min(2, 2400 / Math.max(metadata.width, metadata.height))
  // Supersampling makes sub-pixel strokes measurable; keep every white margin.
  const { data, info } = await image.resize({ width: Math.round(metadata.width * resizeScale), height: Math.round(metadata.height * resizeScale), fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true })
  return { gray: data, width: info.width, height: info.height }
}

export async function buildInkPlan(input: Awaited<ReturnType<typeof prepareImage>>, settings: PlotSettings = DEFAULT_SETTINGS, threshold = 160): Promise<DrawingPlan> {
  const { gray, width: imageWidth, height: imageHeight } = input
  const width = imageWidth + 4, height = imageHeight + 4
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < imageHeight; y++) for (let x = 0; x < imageWidth; x++) mask[(y + 2) * width + x + 2] = gray[y * imageWidth + x] < threshold ? 1 : 0
  let black = 0
  for (const value of mask) black += value
  if (black > imageWidth * imageHeight * .65) throw new Error('A imagem contém preto demais para este modo de retrato. Use um desenho de linhas sobre fundo branco.')
  const placement = imagePlacement(imageWidth, imageHeight)
  const radius = settings.penWidthMm / placement.scale / 2
  const field = distanceField(mask, width, height)
  const skeleton = await thinMask(mask, width, height)
  const rawPaths = traceSkeleton(skeleton, width, height)
  await setImmediate()

  // Follow inset contours for areas wider than the nib. White holes have their
  // own contours and remain empty. Start half a nib inside the black boundary.
  const contour = contours().size([width, height]).smooth(true)
  let maximum = 0
  for (const value of field) maximum = Math.max(maximum, value)
  for (let inset = radius; inset < maximum; inset += radius * 1.5) {
    for (const polygon of contour.contour(field as unknown as number[], inset).coordinates) for (const ring of polygon) {
      const path = ring.map(([x, y]) => ({ x, y }))
      if (pathLength(path) * placement.scale >= settings.penWidthMm * 1.5) rawPaths.push(path)
    }
    await setImmediate()
  }
  const selectedPaths = removeCoveredPaths(rawPaths.map(smoothPath), mask, width, height, radius)
  if (selectedPaths.length > 30_000) throw new Error('O desenho excede o limite de complexidade. Use uma imagem com menos textura ou uma caneta mais larga.')
  const paths = selectedPaths.map((path) => simplifyPath(path.map(({ x, y }) => ({
    x: Math.max(12, Math.min(198, placement.x + (x - 2) * placement.scale)),
    y: Math.max(12, Math.min(285, placement.y + (y - 2) * placement.scale)),
  })), Math.min(.025, settings.penWidthMm / 8))).filter((path) => path.length > 1 && pathLength(path) > .0005)
  const canConnect = (a: Point, b: Point) => {
    const length = distance(a, b)
    if (length > settings.penWidthMm * 3) return false
    const steps = Math.max(1, Math.ceil(length / placement.scale * 2))
    for (let i = 0; i <= steps; i++) {
      const x = Math.floor((a.x + (b.x - a.x) * i / steps - placement.x) / placement.scale + 2)
      const y = Math.floor((a.y + (b.y - a.y) * i / steps - placement.y) / placement.scale + 2)
      if (x < 0 || y < 0 || x >= width || y >= height || field[y * width + x] < radius + .25) return false
    }
    return true
  }
  return planFromPaths(orderPaths(paths, canConnect), settings)
}

export async function evaluatePlan(input: Awaited<ReturnType<typeof prepareImage>>, plan: DrawingPlan) {
  const { width, height, gray } = input, placement = imagePlacement(width, height)
  const paths = plan.strokes.map(({ points }) => `<polyline points="${points.map((p) => `${((p.x - placement.x) / placement.scale).toFixed(3)},${((p.y - placement.y) / placement.scale).toFixed(3)}`).join(' ')}"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g fill="none" stroke="black" stroke-width="${plan.penWidthMm / placement.scale}" stroke-linejoin="round" stroke-linecap="round">${paths}</g></svg>`
  const raster = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer()
  let target = 0, drawn = 0, intersection = 0
  const cellSize = 64, columns = Math.ceil(width / cellSize), rows = Math.ceil(height / cellSize)
  const tiles = Array.from({ length: columns * rows }, () => ({ target: 0, drawn: 0, intersection: 0 }))
  for (let i = 0; i < gray.length; i++) {
    const a = (255 - gray[i]) / 255, b = (255 - raster[i]) / 255
    target += a; drawn += b; intersection += Math.min(a, b)
    const cell = tiles[Math.floor(Math.floor(i / width) / cellSize) * columns + Math.floor(i % width / cellSize)]
    cell.target += a; cell.drawn += b; cell.intersection += Math.min(a, b)
  }
  const detailTiles = tiles.filter((t) => t.target > cellSize * cellSize * .015)
  const detailF1 = detailTiles.length ? detailTiles.reduce((sum, t) => sum + 2 * t.intersection / (t.target + t.drawn), 0) / detailTiles.length : 1
  return { inkF1: target + drawn ? 2 * intersection / (target + drawn) : 1, detailF1, precision: drawn ? intersection / drawn : 1, recall: target ? intersection / target : 1 }
}

export async function createInkPlan(image: Buffer, settings: PlotSettings = DEFAULT_SETTINGS) {
  const input = await prepareImage(image)
  let best: DrawingPlan | null = null
  for (const threshold of [128, 170, 210]) {
    const plan = await buildInkPlan(input, settings, threshold)
    plan.quality = { ...await evaluatePlan(input, plan), threshold }
    if (!best || plan.quality.inkF1 + plan.quality.detailF1 > best.quality!.inkF1 + best.quality!.detailF1) best = plan
  }
  if (!best?.strokes.length) throw new Error('A imagem não contém traços desenháveis.')
  return best
}
