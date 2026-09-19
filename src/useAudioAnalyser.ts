import { useEffect, useRef, type RefObject } from 'react'

export type AnalyserFrame = {
  bass: number
  mid: number
  treble: number
  energy: number
  beat: number
  bands: Float32Array
}

const BAND_COUNT = 28
/** ~15 fps — enough for bass pulse, far cheaper on GPU */
const TICK_MS = 66

type HookOpts = {
  audioRef: RefObject<HTMLAudioElement | null>
  playing: boolean
  onFrame: (frame: AnalyserFrame) => void
  enabled?: boolean
}

let sharedCtx: AudioContext | null = null
let sharedSource: MediaElementAudioSourceNode | null = null
let sharedAnalyser: AnalyserNode | null = null
let silentGain: GainNode | null = null
let hookedEl: HTMLAudioElement | null = null

function ensureGraph(audio: HTMLAudioElement) {
  if (!sharedCtx) {
    sharedCtx = new AudioContext()
  }
  if (!sharedAnalyser) {
    sharedAnalyser = sharedCtx.createAnalyser()
    sharedAnalyser.fftSize = 256
    sharedAnalyser.smoothingTimeConstant = 0.75
    sharedAnalyser.minDecibels = -85
    sharedAnalyser.maxDecibels = -20
  }
  if (hookedEl !== audio) {
    if (!sharedSource) {
      sharedSource = sharedCtx.createMediaElementSource(audio)
      sharedSource.connect(sharedAnalyser)
      silentGain = sharedCtx.createGain()
      silentGain.gain.value = audio.dataset.silent === '1' ? 0 : 1
      sharedAnalyser.connect(silentGain)
      silentGain.connect(sharedCtx.destination)
    }
    hookedEl = audio
  } else if (silentGain && audio.dataset.silent === '1') {
    silentGain.gain.value = 0
  }
  return { ctx: sharedCtx, analyser: sharedAnalyser }
}

export function useAudioAnalyser({ audioRef, playing, onFrame, enabled = true }: HookOpts) {
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const avgBassRef = useRef(0.08)
  const beatEnvRef = useRef(0)
  const bandsRef = useRef(new Float32Array(BAND_COUNT))

  useEffect(() => {
    if (!enabled) return

    let stopped = false
    const freq = new Uint8Array(128)

    const tick = () => {
      if (stopped) return
      const audio = audioRef.current
      if (!audio) return

      try {
        const { ctx, analyser } = ensureGraph(audio)
        if (ctx.state === 'suspended') {
          void ctx.resume()
        }

        analyser.getByteFrequencyData(freq)
        const n = freq.length

        let bassSum = 0
        let midSum = 0
        let trebleSum = 0
        const bassEnd = Math.max(2, Math.floor(n * 0.08))
        const midEnd = Math.floor(n * 0.4)
        for (let i = 0; i < n; i++) {
          const v = freq[i] / 255
          if (i < bassEnd) bassSum += v
          else if (i < midEnd) midSum += v
          else trebleSum += v
        }
        const bass = bassSum / bassEnd
        const mid = midSum / Math.max(1, midEnd - bassEnd)
        const treble = trebleSum / Math.max(1, n - midEnd)
        const energy = bass * 0.55 + mid * 0.3 + treble * 0.15

        avgBassRef.current = avgBassRef.current * 0.92 + bass * 0.08
        const threshold = avgBassRef.current * 1.35 + 0.04
        let beat = beatEnvRef.current * 0.82
        if (playing && bass > threshold && bass > 0.12) {
          beat = Math.min(1, beat + (bass - threshold) * 4)
        }
        beatEnvRef.current = beat

        const bands = bandsRef.current
        for (let b = 0; b < BAND_COUNT; b++) {
          const t0 = b / BAND_COUNT
          const t1 = (b + 1) / BAND_COUNT
          const i0 = Math.floor(Math.pow(t0, 1.55) * (n - 1))
          const i1 = Math.max(i0 + 1, Math.floor(Math.pow(t1, 1.55) * (n - 1)))
          let s = 0
          for (let i = i0; i < i1; i++) s += freq[i]
          bands[b] = s / ((i1 - i0) * 255)
        }

        onFrameRef.current({
          bass,
          mid,
          treble,
          energy,
          beat,
          bands: bandsRef.current,
        })
      } catch {
        /* analyser not ready yet */
      }
    }

    const id = window.setInterval(tick, TICK_MS)
    tick()
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [audioRef, playing, enabled])
}
