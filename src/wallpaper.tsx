import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SceneVisualizer } from './SceneVisualizer'
import type { AnalyserFrame } from './useAudioAnalyser'
import './styles.css'

/**
 * Wallpaper only renders the scene. Audio/SMTC stay in the main player window
 * so Galaxy Buds double/triple taps are not stolen by a silent duplicate <audio>.
 * Frames arrive over IPC from the main analyser.
 */
function WallpaperApp() {
  const [meta, setMeta] = useState({ title: '', artist: '', playing: false })
  const [apply, setApply] = useState<((f: AnalyserFrame) => void) | null>(null)

  useEffect(() => {
    const offSync = window.playerAPI.onWallpaperSync?.((msg) => {
      setMeta({ title: msg.title, artist: msg.artist, playing: msg.playing })
    })
    const offMeta = window.playerAPI.onWallpaperMeta?.((m) => {
      setMeta((prev) => ({ ...prev, ...m }))
    })
    const offFrame = window.playerAPI.onWallpaperFrame?.((frame) => {
      if (!apply) return
      apply({
        ...frame,
        bands: frame.bands instanceof Float32Array ? frame.bands : Float32Array.from(frame.bands),
      })
    })
    return () => {
      offSync?.()
      offMeta?.()
      offFrame?.()
    }
  }, [apply])

  // Never claim Windows SMTC from this window
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const actions: MediaSessionAction[] = [
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekto',
      'seekbackward',
      'seekforward',
      'stop',
    ]
    try {
      ms.metadata = null
      ms.playbackState = 'none'
    } catch {
      /* ignore */
    }
    for (const a of actions) {
      try {
        ms.setActionHandler(a, null)
      } catch {
        /* ignore */
      }
    }
  }, [])

  const onReady = useCallback((fn: (f: AnalyserFrame) => void) => {
    setApply(() => fn)
  }, [])

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <SceneVisualizer
        playing={meta.playing}
        title={meta.title || undefined}
        artist={meta.artist || undefined}
        hideHud
        externalOnly
        onReady={onReady}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WallpaperApp />
  </StrictMode>,
)
