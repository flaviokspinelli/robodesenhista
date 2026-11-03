import { ChangeEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createDrawingPlanFromGcode, DrawingPreview, type DrawingPlan } from './DrawingPreview'
import { DEFAULT_SETTINGS, type PlotQuality, type PlotSettings } from './plotter'

type Screen = 'inicio' | 'estilo' | 'camera' | 'confirmar' | 'previa' | 'desenhando' | 'pronto' | 'compartilhar'
type StyleId = 'realista' | 'caricatura' | 'anime' | 'infantil'
type CameraStatus = 'idle' | 'starting' | 'ready' | 'error'
type GenerationStatus = 'idle' | 'generating' | 'vectorizing' | 'ready' | 'error'
type ConversionResult = { image?: string; plot?: { gcode: string; settings: PlotSettings; quality: PlotQuality }; error?: string }

const A4_RATIO = 210 / 297
const A4_CAPTURE_WIDTH = 1400
const A4_CAPTURE_HEIGHT = 1980
const IDLE_TIMEOUT_MS = 60_000
const IDLE_WARNING_SECONDS = 15

function renderA4(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, mirror = false) {
  const sourceRatio = sourceWidth / sourceHeight
  let cropX = 0
  let cropY = 0
  let cropWidth = sourceWidth
  let cropHeight = sourceHeight

  if (sourceRatio > A4_RATIO) {
    cropWidth = sourceHeight * A4_RATIO
    cropX = (sourceWidth - cropWidth) / 2
  } else {
    cropHeight = sourceWidth / A4_RATIO
    cropY = (sourceHeight - cropHeight) / 2
  }

  const canvas = document.createElement('canvas')
  canvas.width = A4_CAPTURE_WIDTH
  canvas.height = A4_CAPTURE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) return null
  if (mirror) { context.translate(canvas.width, 0); context.scale(-1, 1) }
  context.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', .92)
}

async function imageSourceToDataUrl(source: string) {
  if (source.startsWith('data:')) return source
  const blob = await fetch(source).then((response) => response.blob())
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a foto.'))
    reader.onerror = () => reject(new Error('Não foi possível ler a foto.'))
    reader.readAsDataURL(blob)
  })
}

const screens: Screen[] = ['inicio', 'estilo', 'camera', 'confirmar', 'previa', 'desenhando', 'pronto', 'compartilhar']
const steps: Record<Screen, number> = { inicio: 0, estilo: 1, camera: 2, confirmar: 2, previa: 3, desenhando: 4, pronto: 4, compartilhar: 4 }
const styles: Array<{ id: StyleId; label: string; description: string; image: string; accent: string }> = [
  { id: 'realista', label: 'Realista', description: 'Traços leves e elegantes', image: '/assets/style-realista.png', accent: '#1374ff' },
  { id: 'caricatura', label: 'Caricatura', description: 'Divertida e expressiva', image: '/assets/style-caricatura.png', accent: '#ff6157' },
  { id: 'anime', label: 'Anime', description: 'Olhar marcante e moderno', image: '/assets/style-anime.png', accent: '#8b5cf6' },
  { id: 'infantil', label: 'Infantil', description: 'Fofa, simples e colorida', image: '/assets/style-infantil.png', accent: '#00b77a' },
]

const staticAssets = [
  '/robot-welcome.png',
  '/robot-mascot.png',
  '/assets/sample-photo.png',
  '/assets/sample-drawing.png',
  ...styles.map((style) => style.image),
]

function initialScreen(): Screen {
  const requested = new URLSearchParams(window.location.search).get('screen') as Screen | null
  return requested && screens.includes(requested) ? requested : 'inicio'
}

