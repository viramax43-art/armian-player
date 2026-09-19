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

/**
 * Single-canvas scene: bg → spectrum → car.
 * Guarantees FX under the car (no CSS z-fight) and cuts GPU cost vs filter/drop-shadow.
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
  const bgImgRef = useRef<HTMLImageElement | null>(null)
  const carImgRef = useRef<HTMLImageElement | null>(null)
  const shakeRef = useRef({ x: 0, y: 0 })
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const lastPaintRef = useRef(0)
  const onFrameOutRef = useRef(onFrameOut)
  onFrameOutRef.current = onFrameOut
  const [ready, setReady] = useState(false)
  const [assetsReady, setAssetsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const bg = new Image()
    const car = new Image()
    let pending = 2
    const done = () => {
      pending -= 1
      if (pending <= 0 && !cancelled) {
        bgImgRef.current = bg
        carImgRef.current = car
        setAssetsReady(true)
      }
    }
    bg.onload = done
    bg.onerror = done
    car.onload = done
    car.onerror = done
    bg.src = bgUrl
    car.src = carUrl
    return () => {
      cancelled = true
    }
  }, [])

  const applyFrame = useCallback(
    (frame: AnalyserFrame) => {
      // Cap visual updates (~20 fps) — analyser may run faster
      const now = performance.now()
      const minGap = hideHud ? 50 : 40
      if (now - lastPaintRef.current < minGap) {
        onFrameOutRef.current?.(frame)
        return
      }
      lastPaintRef.current = now

      if (frame.beat > 0.35) {
        const amp = frame.beat * 8
        shakeRef.current.x = (Math.random() - 0.5) * amp
        shakeRef.current.y = (Math.random() - 0.5) * amp * 0.65
      } else {
        shakeRef.current.x *= 0.55
        shakeRef.current.y *= 0.55
      }

      paintScene(canvasRef.current, sizeRef.current, frame, {
        bg: bgImgRef.current,
        car: carImgRef.current,
        shake: shakeRef.current,
      })
      onFrameOutRef.current?.(frame)
    },
    [hideHud],
  )

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
      // Wallpaper: 1× DPR. In-app: cap at 1.25 to save fill-rate
      const dpr = hideHud ? 1 : Math.min(window.devicePixelRatio || 1, 1.25)
      const w = Math.max(1, wrap.clientWidth)
      const h = Math.max(1, wrap.clientHeight)
      sizeRef.current = { w, h, dpr }
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      setReady(true)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [hideHud])

  // Initial static paint once assets load
  useEffect(() => {
    if (!assetsReady) return
    paintScene(
      canvasRef.current,
      sizeRef.current,
      {
        bass: 0,
        mid: 0,
        treble: 0,
        energy: 0,
        beat: 0,
        bands: new Float32Array(24),
      },
      { bg: bgImgRef.current, car: carImgRef.current, shake: { x: 0, y: 0 } },
    )
  }, [assetsReady])

  return (
    <div className={`scene${hideHud ? ' scene-wallpaper' : ''}`} ref={wrapRef}>
      <canvas
        className="scene-canvas"
        ref={canvasRef}
        style={{ opacity: ready && assetsReady ? 1 : 0 }}
      />
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

type PaintAssets = {
  bg: HTMLImageElement | null
  car: HTMLImageElement | null
  shake: { x: number; y: number }
}

function coverDraw(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  scale = 1,
) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return
  const cover = Math.max(w / iw, h / ih) * scale
  const dw = iw * cover
  const dh = ih * cover
  ctx.drawImage(img, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh)
}

function paintScene(
  canvas: HTMLCanvasElement | null,
  size: { w: number; h: number; dpr: number },
  frame: AnalyserFrame,
  assets: PaintAssets,
) {
  if (!canvas) return
  const { w, h, dpr } = size
  if (w < 2 || h < 2) return

  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // --- background ---
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  if (assets.bg?.complete) {
    const bgScale = 1.04 + frame.bass * 0.03 + frame.beat * 0.015
    coverDraw(ctx, assets.bg, w, h, bgScale)
  }

  // --- spectrum UNDER car ---
  drawSpectrum(ctx, w, h, frame)

  // --- car ON TOP of spectrum ---
  if (assets.car?.complete) {
    const pulse = 1 + frame.energy * 0.04
    const bassPump = 1 + frame.bass * 0.08 + frame.beat * 0.05
    const scale = pulse * bassPump
    const { x, y } = assets.shake

    const maxW = Math.min(w * 0.72, 680)
    const maxH = h * 0.58
    const iw = assets.car.naturalWidth || assets.car.width
    const ih = assets.car.naturalHeight || assets.car.height
    if (iw && ih) {
      const fit = Math.min(maxW / iw, maxH / ih)
      const dw = iw * fit * scale
      const dh = ih * fit * scale
      const cx = w * 0.5 + x
      const cy = h * 0.5 + h * 0.03 + y
      ctx.drawImage(assets.car, cx - dw * 0.5, cy - dh * 0.5, dw, dh)
    }
  }
}

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: AnalyserFrame,
) {
  const cx = w * 0.5
  const cy = h * 0.58
  const bands = frame.bands
  const count = Math.min(bands.length, 28)
  const step = bands.length / count
  const baseR = Math.min(w, h) * 0.28
  const maxLen = Math.min(w, h) * (0.12 + frame.bass * 0.1)

  // One soft ring — no heavy radial fill every bar
  ctx.beginPath()
  ctx.arc(cx, cy, baseR + frame.energy * 18 + frame.beat * 10, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(255, 190, 70, ${0.14 + frame.beat * 0.35})`
  ctx.lineWidth = 2 + frame.beat * 2.5
  ctx.stroke()

  const lineW = Math.max(2, (Math.PI * 2 * baseR) / count - 2.5)
  ctx.lineCap = 'round'
  ctx.lineWidth = lineW

  for (let i = 0; i < count; i++) {
    const src = Math.min(bands.length - 1, Math.floor(i * step))
    const v = bands[src]
    const len = v * v * maxLen * (0.7 + frame.bass * 0.6)
    if (len < 1.2) continue

    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const x0 = cx + cos * baseR
    const y0 = cy + sin * baseR
    const x1 = cx + cos * (baseR + len)
    const y1 = cy + sin * (baseR + len)

    const a = 0.3 + v * 0.5 + frame.beat * 0.12
    // Solid color — avoid createLinearGradient × N (major GPU/CPU cost)
    ctx.strokeStyle = `rgba(255, ${Math.floor(140 + v * 80)}, 40, ${a})`
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
}
