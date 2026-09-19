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
  bass: 0, mid: 0, treble: 0, energy: 0, beat: 0, bands: new Float32Array(28),
}

/**
 * The animation is inspired by the supplied bass-video: a rear-road camera,
 * incoming lane marks and speed streaks, a reactive underglow and a compact
 * bass kick. Canvas remains BELOW the vehicle DOM layer by design.
 */
export function SceneVisualizer({ audioRef, playing, title, artist, hideHud, externalOnly, onReady, onFrameOut }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const carRef = useRef<HTMLImageElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const frameRef = useRef<AnalyserFrame>(EMPTY_FRAME)
  const beatRef = useRef(0)
  const shakeRef = useRef({ x: 0, y: 0 })
  const clockRef = useRef(0)
  const outRef = useRef(onFrameOut)
  const [ready, setReady] = useState(false)
  const [loaded, setLoaded] = useState(0)
  outRef.current = onFrameOut

  const applyFrame = useCallback((frame: AnalyserFrame) => {
    frameRef.current = frame
    // Keep IPC inexpensive: Wallpaper gets analyser values, while its local RAF
    // generates the smooth in-between motion itself.
    outRef.current?.(frame)
    if (frame.beat > 0.22) beatRef.current = Math.max(beatRef.current, frame.beat)
  }, [])

  useEffect(() => { onReady?.(applyFrame) }, [applyFrame, onReady])
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
      // At 1× the moving road is visually crisp enough, while 4K wallpaper
      // fill-rate stays controlled.
      const w = Math.max(1, wrap.clientWidth)
      const h = Math.max(1, wrap.clientHeight)
      sizeRef.current = { w, h, dpr: 1 }
      canvas.width = w
      canvas.height = h
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      setReady(true)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    let raf = 0
    let last = 0
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate)
      // Render 30 fps: noticeably smoother forward movement than the previous
      // analyser-driven 15 fps, but half the usual canvas/GPU work.
      if (now - last < 33) return
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.033)
      last = now
      clockRef.current += dt
      beatRef.current *= Math.pow(0.055, dt)
      const frame = frameRef.current
      const kick = Math.max(beatRef.current, frame.beat * 0.72)
      const shake = shakeRef.current
      if (kick > 0.18) {
        shake.x += (Math.random() - 0.5) * kick * 2.3
        shake.y += (Math.random() - 0.5) * kick * 1.35
      }
      shake.x *= Math.pow(0.015, dt)
      shake.y *= Math.pow(0.015, dt)

      const car = carRef.current
      if (car) {
        // Suspension compression + subtle idle. No continuous expensive canvas
        // redraw of the car itself.
        const idle = Math.sin(clockRef.current * 23) * (playing ? 0.55 : 0)
        const squash = kick * 0.024
        const sx = 1 + kick * 0.018
        const sy = 1 - squash
        car.style.transform = `translate3d(calc(-50% + ${shake.x.toFixed(2)}px), calc(-50% + ${(shake.y + idle + kick * 5).toFixed(2)}px), 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
      }
      drawRoad(canvasRef.current, sizeRef.current, frame, clockRef.current, kick, playing)
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const assetLoaded = useCallback(() => setLoaded(n => Math.min(2, n + 1)), [])
  return (
    <div className={`scene${hideHud ? ' scene-wallpaper' : ''}`} ref={wrapRef}>
      <img className="scene-backdrop" src={bgUrl} alt="" onLoad={assetLoaded} />
      <canvas className="scene-canvas" ref={canvasRef} style={{ opacity: ready && loaded === 2 ? 1 : 0 }} />
      <img className="scene-car" ref={carRef} src={carUrl} alt="" onLoad={assetLoaded} />
      <div className="scene-vignette" />
      {!hideHud && <div className="scene-hud">
        <div className="scene-hud-label">BASS DRIVE · SCENE</div>
        <div className="scene-hud-title">{title ?? 'Выбери трек'}</div>
        <div className="scene-hud-artist">{artist ?? 'Аудио-реактивная сцена'}</div>
        {!playing && <div className="scene-hud-hint">Нажми Play — дорога и автомобиль оживут на басе</div>}
      </div>}
    </div>
  )
}

function drawRoad(canvas: HTMLCanvasElement | null, size: { w: number; h: number; dpr: number }, frame: AnalyserFrame, time: number, kick: number, playing: boolean) {
  if (!canvas || size.w < 2 || size.h < 2) return
  const { w, h } = size
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)

  const cx = w * 0.5
  const horizon = h * 0.455
  const roadBottom = h * 1.04
  const speed = (playing ? 0.42 + frame.energy * 1.4 + kick * 1.7 : 0.055)
  const travel = (time * speed) % 1

  // Distant neon haze behind the car; the actual vehicle is a higher DOM layer.
  const haze = ctx.createLinearGradient(0, horizon - h * 0.08, 0, horizon + h * 0.2)
  haze.addColorStop(0, 'rgba(255, 18, 111, 0)')
  haze.addColorStop(0.58, `rgba(255, 20, 105, ${0.055 + frame.energy * 0.10})`)
  haze.addColorStop(1, 'rgba(3, 8, 19, 0)')
  ctx.fillStyle = haze
  ctx.fillRect(0, horizon - h * 0.1, w, h * 0.33)

  // Perspective road edge and center lanes flowing from the horizon to camera.
  ctx.lineCap = 'round'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + side * w * 0.07, horizon)
    ctx.lineTo(cx + side * w * 0.72, roadBottom)
    ctx.strokeStyle = `rgba(0, 224, 255, ${0.12 + frame.treble * 0.22})`
    ctx.lineWidth = 1.3 + kick * 1.2
    ctx.stroke()
  }
  const laneCount = 9
  for (let i = 0; i < laneCount; i++) {
    const z = ((i / laneCount + travel) % 1)
    const near = Math.pow(z, 2.15)
    const next = Math.pow(Math.min(1, z + 0.07), 2.15)
    const y0 = horizon + (roadBottom - horizon) * near
    const y1 = horizon + (roadBottom - horizon) * next
    const spread0 = w * (0.018 + near * 0.31)
    const spread1 = w * (0.018 + next * 0.31)
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + side * spread0, y0)
      ctx.lineTo(cx + side * spread1, y1)
      ctx.strokeStyle = `rgba(255, 40, 132, ${0.08 + near * (0.25 + kick * 0.18)})`
      ctx.lineWidth = Math.max(1, 1 + near * 3)
      ctx.stroke()
    }
  }

  // Sparse speed rays. Deterministic phases avoid allocating/updating particle arrays.
  const rayCount = 30
  for (let i = 0; i < rayCount; i++) {
    const seed = fract(Math.sin(i * 91.73) * 43758.5453)
    const angle = (seed - 0.5) * 2.05
    const z = (fract(time * (0.16 + seed * 0.22) * speed + seed * 7.13))
    const p0 = Math.pow(z, 2.8)
    const p1 = Math.min(1, p0 + 0.018 + frame.treble * 0.028)
    const x0 = cx + Math.sin(angle) * w * p0 * 0.95
    const x1 = cx + Math.sin(angle) * w * p1 * 1.08
    const y0 = horizon + Math.cos(angle) * h * p0 * 0.58
    const y1 = horizon + Math.cos(angle) * h * p1 * 0.62
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.strokeStyle = i % 3 === 0
      ? `rgba(0, 226, 255, ${0.035 + p0 * 0.19})`
      : `rgba(255, 49, 135, ${0.025 + p0 * 0.15})`
    ctx.lineWidth = 0.6 + p0 * 1.5
    ctx.stroke()
  }

  // One underbody bloom and a sharp neon ellipse. Both are below the car image.
  const glowY = h * 0.69
  const rx = Math.min(w * 0.24, 260) * (1 + kick * 0.28)
  const glow = ctx.createRadialGradient(cx, glowY, 2, cx, glowY, rx)
  glow.addColorStop(0, `rgba(255, 33, 121, ${0.34 + frame.bass * 0.34 + kick * 0.2})`)
  glow.addColorStop(0.38, `rgba(120, 25, 255, ${0.16 + kick * 0.16})`)
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.ellipse(cx, glowY, rx, rx * 0.14, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx, glowY, rx * 0.8, rx * 0.065, 0, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(255, 93, 177, ${0.22 + kick * 0.45})`
  ctx.lineWidth = 1 + kick * 1.6
  ctx.stroke()
}

function fract(value: number) { return value - Math.floor(value) }
