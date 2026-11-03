import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createInkPlan } from './server/ink-paths.ts'
import { DEFAULT_SETTINGS, type PlotSettings } from './src/plotter.ts'

function plotSettings(input: unknown): PlotSettings {
  const penWidthMm = (input as { penWidthMm?: unknown } | undefined)?.penWidthMm ?? DEFAULT_SETTINGS.penWidthMm
  if (typeof penWidthMm !== 'number' || ![.15, .2, .3, .4, .5].includes(penWidthMm)) throw new Error('Selecione uma espessura de caneta válida.')
  return { ...DEFAULT_SETTINGS, penWidthMm }
}

const stylePrompts: Record<string, { name: string; direction: string; exclusions: string }> = {
  realista: {
    name: 'REALISTIC CONTOUR PORTRAIT',
    direction: 'Use natural human proportions, accurate face geometry, subtle line-weight variation and an elegant observational portrait style. The result must look recognizably realistic and refined.',
    exclusions: 'No exaggerated features, no anime or manga conventions, no childish cartoon proportions.',
  },
  caricatura: {
    name: 'EXPRESSIVE EVENT CARICATURE',
    direction: 'Create an unmistakable live-event caricature. Enlarge the most distinctive facial features by roughly 25 percent, use a slightly oversized head, amplify the smile and expression, and keep the result friendly, energetic and recognizable.',
    exclusions: 'Do not use realistic portrait proportions. No anime eyes, no manga styling, no children-book styling.',
  },
  anime: {
    name: 'JAPANESE ANIME AND MANGA PORTRAIT',
    direction: 'Make the result unmistakably anime: larger expressive eyes with clean upper lash lines, a simplified angular nose and mouth, tapered ink lines, and hair organized into graphic manga-like locks. Preserve recognizable identity through face shape, hairstyle, eyebrows, glasses and expression.',
    exclusions: 'No photorealism, no Western caricature, no painterly rendering, no children-book doodle style.',
  },
  infantil: {
    name: 'PLAYFUL CHILDREN’S BOOK DOODLE',
    direction: 'Use soft rounded shapes, a gently oversized head, simple friendly facial features, playful imperfect pen lines and very few details. The result should feel warm, innocent and hand-drawn for a children’s picture book.',
    exclusions: 'No realistic rendering, no anime or manga conventions, no sharp caricature exaggeration, no sophisticated fashion illustration.',
  },
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

async function vectorizeDrawing(imageBuffer: Buffer, settings: PlotSettings) {
  const plan = await createInkPlan(imageBuffer, settings)
  return { plot: { gcode: plan.gcode, settings, quality: plan.quality } }
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 16 * 1024 * 1024) throw new Error('A foto é grande demais.')
    chunks.push(buffer)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!body || typeof body !== 'object' || typeof body.photo !== 'string') throw new Error('Imagem ausente ou inválida.')
  return body as { photo: string; style?: string; settings?: unknown }
}

function openAiDrawing(apiKey: string | undefined): Plugin {
  let busy = false
  const middleware = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const isGeneration = request.url === '/api/generate-drawing' && request.method === 'POST'
    const isVectorization = request.url === '/api/vectorize-drawing' && request.method === 'POST'
    if (!isGeneration && !isVectorization) return next()
    if (busy) return sendJson(response, 429, { error: 'Um desenho está sendo preparado. Aguarde a conclusão.' })

    if (isVectorization) {
      try {
        busy = true
        const { photo, settings } = await readJson(request)
        const match = photo?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
        if (!match) return sendJson(response, 400, { error: 'A imagem enviada não é válida.' })
        return sendJson(response, 200, await vectorizeDrawing(Buffer.from(match[2], 'base64'), plotSettings(settings)))
      } catch (error) {
        console.error('Falha ao vetorizar/converter desenho:', error)
        return sendJson(response, 500, { error: error instanceof Error ? error.message : 'Erro ao vetorizar o desenho.' })
      } finally { busy = false }
    }

    if (!apiKey) return sendJson(response, 503, { error: 'Configure OPENAI_API_KEY no arquivo .env.local e reinicie o servidor.' })

    try {
      busy = true
      const { photo, style = 'caricatura', settings } = await readJson(request)
      const settingsForPlot = plotSettings(settings)
      const styleKey = Object.hasOwn(stylePrompts, style) ? style : 'caricatura'
      const stylePrompt = stylePrompts[styleKey]
      const match = photo?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
      if (!match) return sendJson(response, 400, { error: 'A foto enviada não é válida.' })
      const styleReference = await readFile(resolve(process.cwd(), `public/assets/style-${styleKey}.png`))

      const form = new FormData()
      form.append('model', 'gpt-image-2.5-sunburst')
      form.append('image[]', new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), `pessoa.${match[1].split('/')[1]}`)
      form.append('image[]', new Blob([styleReference], { type: 'image/png' }), `referencia-${styleKey}.png`)
      form.append('prompt', `TASK
Create a black-ink portrait for a physical pen-drawing robot by combining the two reference images according to their separate roles.

REFERENCE IMAGE ROLES
Image 1 is the SUBJECT reference. Use it for the person's identity, face, hairstyle, pose, expression, gaze, clothing and accessories.
Image 2 is the STYLE reference. Use it only for artistic language: line quality, feature stylization, proportions, level of simplification and overall drawing character. Do not copy the identity, face, hairstyle, pose, clothing or accessories of the person shown in Image 2.

MANDATORY VISUAL STYLE — ${stylePrompt.name}
${stylePrompt.direction}
${stylePrompt.exclusions}

IDENTITY TO PRESERVE
Keep the person recognizable. Preserve the hairstyle, face shape, eyebrows, glasses or accessories, expression, gaze and head angle, except for the deliberate stylization required above.

COMPOSITION
Head-and-shoulders portrait, centered vertically on portrait A4 paper, with comfortable white margins and a pure white background.

PEN-PLOTTER CONSTRAINTS
Use only clean, continuous, thin black pen lines. Use a moderate number of intentional strokes so a physical XY robot can draw it quickly at an event. Leave open white space between important facial features.

EXCLUSIONS
No gray, color, shading, hatching, gradients, filled black areas, text, signature, border, background objects or decorative frame. Do not blend the requested style with any of the excluded styles.`)
      form.append('size', '1024x1536')
      form.append('quality', 'medium')
      form.append('output_format', 'png')
      form.append('background', 'opaque')

      const openAiResponse = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form })
      const result = await openAiResponse.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } }
      if (!openAiResponse.ok) {
        console.error('Falha no provedor de imagem:', result.error?.message ?? openAiResponse.statusText)
        return sendJson(response, openAiResponse.status, { error: 'Não foi possível criar o desenho agora. Tente novamente.' })
      }
      const image = result.data?.[0]?.b64_json
      if (!image) return sendJson(response, 502, { error: 'Não foi possível finalizar o desenho. Tente novamente.' })
      const resultForPlot = await vectorizeDrawing(Buffer.from(image, 'base64'), settingsForPlot)
      return sendJson(response, 200, { image: `data:image/png;base64,${image}`, ...resultForPlot })
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : 'Erro inesperado ao gerar o desenho.' })
    } finally { busy = false }
  }

  return {
    name: 'traco-openai-drawing',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), openAiDrawing(environment.OPENAI_API_KEY || process.env.OPENAI_API_KEY)],
  }
})
