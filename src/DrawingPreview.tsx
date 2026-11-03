import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, PAPER, distance, planFromGcode, type DrawingPlan, type PlotQuality, type PlotSettings } from './plotter'
export type { DrawingPlan, Point, Stroke } from './plotter'

export async function createDrawingPlanFromGcode(gcode: string, settings: PlotSettings = DEFAULT_SETTINGS, quality?: PlotQuality): Promise<DrawingPlan> {
  return { ...planFromGcode(gcode, settings), quality }
}

type Cursor = { stroke: number; segment: number; fraction: number; drawn: number }
export function DrawingPreview({ plan, progress }: { plan: DrawingPlan | null; progress: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const cursor = useRef<Cursor>({ stroke: 0, segment: 1, fraction: 0, drawn: 0 })
  const [sizeVersion, setSizeVersion] = useState(0)
  useEffect(() => {
    if (!canvas.current) return
    const observer = new ResizeObserver(() => setSizeVersion((n) => n + 1))
    observer.observe(canvas.current)
    return () => observer.disconnect()
  }, [])
  const reset = () => {
    const element = canvas.current, ctx = element?.getContext('2d')
    if (!element || !ctx) return
    const ratio = window.devicePixelRatio || 1
    element.width = Math.max(1, Math.round(element.clientWidth * ratio))
    element.height = Math.max(1, Math.round(element.clientHeight * ratio))
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, element.width, element.height)
    ctx.setTransform(element.width / PAPER.width, 0, 0, element.height / PAPER.height, 0, 0)
    ctx.strokeStyle = 'black'; ctx.lineWidth = plan?.penWidthMm ?? DEFAULT_SETTINGS.penWidthMm
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    cursor.current = { stroke: 0, segment: 1, fraction: 0, drawn: 0 }
  }
  useEffect(reset, [plan, sizeVersion])
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!plan || !ctx) return
    const target = plan.stats.drawingMm * Math.max(0, Math.min(100, progress)) / 100
    if (target < cursor.current.drawn) reset()
    const c = cursor.current
    while (c.stroke < plan.strokes.length && c.drawn < target) {
      const points = plan.strokes[c.stroke].points
      if (c.segment >= points.length) { c.stroke++; c.segment = 1; c.fraction = 0; continue }
      const a = points[c.segment - 1], b = points[c.segment], length = distance(a, b)
      if (!length) { c.segment++; c.fraction = 0; continue }
      const remaining = length * (1 - c.fraction), amount = Math.min(remaining, target - c.drawn)
      const end = c.fraction + amount / length
      ctx.beginPath(); ctx.moveTo(a.x + (b.x - a.x) * c.fraction, a.y + (b.y - a.y) * c.fraction)
      ctx.lineTo(a.x + (b.x - a.x) * end, a.y + (b.y - a.y) * end); ctx.stroke()
      c.drawn += amount
      if (amount >= remaining - 1e-8) { c.segment++; c.fraction = 0 } else c.fraction = end
    }
  }, [plan, progress, sizeVersion])
  return <div className="gcode-preview" aria-label={`Simulação do G-code, ${Math.round(progress)}% concluída`}>
    {!plan && <span className="preview-processing"><span className="spinner"/> Preparando trajetos…</span>}
    <canvas ref={canvas} aria-label="Trajetos da caneta sobre papel A4"/>
  </div>
}
