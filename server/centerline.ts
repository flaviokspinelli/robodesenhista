import sharp from 'sharp'

export type VectorPoint = { x: number; y: number }
export type CenterlineVector = { width: number; height: number; paths: VectorPoint[][] }

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1], [1, 0],
  [1, 1], [0, 1], [-1, 1], [-1, 0],
] as const

function skeletonize(source: Uint8Array, width: number, height: number) {
  const pixels = source.slice()
  const at = (x: number, y: number) => pixels[y * width + x]

  for (let pass = 0; pass < 30; pass += 1) {
    let changed = false
    for (const secondPass of [false, true]) {
      const remove: number[] = []
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x
          if (!pixels[index]) continue
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1)
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1)
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          const count = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          const transitions = ring.slice(0, 8).reduce((sum, value, ringIndex) => sum + (value === 0 && ring[ringIndex + 1] === 1 ? 1 : 0), 0)
          if (count < 2 || count > 6 || transitions !== 1) continue
          const firstCheck = secondPass ? p2 * p4 * p8 : p2 * p4 * p6
          const secondCheck = secondPass ? p2 * p6 * p8 : p4 * p6 * p8
          if (firstCheck === 0 && secondCheck === 0) remove.push(index)
        }
      }
      if (remove.length) changed = true
      remove.forEach((index) => { pixels[index] = 0 })
    }
    if (!changed) break
  }
  return pixels
}

function traceSkeleton(pixels: Uint8Array, width: number, height: number) {
  const point = (index: number): VectorPoint => ({ x: index % width, y: Math.floor(index / width) })
  const active: number[] = []
  for (let index = 0; index < pixels.length; index += 1) if (pixels[index]) active.push(index)

  const adjacent = (index: number) => {
    const x = index % width
    const y = Math.floor(index / width)
    return NEIGHBORS.flatMap(([dx, dy]) => {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return []
      const neighbor = ny * width + nx
      if (!pixels[neighbor]) return []
      // Evita criar três ligações em um simples canto diagonal.
      if (dx && dy && (pixels[y * width + nx] || pixels[ny * width + x])) return []
      return [neighbor]
    })
  }

  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`
  const visited = new Set<string>()
  const degrees = new Map(active.map((index) => [index, adjacent(index).length]))
  const paths: VectorPoint[][] = []

  const walk = (start: number, next: number) => {
    const result = [point(start)]
    let previous = start
    let current = next
    visited.add(edgeKey(previous, current))
    while (true) {
      result.push(point(current))
      if ((degrees.get(current) ?? 0) !== 2) break
      const candidate = adjacent(current).find((neighbor) => neighbor !== previous && !visited.has(edgeKey(current, neighbor)))
      if (candidate === undefined) break
      previous = current
      current = candidate
      visited.add(edgeKey(previous, current))
    }
    return result
  }

  const starts = [...active.filter((index) => degrees.get(index) !== 2), ...active.filter((index) => degrees.get(index) === 2)]
  starts.forEach((start) => adjacent(start).forEach((next) => {
    if (!visited.has(edgeKey(start, next))) paths.push(walk(start, next))
  }))

  return paths.flatMap((path) => {
    if (path.length < 3) return []
    const reduced = [path[0]]
    for (let index = 1; index < path.length - 1; index += 1) {
      const last = reduced[reduced.length - 1]
      if (Math.hypot(path[index].x - last.x, path[index].y - last.y) >= 1.5) reduced.push(path[index])
    }
    reduced.push(path[path.length - 1])
    const length = reduced.slice(1).reduce((sum, value, index) => sum + Math.hypot(value.x - reduced[index].x, value.y - reduced[index].y), 0)
    return length >= 3 ? [reduced] : []
  })
}

export async function centerlineVectorize(imageBuffer: Buffer): Promise<CenterlineVector> {
  const { data, info } = await sharp(imageBuffer)
    .resize({ width: 800, withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const binary = new Uint8Array(data.length)
  for (let index = 0; index < data.length; index += 1) binary[index] = data[index] < 238 ? 1 : 0
  return { width: info.width, height: info.height, paths: traceSkeleton(skeletonize(binary, info.width, info.height), info.width, info.height) }
}
