import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useAudioAnalyser, type AnalyserFrame } from './useAudioAnalyser'
import bgUrl from './assets/scene/bg.png'
import carUrl from './assets/scene/car.png'

type Props = {
  audioRef?: RefObject<HTMLAudioElement | null>
  playing: boolean
  title?: string
  artist?: string
  hideHud?: boolean
  externalOnly?: boolean
  onReady?: (applyFrame: (frame: AnalyserFrame) => void) => void
  onFrameOut?: (frame: AnalyserFrame) => void
}

const EMPTY_FRAME: AnalyserFrame = {
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
  beat: 0,
  bands: new Float32Array(28),
}

/**
 * Garage photo + car on top; canvas only draws warm spectrum / underglow under the car.
 * Motion: clear bass pump (scale + dip) and a short beat shake — readable, not neon road noise.
 */
export function SceneVisualizer({
  audioRef,
  playing,
  title,
  artist,
  hideHud,
  externalOnly,
  onReady,
  onFrameOut,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const carRef = useRef<HTMLImageElement | null>(null)
  const bgRef = useRef<HTMLImageElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const frameRef = useRef<AnalyserFrame>(EMPTY_FRAME)
  const beatEnvRef = useRef(0)
  const shakeRef = useRef({ x: 0, y: 0 })
  const outRef = useRef(onFrameOut)
  const [ready, setReady] = useState(false)
  const [loaded, setLoaded] = useState(0)
  outRef.current = onFrameOut

  const applyFrame = useCallback((frame: AnalyserFrame) => {
    frameRef.current = frame
    outRef.current?.(frame)
    if (frame.beat > 0.28) {
      beatEnvRef.current = Math.max(beatEnvRef.current, frame.beat)
    }
  }, [])

  useEffect(() => {
    onReady?.(applyFrame)
  }, [applyFrame, onReady])

  useAudioAnalyser({
    audioRef: audioRef ?? { current: null },
    playing: externalOnly ? false : playing,
    enabled: !externalOnly && !!audioRef,
    onFrame: applyFrame,
  })

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current
      const wrap = wrapRef.current
      if (!canvas || !wrap) return
      const dpr = hideHud ? 1 : Math.min(window.devicePixelRatio || 1, 1.25)
      const w = Math.max(1, wrap.clientWidth)
      const h = Math.max(1, wrap.clientHeight)
      sizeRef.current = { w, h }
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      setReady(true)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [hideHud])

  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 40) return
      const dt = Math.min(0.06, last ? (now - last) / 1000 : 0.04)
      last = now

      const frame = frameRef.current
      beatEnvRef.current *= Math.pow(0.04, dt)
      const kick = Math.max(beatEnvRef.current, frame.beat * 0.65)
      const bass = frame.bass
      const energy = frame.energy

      const shake = shakeRef.current
      if (kick > 0.35) {
        const amp = (kick - 0.35) * 6
        shake.x = (Math.random() - 0.5) * amp
        shake.y = (Math.random() - 0.5) * amp * 0.55
      } else {
        shake.x *= Math.pow(0.02, dt)
        shake.y *= Math.pow(0.02, dt)
      }

      // Car: dip on kick + widen slightly — reads as suspension / bass hit
      const car = carRef.current
      if (car) {
        const pump = 1 + bass * 0.06 + kick * 0.05
        const dip = kick * 10 + bass * 4
        car.style.transform = `translate3d(calc(-50% + ${shake.x.toFixed(2)}px), calc(-50% + ${(shake.y + dip).toFixed(2)}px), 0) scale(${pump.toFixed(4)})`
      }

      // Backdrop: tiny zoom with energy (no filters)
      const bg = bgRef.current
      if (bg) {
        const z = 1.02 + bass * 0.025 + kick * 0.015
        bg.style.transform = `scale(${z.toFixed(4)})`
      }

      paintFx(canvasRef.current, sizeRef.current, frame, kick, playing)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const onAsset = useCallback(() => setLoaded((n) => Math.min(2, n + 1)), [])

  return (
    <div className={`scene${hideHud ? ' scene-wallpaper' : ''}`} ref={wrapRef}>
      <img className="scene-backdrop" ref={bgRef} src={bgUrl} alt="" onLoad={onAsset} draggable={false} />
      <canvas
        className="scene-canvas"
        ref={canvasRef}
        style={{ opacity: ready && loaded === 2 ? 1 : 0 }}
      />
      <img className="scene-car" ref={carRef} src={carUrl} alt="" onLoad={onAsset} draggable={false} />
      <div className="scene-vignette" />
      {!hideHud && (
        <div className="scene-hud">
          <div className="scene-hud-label">ESCAPE · SCENE</div>
          <div className="scene-hud-title">{title ?? 'Выбери трек'}</div>
          <div className="scene-hud-artist">{artist ?? 'Аудио-реактивная сцена'}</div>
          {!playing && <div className="scene-hud-hint">Нажми Play — авто и спектр реагируют на бас</div>}
        </div>
      )}
    </div>
  )
}

function paintFx(
  canvas: HTMLCanvasElement | null,
  size: { w: number; h: number },
  frame: AnalyserFrame,
  kick: number,
  playing: boolean,
) {
  if (!canvas || size.w < 2 || size.h < 2) return
  const { w, h } = size
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  if (!playing && frame.energy < 0.02) return

  const cx = w * 0.5
  const cy = h * 0.62
  const bands = frame.bands
  const count = Math.min(bands.length, 24)
  const step = bands.length / count
  const baseR = Math.min(w, h) * 0.22
  const maxLen = Math.min(w, h) * (0.1 + frame.bass * 0.12 + kick * 0.06)

  // Soft amber underglow under the car
  const rx = Math.min(w * 0.28, 280) * (1 + frame.bass * 0.35 + kick * 0.25)
  const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, rx)
  glow.addColorStop(0, `rgba(255, 170, 50, ${0.22 + frame.bass * 0.35 + kick * 0.25})`)
  glow.addColorStop(0.45, `rgba(255, 120, 30, ${0.08 + kick * 0.12})`)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, rx * 0.22, 0, 0, Math.PI * 2)
  ctx.fill()

  // Pulse ring on beat
  if (kick > 0.08) {
    ctx.beginPath()
    ctx.arc(cx, cy, baseR + kick * 28, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255, 200, 80, ${0.15 + kick * 0.45})`
    ctx.lineWidth = 2 + kick * 3
    ctx.stroke()
  }

  // Radial bars — warm palette matching the garage photo
  ctx.lineCap = 'round'
  const lineW = Math.max(2.2, (Math.PI * 2 * baseR) / count - 2)
  ctx.lineWidth = lineW
  for (let i = 0; i < count; i++) {
    const src = Math.min(bands.length - 1, Math.floor(i * step))
    const v = bands[src]
    const len = Math.pow(v, 1.2) * maxLen * (0.55 + frame.bass * 0.7)
    if (len < 1.5) continue
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const x0 = cx + cos * baseR
    const y0 = cy + sin * baseR
    const x1 = cx + cos * (baseR + len)
    const y1 = cy + sin * (baseR + len)
    const a = 0.28 + v * 0.55 + kick * 0.15
    ctx.strokeStyle = `rgba(255, ${Math.floor(150 + v * 70)}, 40, ${a})`
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
}
