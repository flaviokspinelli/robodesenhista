// All plot geometry is in millimetres on the sheet, with Y down for display.
export type Point = { x: number; y: number }
export type Stroke = { points: Point[]; length: number }
export type PlotSettings = { penWidthMm: number; feedrate: number; travelFeedrate: number; servoDelayMs: number }
export type PlotQuality = { inkF1: number; detailF1: number; precision: number; recall: number; threshold: number }
export type DrawingPlan = {
  strokes: Stroke[]; svg: string; gcode: string; penWidthMm: number
  stats: { paths: number; drawingMm: number; travelMm: number; estimatedSeconds: number }
  quality?: PlotQuality
}
export const PAPER = { width: 210, height: 297, margin: 12 }
export const DEFAULT_SETTINGS: PlotSettings = { penWidthMm: .3, feedrate: 1200, travelFeedrate: 3000, servoDelayMs: 180 }
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
export const pathLength = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0)

export function imagePlacement(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Dimensões inválidas.')
  const scale = Math.min((PAPER.width - PAPER.margin * 2) / width, (PAPER.height - PAPER.margin * 2) / height)
  return { scale, x: (PAPER.width - width * scale) / 2, y: (PAPER.height - height * scale) / 2 }
}

// Iterative RDP, measuring to the segment (not an infinite line). The tolerance
// is physical and independent of the UI's screen resolution.
export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    const a = points[first], b = points[last], dx = b.x - a.x, dy = b.y - a.y
    const denominator = dx * dx + dy * dy
    let greatest = tolerance * tolerance, selected = -1
    for (let i = first + 1; i < last; i++) {
      const p = points[i]
      const t = denominator ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator)) : 0
      const error = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2
      if (error > greatest) { greatest = error; selected = i }
    }
    if (selected >= 0) { keep[selected] = 1; stack.push([first, selected], [selected, last]) }
  }
  return points.filter((_, i) => keep[i])
}

export function buildSvg(strokes: Stroke[], penWidthMm: number) {
  const paths = strokes.map(({ points }) => `<polyline points="${points.map(({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ')}"/>`).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm"><rect width="210" height="297" fill="white"/><g fill="none" stroke="black" stroke-width="${penWidthMm}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
}

// This parser deliberately accepts only the linear, absolute, metric pen profile
// emitted by this application. Never silently preview unsupported motion.
export function parseGcode(gcode: string): Stroke[] {
  let x = 0, y = 0, penDown = false
  let path: Point[] = []
  const strokes: Stroke[] = []
  const finish = () => {
    const length = pathLength(path)
    if (path.length > 1 && length > 0) strokes.push({ points: path, length })
    path = []
  }
  for (const raw of gcode.split('\n')) {
    const line = raw.split(';')[0].replace(/\([^)]*\)/g, '').trim().toUpperCase()
    if (!line) continue
    const words = [...line.matchAll(/([A-Z])\s*([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:E[-+]?\d+)?)/g)]
    if (!words.length) throw new Error('Comando G-code inválido.')
    if (line.replace(/([A-Z])\s*([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:E[-+]?\d+)?)/g, '').trim()) throw new Error('Palavra G-code inválida.')
    if (new Set(words.map((m) => m[1])).size !== words.length) throw new Error('Palavras repetidas no G-code.')
    const values = Object.fromEntries(words.map((m) => [m[1], Number(m[2])]))
    if (words.some((m) => !['G', 'M', 'X', 'Y', 'F', 'S', 'P', 'Z'].includes(m[1]))) throw new Error('Comando G-code não configurado.')
    if (words.some((m) => !Number.isFinite(Number(m[2])))) throw new Error('Coordenada inválida.')
    if ('M' in values) {
      if (values.M === 3 && (values.S === 0 || values.S === 90)) {
        if (values.S === 90) { finish(); penDown = false }
        else if (!penDown) { penDown = true; path = [{ x, y: PAPER.height - y }] }
      } else if (values.M === 2) { finish(); penDown = false }
      else throw new Error(`Comando M${values.M} não suportado na simulação.`)
    }
    if (!('G' in values)) continue
    if ([21, 90, 4].includes(values.G)) continue
    if (values.G !== 0 && values.G !== 1) throw new Error(`Comando G${values.G} não suportado na simulação.`)
    if (values.G === 0 && penDown) throw new Error('Movimento rápido com a caneta abaixada.')
    if ('Z' in values) throw new Error('Movimento Z não configurado para este perfil de caneta.')
    x = values.X ?? x; y = values.Y ?? y
    if (x < 0 || y < 0 || x > PAPER.width || y > PAPER.height) throw new Error('Trajeto fora do papel A4.')
    if (penDown && values.G === 1) path.push({ x, y: PAPER.height - y })
  }
  finish()
  return strokes
}

export function planFromGcode(gcode: string, settings: PlotSettings = DEFAULT_SETTINGS): DrawingPlan {
  const strokes = parseGcode(gcode)
  let travelMm = 0, previous = { x: 0, y: PAPER.height }
  for (const stroke of strokes) { travelMm += distance(previous, stroke.points[0]); previous = stroke.points[stroke.points.length - 1] }
  travelMm += distance(previous, { x: 0, y: PAPER.height })
  const drawingMm = strokes.reduce((sum, s) => sum + s.length, 0)
  return { strokes, svg: buildSvg(strokes, settings.penWidthMm), gcode, penWidthMm: settings.penWidthMm,
    stats: { paths: strokes.length, drawingMm, travelMm, estimatedSeconds: drawingMm / settings.feedrate * 60 + travelMm / settings.travelFeedrate * 60 + strokes.length * settings.servoDelayMs * 2 / 1000 } }
}

export function planFromPaths(paths: Point[][], settings: PlotSettings): DrawingPlan {
  const lines = ['; TRACO - physical pen toolpaths v2', `; pen_width_mm=${settings.penWidthMm}`, 'G21', 'G90', 'M3 S90', `G4 P${settings.servoDelayMs / 1000}`]
  const xy = (p: Point) => `X${p.x.toFixed(3)} Y${(PAPER.height - p.y).toFixed(3)}`
  for (const points of paths) {
    if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < PAPER.margin - .01 || p.x > PAPER.width - PAPER.margin + .01 || p.y < PAPER.margin - .01 || p.y > PAPER.height - PAPER.margin + .01)) throw new Error('Trajeto inválido ou fora da área útil.')
    if (points.length < 2 || !pathLength(points)) continue
    lines.push(`G0 ${xy(points[0])} F${settings.travelFeedrate}`, 'M3 S0', `G4 P${settings.servoDelayMs / 1000}`)
    for (const p of points.slice(1)) lines.push(`G1 ${xy(p)} F${settings.feedrate}`)
    lines.push('M3 S90', `G4 P${settings.servoDelayMs / 1000}`)
  }
  lines.push(`G0 X0 Y0 F${settings.travelFeedrate}`, 'M2')
  // SVG, animation and downloadable program all originate from decoded G-code.
  return planFromGcode(`${lines.join('\n')}\n`, settings)
}
