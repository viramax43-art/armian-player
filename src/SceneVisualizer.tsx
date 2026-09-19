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
  /** Wallpaper mode: frames come from outside, no WebAudio */
  externalOnly?: boolean
  onReady?: (applyFrame: (frame: AnalyserFrame) => void) => void
  /** Also called for each analysed frame (player → wallpaper bridge) */
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
 * The expensive photo layers live in the browser compositor, not in the animated
 * canvas. The canvas draws only transparent FX and is always below the car image.
 * This removes a full-size background + car redraw from every audio frame.
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
  const carLayerRef = useRef<HTMLImageElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const frameRef = useRef<AnalyserFrame>(EMPTY_FRAME)
  const lastPaintRef = useRef(0)
  const shakeRef = useRef({ x: 0, y: 0 })
  const onFrameOutRef = useRef(onFrameOut)
  const [ready, setReady] = useState(false)
  const [loadedAssets, setLoadedAssets] = useState(0)
  onFrameOutRef.current = onFrameOut

  const paint = useCallback((frame: AnalyserFrame) => {
    paintEffects(canvasRef.current, sizeRef.current, frame)
  }, [])

  const applyFrame = useCallback((frame: AnalyserFrame) => {
    // 15 fps is deliberately enough for a smooth spectrum, while substantially
    // reducing canvas work and wallpaper IPC on high-resolution displays.
    const now = performance.now()
    if (now - lastPaintRef.current < 66) return
    lastPaintRef.current = now
    frameRef.current = frame

    if (frame.beat > 0.35) {
      const amp = frame.beat * 3.5
      shakeRef.current.x = (Math.random() - 0.5) * amp
      shakeRef.current.y = (Math.random() - 0.5) * amp * 0.45
    } else {
      shakeRef.current.x *= 0.62
      shakeRef.current.y *= 0.62
    }

    // Transforming one already-decoded image is cheaper than redrawing it into
    // the canvas. It is also a hard z-index guarantee: FX cannot cover the car.
    const car = carLayerRef.current
    if (car) {
      const scale = 1 + frame.energy * 0.012 + frame.beat * 0.008
      car.style.transform = `translate3d(calc(-50% + ${shakeRef.current.x.toFixed(2)}px), calc(-50% + ${shakeRef.current.y.toFixed(2)}px), 0) scale(${scale.toFixed(4)})`
    }

    paint(frame)
    onFrameOutRef.current?.(frame)
  }, [paint])

  useEffect(() => {
    onReady?.(applyFrame)
  }, [onReady, applyFrame])

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
      // One physical pixel is intentional: the soft visual is not improved by
      // retina rendering, but fill-rate and battery use are.
      const dpr = 1
      const w = Math.max(1, wrap.clientWidth)
      const h = Math.max(1, wrap.clientHeight)
      sizeRef.current = { w, h, dpr }
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint(frameRef.current)
      setReady(true)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [paint])

  const markAssetLoaded = useCallback(() => {
    setLoadedAssets((value) => Math.min(2, value + 1))
  }, [])

  const assetsReady = loadedAssets === 2
  return (
    <div className={`scene${hideHud ? ' scene-wallpaper' : ''}`} ref={wrapRef}>
      <img className="scene-backdrop" src={bgUrl} alt="" onLoad={markAssetLoaded} />
      <canvas className="scene-canvas" ref={canvasRef} style={{ opacity: ready && assetsReady ? 1 : 0 }} />
      <img className="scene-car" ref={carLayerRef} src={carUrl} alt="" onLoad={markAssetLoaded} />
      <div className="scene-vignette" />
      {!hideHud && (
        <div className="scene-hud">
          <div className="scene-hud-label">ESCAPE · SCENE</div>
          <div className="scene-hud-title">{title ?? 'Выбери трек'}</div>
          <div className="scene-hud-artist">{artist ?? 'Аудио-реактивная сцена'}</div>
          {!playing && <div className="scene-hud-hint">Нажми Play — сцена оживает с басом</div>}
        </div>
      )}
    </div>
  )
}

function paintEffects(
  canvas: HTMLCanvasElement | null,
  size: { w: number; h: number; dpr: number },
  frame: AnalyserFrame,
) {
  if (!canvas || size.w < 2 || size.h < 2) return
  const { w, h, dpr } = size
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const floorY = h * 0.715
  const cx = w * 0.5
  const radius = Math.min(w, h) * 0.255
  const glow = 0.22 + frame.energy * 0.34 + frame.beat * 0.22

  // A restrained neon horizon and two pulse arcs. These have no blur/filter,
  // so they remain cheap while reading as a more deliberate stage effect.
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(w * 0.12, floorY)
  ctx.quadraticCurveTo(cx, floorY - h * (0.018 + frame.bass * 0.018), w * 0.88, floorY)
  ctx.strokeStyle = `rgba(76, 222, 255, ${glow})`
  ctx.lineWidth = 1.2 + frame.beat * 1.4
  ctx.stroke()

  for (let ring = 0; ring < 2; ring++) {
    const r = radius + ring * 16 + frame.beat * (12 + ring * 7)
    ctx.beginPath()
    ctx.ellipse(cx, floorY, r, r * 0.18, 0, Math.PI * 1.06, Math.PI * 1.94)
    ctx.strokeStyle = ring === 0
      ? `rgba(244, 155, 69, ${0.16 + frame.energy * 0.24})`
      : `rgba(91, 220, 255, ${0.10 + frame.beat * 0.18})`
    ctx.lineWidth = 1 + frame.beat * 1.2
    ctx.stroke()
  }

  const bands = frame.bands
  const count = Math.min(24, bands.length)
  const spread = Math.min(w * 0.68, 760)
  const gap = spread / Math.max(1, count - 1)
  const maxBar = h * (0.07 + frame.bass * 0.075)
  ctx.lineWidth = Math.max(2, Math.min(5, gap * 0.42))

  // Equalizer is anchored to the road beneath the vehicle. The separate car
  // image is composited after this canvas, so no bar can appear over its body.
  for (let i = 0; i < count; i++) {
    const source = Math.min(bands.length - 1, Math.floor(i * bands.length / count))
    const value = bands[source] * bands[source]
    if (value < 0.012) continue
    const x = cx - spread / 2 + i * gap
    const len = Math.max(2, value * maxBar)
    ctx.beginPath()
    ctx.moveTo(x, floorY + 3)
    ctx.lineTo(x, floorY + len)
    const warm = i / Math.max(1, count - 1)
    ctx.strokeStyle = warm < 0.5
      ? `rgba(77, 219, 255, ${0.24 + value * 0.56})`
      : `rgba(255, 157, 74, ${0.24 + value * 0.56})`
    ctx.stroke()
  }

  // Sparse road glints add depth without particle systems or offscreen blur.
  const glintCount = 8
  for (let i = 0; i < glintCount; i++) {
    const phase = (i * 0.618 + frame.energy * 0.7) % 1
    const x = w * (0.2 + phase * 0.6)
    const y = floorY + 20 + ((i * 29) % Math.max(24, h * 0.12))
    const len = 5 + frame.bass * 16
    ctx.strokeStyle = `rgba(156, 233, 255, ${0.06 + frame.energy * 0.12})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x - len, y)
    ctx.lineTo(x + len, y)
    ctx.stroke()
  }
}