function Icon({ name, size = 24 }: { name: 'arrow' | 'camera' | 'upload' | 'refresh' | 'check' | 'download' | 'sparkle' | 'share' | 'back'; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    camera: <><path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3.5"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 14v5h14v-5"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.4-2L20 12M4 12l2.5 5a7 7 0 0 0 11.4-2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    download: <><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></>,
    sparkle: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"/></>,
    share: <><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/></>,
    back: <><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function Logo() { return <div className="logo" aria-label="Traço"><span>TRAÇO</span><i aria-hidden="true" /></div> }

function Progress({ screen }: { screen: Screen }) {
  const current = steps[screen]
  if (!current) return <span className="event-badge"><span /> Experiência ao vivo</span>
  return <ol className="steps" aria-label={`Etapa ${current} de 4`}>{[1, 2, 3, 4].map((step) => <li className={step <= current ? 'active' : ''} key={step}>{step}</li>)}</ol>
}

function Header({ screen, onHome }: { screen: Screen; onHome: () => void }) {
  return <header className="app-header"><button className="logo-button" type="button" onClick={onHome} aria-label="Voltar ao início"><Logo /></button><Progress screen={screen} /></header>
}

function Panel({ eyebrow, title, text, children, className = '' }: { eyebrow: string; title: ReactNode; text?: string; children: ReactNode; className?: string }) {
  return <section className={`content-panel ${className}`}><div className="panel-copy"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{text && <p>{text}</p>}</div>{children}</section>
}

function RobotBuddy({ message }: { message: string }) {
  return <aside className="robot-buddy" aria-label={`Robô diz: ${message}`}><div className="speech-bubble">{message}</div><img src="/robot-mascot.png" alt="Robô Traço segurando lápis" /></aside>
}

function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [selectedStyle, setSelectedStyle] = useState<StyleId>('caricatura')
  const [photo, setPhoto] = useState<string | null>(null)
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle')
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [drawingProgress, setDrawingProgress] = useState(0)
  const [simulationPaused, setSimulationPaused] = useState(false)
  const [penWidthMm, setPenWidthMm] = useState(DEFAULT_SETTINGS.penWidthMm)
  const operationId = useRef(0)
  const [generatedDrawing, setGeneratedDrawing] = useState<string | null>(null)
  const [drawingPlan, setDrawingPlan] = useState<DrawingPlan | null>(null)
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle')
  const [generationError, setGenerationError] = useState('')
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null)
  const [idleTimerVersion, setIdleTimerVersion] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const resetExperience = useCallback(() => {
    operationId.current++
    setScreen('inicio')
    setPhoto(null)
    setSelectedStyle('caricatura')
    setCameraFacing('user')
    setCameraStatus('idle')
    setCountdown(null)
    setDrawingProgress(0)
    setGeneratedDrawing(null)
    setDrawingPlan(null)
    setGenerationStatus('idle')
    setGenerationError('')
    setIdleCountdown(null)
  }, [])

  useEffect(() => {
    staticAssets.forEach((source) => {
      const image = new Image()
      image.src = source
      void image.decode().catch(() => undefined)
    })
  }, [])

  const stopCamera = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null }

  useEffect(() => {
    if (screen !== 'camera') { stopCamera(); return }
    let cancelled = false
    const start = async () => {
      stopCamera(); setCameraStatus('starting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
        setCameraStatus('ready')
      } catch { if (!cancelled) setCameraStatus('error') }
    }
    void start()
    return () => { cancelled = true; stopCamera() }
  }, [screen, cameraFacing])

  useEffect(() => {
    if (screen !== 'desenhando' || simulationPaused) return
    const timer = window.setInterval(() => setDrawingProgress((value) => Math.min(value + .5, 100)), 150)
    return () => window.clearInterval(timer)
  }, [screen, simulationPaused])

  useEffect(() => {
    if (screen !== 'pronto' && screen !== 'compartilhar') {
      setIdleCountdown(null)
      return
    }

    let idleTimer = 0
    let countdownTimer = 0

    const clearTimers = () => {
      window.clearTimeout(idleTimer)
      window.clearInterval(countdownTimer)
    }

    const beginWarning = () => {
      let remaining = IDLE_WARNING_SECONDS
      setIdleCountdown(remaining)
      countdownTimer = window.setInterval(() => {
        remaining -= 1
        if (remaining <= 0) {
          clearTimers()
          resetExperience()
          return
        }
        setIdleCountdown(remaining)
      }, 1000)
    }

    const restartIdleTimer = () => {
      clearTimers()
      setIdleCountdown(null)
      idleTimer = window.setTimeout(beginWarning, IDLE_TIMEOUT_MS)
    }

    const handleVisibility = () => {
      if (document.hidden) {
        clearTimers()
        setIdleCountdown(null)
      } else {
        restartIdleTimer()
      }
    }

    restartIdleTimer()
    window.addEventListener('pointerdown', restartIdleTimer, { passive: true })
    window.addEventListener('keydown', restartIdleTimer)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearTimers()
      window.removeEventListener('pointerdown', restartIdleTimer)
      window.removeEventListener('keydown', restartIdleTimer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [screen, resetExperience, idleTimerVersion])

  useEffect(() => () => stopCamera(), [])

  const goHome = resetExperience
  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const sourceUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const a4Photo = renderA4(image, image.naturalWidth, image.naturalHeight)
      URL.revokeObjectURL(sourceUrl)
      if (a4Photo) { setPhoto(a4Photo); setScreen('confirmar') }
    }
    image.onerror = () => URL.revokeObjectURL(sourceUrl)
    image.src = sourceUrl
  }
  const takePhoto = async () => {
    if (cameraStatus !== 'ready' || countdown !== null) return
    for (const value of [3, 2, 1]) { setCountdown(value); await new Promise((resolve) => window.setTimeout(resolve, 650)) }
    const video = videoRef.current
    if (!video?.videoWidth) { setCountdown(null); return }
    const a4Photo = renderA4(video, video.videoWidth, video.videoHeight, cameraFacing === 'user')
    if (a4Photo) { setPhoto(a4Photo); setScreen('confirmar') }
    setCountdown(null)
  }
  const startGeneration = async () => {
    const operation = ++operationId.current
    setScreen('previa')
    setGenerationStatus('generating')
    setGenerationError('')
    setGeneratedDrawing(null)
    setDrawingPlan(null)
    try {
      const photoData = await imageSourceToDataUrl(photoSource)
      const response = await fetch('/api/generate-drawing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: photoData, style: selectedStyle, settings: { penWidthMm } }),
      })
      const result = await response.json() as ConversionResult
      if (operation !== operationId.current) return
      if (!response.ok || !result.image || !result.plot) throw new Error(result.error ?? 'Não foi possível gerar o desenho.')
      setGeneratedDrawing(result.image)
      setGenerationStatus('vectorizing')
      const plan = await createDrawingPlanFromGcode(result.plot.gcode, result.plot.settings, result.plot.quality)
      if (!plan.strokes.length) throw new Error('O desenho não produziu trajetos válidos. Tente outra foto.')
      setDrawingPlan(plan)
      setGenerationStatus('ready')
    } catch (error) {
      if (operation !== operationId.current) return
      setGenerationStatus('error')
      setGenerationError(error instanceof Error ? error.message : 'Não foi possível gerar o desenho.')
    }
  }
  const revectorizeDrawing = async (source = generatedDrawing, pen = penWidthMm) => {
    if (!source) return
    const operation = ++operationId.current
    setScreen('previa')
    setGeneratedDrawing(source)
    setGenerationStatus('vectorizing')
    setGenerationError('')
    setDrawingPlan(null)
    try {
      const response = await fetch('/api/vectorize-drawing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: await imageSourceToDataUrl(source), settings: { penWidthMm: pen } }),
      })
      const result = await response.json() as ConversionResult
      if (operation !== operationId.current) return
      if (!response.ok || !result.plot) throw new Error(result.error ?? 'Não foi possível vetorizar o desenho.')
      const plan = await createDrawingPlanFromGcode(result.plot.gcode, result.plot.settings, result.plot.quality)
      if (!plan.strokes.length) throw new Error('O desenho não produziu trajetos válidos.')
      setDrawingPlan(plan)
      setGenerationStatus('ready')
    } catch (error) {
      if (operation !== operationId.current) return
      setGenerationStatus('error')
      setGenerationError(error instanceof Error ? error.message : 'Não foi possível vetorizar o desenho.')
    }
  }
  const loadTestPng = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setGenerationStatus('error'); setGenerationError('Use uma imagem de até 10 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') void revectorizeDrawing(reader.result) }
    reader.readAsDataURL(file)
    event.target.value = ''
  }
  const downloadFile = (content: string, filename: string, type: string) => {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([content], { type }))
    link.download = filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }
  const downloadDrawing = () => {
    if (drawingPlan) {
      downloadFile(drawingPlan.svg, 'meu-retrato-traco.svg', 'image/svg+xml')
      return
    }
    const link = document.createElement('a')
    link.href = generatedDrawing ?? '/assets/sample-drawing.png'
    link.download = 'meu-retrato-traco.png'
    link.click()
  }
  const shareDrawing = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'Meu retrato pelo robô Traço', text: 'Olha o retrato que o robô Traço desenhou!' }).catch(() => undefined)
      return
    }
    downloadDrawing()
  }
  const photoSource = photo ?? '/assets/sample-photo.png'
  const drawingSource = drawingPlan
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawingPlan.svg)}`
    : generatedDrawing ?? '/assets/sample-drawing.png'
  const selectedStyleLabel = styles.find((style) => style.id === selectedStyle)?.label ?? 'Retrato'
  const showDevelopmentPreview = import.meta.env.DEV || new URLSearchParams(window.location.search).get('debug') === '1'
  const preparing = generationStatus === 'generating' || generationStatus === 'vectorizing'
  const startSimulation = () => { setDrawingProgress(0); setSimulationPaused(false); setScreen('desenhando') }
  const sourcePaper = (source: string, label: string) => <svg className="source-paper" viewBox="0 0 210 297" role="img" aria-label={label}><rect width="210" height="297" fill="white"/><image href={source} x="12" y="12" width="186" height="273" preserveAspectRatio="xMidYMid meet"/></svg>

  return (
    <main className={`app screen-${screen}`}>
      <div className="ambient-shape ambient-one" aria-hidden="true"/><div className="ambient-shape ambient-two" aria-hidden="true"/>
      <div className="event-shell">
        <Header screen={screen} onHome={goHome}/>

        {screen === 'inicio' && <div className="hero-layout">
          <div className="hero-art" aria-hidden="true"><span className="orbit orbit-one"/><span className="orbit orbit-two"/><img src="/robot-welcome.png" alt=""/><span className="floating-note note-one">✦</span></div>
          <Panel className="hero-panel" eyebrow="Retrato ao vivo em poucos minutos" title={<>Uma foto.<br/><em>Um desenho.</em><br/>Uma lembrança.</>} text="Escolha seu estilo, faça uma pose e veja o Traço transformar você em arte.">
            <div className="hero-actions"><button className="button button-primary button-large" type="button" onClick={() => setScreen('estilo')}>Quero meu retrato <Icon name="arrow" size={30}/></button><div className="trust-row"><span>1</span> escolha <i/> <span>2</span> pose <i/> <span>3</span> desenho</div></div>
          </Panel>
        </div>}

        {screen === 'estilo' && <div className="workflow-layout style-layout">
          <Panel eyebrow="Etapa 1 de 4" title={<>Qual é o seu <em>estilo?</em></>} text="Toque no visual que mais combina com você.">
            <div className="style-grid" role="radiogroup" aria-label="Estilo do retrato">{styles.map((style) => <label className={`style-card ${selectedStyle === style.id ? 'selected' : ''}`} style={{ '--style-accent': style.accent } as React.CSSProperties} key={style.id}><input type="radio" name="style" checked={selectedStyle === style.id} onChange={() => setSelectedStyle(style.id)}/><img src={style.image} alt=""/><span className="style-copy"><strong>{style.label}</strong><small>{style.description}</small></span><span className="style-check"><Icon name="check" size={19}/></span></label>)}</div>
            <div className="action-row"><button className="button button-ghost" type="button" onClick={() => setScreen('inicio')}><Icon name="back"/> Voltar</button><button className="button button-primary" type="button" onClick={() => setScreen('camera')}>Continuar <Icon name="arrow"/></button></div>
          </Panel>
          <RobotBuddy message={`O estilo ${styles.find((style) => style.id === selectedStyle)?.label.toLowerCase()} vai ficar incrível!`}/>
        </div>}

        {screen === 'camera' && <div className="camera-layout">
          <section className="camera-stage" aria-label="Câmera com enquadramento vertical A4"><video className={cameraStatus === 'ready' ? 'visible' : ''} ref={videoRef} muted playsInline/>{cameraStatus !== 'ready' && <div className="camera-message">{cameraStatus === 'error' ? <><Icon name="camera" size={42}/><strong>Câmera indisponível</strong><span>Você ainda pode enviar uma foto.</span></> : <><span className="spinner"/><strong>Abrindo a câmera…</strong></>}</div>}<div className="pose-frame" aria-hidden="true"><i/><i/><i/><i/><b>A4</b></div>{countdown !== null && <div className="countdown">{countdown}</div>}<span className="camera-ready"><i/> {cameraStatus === 'ready' ? 'Enquadramento A4' : 'Aguardando câmera'}</span></section>
          <Panel eyebrow="Etapa 2 de 4" title={<>Faça sua <em>melhor pose!</em></>} text="Tudo que estiver dentro da moldura vertical será desenhado no papel A4.">
            <div className="camera-actions"><label className="button button-ghost upload-control"><Icon name="upload"/> Enviar foto<input type="file" accept="image/*" capture="user" onChange={handlePhoto}/></label><button className="shutter" type="button" onClick={() => void takePhoto()} disabled={cameraStatus !== 'ready'} aria-label="Tirar foto"><Icon name="camera" size={38}/></button><button className="button button-ghost camera-flip" type="button" onClick={() => setCameraFacing((value) => value === 'user' ? 'environment' : 'user')} disabled={cameraStatus !== 'ready'}><Icon name="refresh"/> Virar câmera</button></div>
            <button className="text-button" type="button" onClick={() => setScreen('estilo')}><Icon name="back" size={19}/> Trocar estilo</button>
          </Panel>
        </div>}

        {screen === 'confirmar' && <div className="workflow-layout photo-layout"><figure className="photo-card tilted-left"><img src={photoSource} alt="Foto escolhida"/><figcaption>Sua foto</figcaption></figure><Panel eyebrow="Foto pronta" title={<>Gostou dessa <em>pose?</em></>} text="Se estiver do jeito que você quer, eu já posso começar a criar."><div className="stack-actions"><button className="button button-primary button-large" type="button" onClick={() => void startGeneration()}><Icon name="check"/> Criar meu desenho</button><button className="button button-ghost" type="button" onClick={() => setScreen('camera')}><Icon name="refresh"/> Tirar outra</button></div></Panel></div>}

        {screen === 'previa' && <div className={`preview-layout ${showDevelopmentPreview ? 'development-preview' : ''}`}>
          <div className={`comparison ${showDevelopmentPreview ? 'development-comparison' : ''}`} aria-label="Comparação da foto, PNG e trajetos do G-code na mesma escala">
            <figure><figcaption>Foto</figcaption><img src={photoSource} alt="Foto original"/></figure>
            {showDevelopmentPreview && <figure className="ai-png-card"><figcaption>PNG da IA</figcaption>{generatedDrawing && sourcePaper(generatedDrawing, 'PNG original da IA')}</figure>}
            <figure className="drawing-card">
              <figcaption>{showDevelopmentPreview ? 'Trajetos · G-code' : 'Prévia do desenho'}</figcaption>
              {drawingPlan ? <img src={drawingSource} alt="Simulação da tinta depositada pelo G-code"/> : <div className="generation-placeholder">{preparing && <span className="spinner"/>}<strong>{generationStatus === 'error' ? 'Geração interrompida' : generationStatus === 'idle' ? 'Pronto para comparar' : generationStatus === 'vectorizing' ? 'Ajustando os trajetos…' : 'Criando seu desenho…'}</strong><small>{generationStatus === 'vectorizing' ? 'Comparando a tinta da caneta com o PNG' : generationStatus === 'idle' ? 'Envie um PNG no painel de testes' : ''}</small></div>}
            </figure>
          </div>
          <Panel eyebrow="Etapa 3 de 4" title={generationStatus === 'error' ? <>Algo não <em>funcionou.</em></> : generationStatus === 'ready' ? <>Confira seu <em>desenho!</em></> : preparing ? <>Preparando sua <em>arte…</em></> : <>Teste os <em>traços.</em></>} text={generationStatus === 'error' ? generationError : generationStatus === 'ready' ? 'Esta prévia simula os trajetos do arquivo com a espessura de caneta selecionada.' : 'Os detalhes e as áreas pretas são convertidos em movimentos de caneta.'}>
            <div className="stack-actions">
              {generationStatus === 'ready' && <button className="button button-primary" type="button" onClick={startSimulation}>Ver desenho sendo feito <Icon name="arrow"/></button>}
              {generationStatus === 'error' && <button className="button button-primary" type="button" onClick={() => generatedDrawing ? void revectorizeDrawing() : void startGeneration()}><Icon name="refresh"/> Tentar novamente</button>}
              {showDevelopmentPreview && <div className="technical-downloads">
                <span>Teste de produção · caneta e papel A4</span>
                <label className="pen-setting">Espessura real da caneta
                  <select aria-label="Espessura real da caneta" value={penWidthMm} disabled={preparing} onChange={(event) => { const pen = Number(event.target.value); setPenWidthMm(pen); if (generatedDrawing) void revectorizeDrawing(generatedDrawing, pen) }}>
                    {[.15, .2, .3, .4, .5].map((pen) => <option key={pen} value={pen}>{pen.toLocaleString('pt-BR')} mm</option>)}
                  </select>
                </label>
                <label className="png-upload">Testar PNG existente<input type="file" accept="image/png,image/jpeg,image/webp" disabled={preparing} onChange={(event) => void loadTestPng(event)}/></label>
                <button type="button" disabled={preparing} onClick={() => void revectorizeDrawing('/assets/style-realista.png')}>Testar exemplo local</button>
                {drawingPlan && <>
                  <p className="plot-stats">{drawingPlan.stats.paths.toLocaleString('pt-BR')} trajetos · {(drawingPlan.stats.drawingMm / 1000).toFixed(1)} m de desenho · cerca de {Math.ceil(drawingPlan.stats.estimatedSeconds / 60)} min*</p>
                  <small className="plot-note">*Estimativa a 20 mm/s com pausas da caneta, sem considerar aceleração. A simulação é acelerada. Caneta, servo e firmware precisam de calibração física.</small>
                  <button type="button" onClick={() => void revectorizeDrawing()}>Recalcular PNG</button>
                  <button type="button" onClick={() => downloadFile(drawingPlan.svg, 'retrato-trajetos.svg', 'image/svg+xml')}>Baixar SVG de trajetos</button>
                  <button type="button" onClick={() => downloadFile(drawingPlan.gcode, 'retrato.gcode', 'text/plain')}>Baixar G-code</button>
                </>}
              </div>}
              <button className="button button-ghost" type="button" disabled={preparing} onClick={() => setScreen('estilo')}>Escolher outro estilo</button>
            </div>
          </Panel>
        </div>}

        {screen === 'desenhando' && <div className="drawing-layout">
          <section className="drawing-live"><div className="paper-sheet"><DrawingPreview plan={drawingPlan} progress={drawingProgress}/><span className="trajectory-badge"><i/> Simulação acelerada do G-code</span></div></section>
          <Panel eyebrow="Prévia dos movimentos" title={<>Veja cada <em>traço aparecer.</em></>} text="A ordem e a largura dos traços vêm do mesmo arquivo que você pode baixar.">
            <div className="progress-block"><div><span>Progresso da simulação</span><strong>{Math.round(drawingProgress)}%</strong></div><input aria-label="Progresso da simulação" type="range" min="0" max="100" step=".1" value={drawingProgress} onChange={(event) => { setSimulationPaused(true); setDrawingProgress(Number(event.target.value)) }}/></div>
            <div className="action-row"><button className="button button-primary" type="button" onClick={() => { if (drawingProgress >= 100) setDrawingProgress(0); setSimulationPaused((value) => drawingProgress >= 100 ? false : !value) }}>{drawingProgress >= 100 ? 'Repetir' : simulationPaused ? 'Continuar' : 'Pausar'}</button><button className="button button-ghost" type="button" onClick={() => setScreen('previa')}>Voltar à comparação</button></div>
            <div className="event-tip"><Icon name="sparkle"/><span>Simulação de caneta com {drawingPlan?.penWidthMm.toLocaleString('pt-BR')} mm. Nenhum comando é enviado ao robô nesta tela.</span></div>
          </Panel>
        </div>}

        {screen === 'pronto' && <div className="ready-layout"><div className="final-art"><span className="tape tape-one"/><span className="tape tape-two"/><img src={drawingSource} alt="Retrato finalizado"/></div><Panel eyebrow="Seu retrato está pronto" title={<>Tcharam! Ficou <em>incrível.</em></>} text="O arquivo do desenho está pronto. Você pode guardar a versão digital."><div className="stack-actions"><button className="button button-primary button-large" type="button" onClick={() => setScreen('compartilhar')}><Icon name="share"/> Quero compartilhar</button><button className="button button-ghost" type="button" onClick={downloadDrawing}><Icon name="download"/> Baixar desenho</button><button className="button button-new-session" type="button" onClick={goHome}><Icon name="refresh"/> Fazer outro retrato</button></div></Panel><div className="confetti" aria-hidden="true">✦ <i/> ● <i/> ✦</div></div>}

        {screen === 'compartilhar' && <div className="share-layout"><div className="share-card"><img src={drawingSource} alt="Seu retrato"/><div className="share-stamp"><Logo/><span>feito ao vivo</span></div></div><Panel eyebrow="Leve essa lembrança com você" title={<>Compartilhe seu <em>momento.</em></>} text="Baixe a imagem ou use o compartilhamento do aparelho para enviar e postar nas redes sociais."><div className="action-row share-actions"><button className="button button-ghost" type="button" onClick={downloadDrawing}><Icon name="download"/> Baixar</button><button className="button button-primary" type="button" onClick={() => void shareDrawing()}><Icon name="share"/> Compartilhar</button></div><button className="button button-new-session restart" type="button" onClick={goHome}><Icon name="refresh"/> Fazer outro retrato</button></Panel></div>}
      </div>

      {idleCountdown !== null && <div className="idle-overlay" role="dialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-description"><section className="idle-dialog"><span className="idle-counter" aria-label={`${idleCountdown} segundos restantes`}>{idleCountdown}</span><div><span className="eyebrow">Pausa por inatividade</span><h2 id="idle-title">Ainda está por aí?</h2><p id="idle-description">Vamos preparar a experiência para um novo retrato.</p></div><button className="button button-primary button-large" type="button" onClick={() => setIdleTimerVersion((value) => value + 1)}>Continuar aqui</button></section></div>}
    </main>
  )
}

export default App
