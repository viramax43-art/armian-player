import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Library, RepeatMode, Track } from './types'

type QueueContext = {
  label: string
  ids: string[]
}

export function usePlayer(library: Library | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const seekingRef = useRef(false)
  const [queue, setQueue] = useState<QueueContext>({ label: '', ids: [] })
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.85)
  const [muted, setMuted] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  const [shuffle, setShuffle] = useState(false)

  const repeatRef = useRef(repeat)
  const shuffleRef = useRef(shuffle)
  const queueRef = useRef(queue)
  const currentIdRef = useRef(currentId)
  const tracksByIdRef = useRef(new Map<string, Track>())
  const loadAndPlayRef = useRef<(track: Track) => Promise<void>>(async () => {})
  const toggleRef = useRef<() => Promise<void>>(async () => {})
  const rafRef = useRef<number | null>(null)
  const lastPosUpdateRef = useRef(0)

  repeatRef.current = repeat
  shuffleRef.current = shuffle
  queueRef.current = queue
  currentIdRef.current = currentId

  const tracksById = useMemo(() => {
    const m = new Map<string, Track>()
    library?.tracks.forEach((t) => m.set(t.id, t))
    return m
  }, [library])
  tracksByIdRef.current = tracksById

  const current = currentId ? tracksById.get(currentId) ?? null : null

  const stopProgressLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const startProgressLoop = useCallback(() => {
    stopProgressLoop()
    const tick = () => {
      const audio = audioRef.current
      if (audio && !audio.paused && !seekingRef.current) {
        setCurrentTime(audio.currentTime)
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopProgressLoop])

  const loadAndPlay = useCallback(
    async (track: Track) => {
      const audio = audioRef.current
      if (!audio) return
      const url = await window.playerAPI.mediaUrl(track.path)
      seekingRef.current = false
      audio.src = url
      audio.load()
      setCurrentId(track.id)
      setCurrentTime(0)
      setDuration(track.duration || 0)

      // Register with Windows SMTC before play so Buds can attach to this session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album,
          artwork: track.coverDataUrl
            ? [{ src: track.coverDataUrl, sizes: '512x512', type: 'image/jpeg' }]
            : [],
        })
        navigator.mediaSession.playbackState = 'playing'
      }

      try {
        await audio.play()
      } catch {
        setPlaying(false)
        stopProgressLoop()
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused'
        }
      }
    },
    [stopProgressLoop],
  )
  loadAndPlayRef.current = loadAndPlay

  const playNextInternal = useCallback(async (fromEnded: boolean) => {
    const q = queueRef.current.ids
    const cur = currentIdRef.current
    if (!q.length || !cur) {
      if (fromEnded) setPlaying(false)
      return
    }
    const idx = q.indexOf(cur)
    let nextIdx: number
    if (shuffleRef.current) {
      if (q.length === 1) nextIdx = 0
      else {
        do {
          nextIdx = Math.floor(Math.random() * q.length)
        } while (nextIdx === idx)
      }
    } else {
      nextIdx = idx + 1
      if (nextIdx >= q.length) {
        if (repeatRef.current === 'all') nextIdx = 0
        else {
          setPlaying(false)
          return
        }
      }
    }
    const track = tracksByIdRef.current.get(q[nextIdx])
    if (track) await loadAndPlayRef.current(track)
  }, [])

  const playPrevInternal = useCallback(async () => {
    const audio = audioRef.current
    const q = queueRef.current.ids
    const cur = currentIdRef.current
    if (audio && audio.currentTime > 3) {
      seekingRef.current = true
      audio.currentTime = 0
      setCurrentTime(0)
      seekingRef.current = false
      return
    }
    if (!q.length || !cur) return
    const idx = q.indexOf(cur)
    const prevIdx = idx <= 0 ? (repeatRef.current === 'all' ? q.length - 1 : 0) : idx - 1
    const track = tracksByIdRef.current.get(q[prevIdx])
    if (track) await loadAndPlayRef.current(track)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration)
    }
    const onPlay = () => {
      setPlaying(true)
      startProgressLoop()
    }
    const onPause = () => {
      setPlaying(false)
      stopProgressLoop()
      if (!seekingRef.current) setCurrentTime(audio.currentTime)
    }
    const onSeeked = () => {
      setCurrentTime(audio.currentTime)
      seekingRef.current = false
    }
    const onEnded = () => {
      stopProgressLoop()
      if (repeatRef.current === 'one') {
        audio.currentTime = 0
        setCurrentTime(0)
        void audio.play()
        return
      }
      void playNextInternal(true)
    }

    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('seeked', onSeeked)
    audio.addEventListener('ended', onEnded)

    return () => {
      stopProgressLoop()
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('seeked', onSeeked)
      audio.removeEventListener('ended', onEnded)
    }
  }, [playNextInternal, startProgressLoop, stopProgressLoop])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = muted ? 0 : volume
  }, [volume, muted])

  const toggleImmersiveFromBuds = useCallback(async () => {
    try {
      const res = await window.playerAPI.toggleDesktopChrome()
      // Main process also hides/shows the player window
      if (!res?.ok) return
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession

    /** Buds2: 1 tap=play/pause, 2=next, 3=prev as separate AVRCP cmds.
     *  Rapid play/pause bursts (or repeated taps) are counted for 4× → immersive. */
    let tapCount = 0
    let tapTimer: ReturnType<typeof setTimeout> | null = null
    const TAP_MS = 650

    const clearTapTimer = () => {
      if (tapTimer != null) {
        clearTimeout(tapTimer)
        tapTimer = null
      }
    }

    const flushTaps = () => {
      const n = tapCount
      tapCount = 0
      tapTimer = null
      if (n <= 0) return
      if (n === 1) void toggleRef.current()
      else if (n === 2) void playNextInternal(false)
      else if (n === 3) void playPrevInternal()
      else void toggleImmersiveFromBuds()
    }

    const registerTap = () => {
      tapCount += 1
      clearTapTimer()
      if (tapCount >= 4) {
        tapCount = 0
        void toggleImmersiveFromBuds()
        return
      }
      tapTimer = setTimeout(flushTaps, TAP_MS)
    }

    const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        /* unsupported */
      }
    }

    bind('play', () => {
      registerTap()
    })
    bind('pause', () => {
      registerTap()
    })
    bind('previoustrack', () => {
      clearTapTimer()
      tapCount = 0
      void playPrevInternal()
    })
    bind('nexttrack', () => {
      clearTapTimer()
      tapCount = 0
      void playNextInternal(false)
    })
    bind('seekto', (details) => {
      const audio = audioRef.current
      if (!audio || details.seekTime == null) return
      seekingRef.current = true
      audio.currentTime = details.seekTime
      setCurrentTime(details.seekTime)
    })
    bind('seekbackward', (details) => {
      const audio = audioRef.current
      if (!audio) return
      const offset = details.seekOffset ?? 10
      seekingRef.current = true
      audio.currentTime = Math.max(0, audio.currentTime - offset)
      setCurrentTime(audio.currentTime)
    })
    bind('seekforward', (details) => {
      const audio = audioRef.current
      if (!audio) return
      const offset = details.seekOffset ?? 10
      const max = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + offset
      seekingRef.current = true
      audio.currentTime = Math.min(max, audio.currentTime + offset)
      setCurrentTime(audio.currentTime)
    })
    bind('stop', () => {
      const audio = audioRef.current
      if (!audio) return
      audio.pause()
      seekingRef.current = true
      audio.currentTime = 0
      setCurrentTime(0)
      seekingRef.current = false
    })

    return () => {
      clearTapTimer()
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
      for (const a of actions) {
        try {
          ms.setActionHandler(a, null)
        } catch {
          /* ignore */
        }
      }
    }
  }, [playNextInternal, playPrevInternal, toggleImmersiveFromBuds])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    ms.playbackState = playing ? 'playing' : 'paused'
    if (!current) {
      ms.metadata = null
      return
    }
    ms.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: current.coverDataUrl
        ? [{ src: current.coverDataUrl, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    })
  }, [current, playing])

  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return
    const total = duration || current.duration || 0
    if (!(total > 0)) return
    const now = performance.now()
    if (now - lastPosUpdateRef.current < 400 && playing) return
    lastPosUpdateRef.current = now
    try {
      navigator.mediaSession.setPositionState({
        duration: total,
        playbackRate: 1,
        position: Math.min(Math.max(0, currentTime), total),
      })
    } catch {
      /* ignore */
    }
  }, [current, duration, currentTime, playing])

  useEffect(() => {
    if (!window.playerAPI?.onMediaCommand) return

    let tapCount = 0
    let tapTimer: ReturnType<typeof setTimeout> | null = null
    const TAP_MS = 650

    const flush = () => {
      const n = tapCount
      tapCount = 0
      tapTimer = null
      if (n === 1) void toggleRef.current()
      else if (n === 2) void playNextInternal(false)
      else if (n === 3) void playPrevInternal()
      else if (n >= 4) void toggleImmersiveFromBuds()
    }

    return window.playerAPI.onMediaCommand((cmd) => {
      if (cmd === 'next') {
        if (tapTimer) clearTimeout(tapTimer)
        tapCount = 0
        void playNextInternal(false)
        return
      }
      if (cmd === 'previous') {
        if (tapTimer) clearTimeout(tapTimer)
        tapCount = 0
        void playPrevInternal()
        return
      }
      if (cmd === 'stop') {
        const audio = audioRef.current
        if (!audio) return
        audio.pause()
        audio.currentTime = 0
        setCurrentTime(0)
        return
      }
      if (cmd === 'toggle') {
        tapCount += 1
        if (tapTimer) clearTimeout(tapTimer)
        if (tapCount >= 4) {
          tapCount = 0
          void toggleImmersiveFromBuds()
          return
        }
        tapTimer = setTimeout(flush, TAP_MS)
      }
    })
  }, [playNextInternal, playPrevInternal, toggleImmersiveFromBuds])

  const playTrack = useCallback(
    async (track: Track, context?: QueueContext) => {
      if (context) setQueue(context)
      else if (!queue.ids.includes(track.id)) {
        setQueue({ label: 'Библиотека', ids: library?.tracks.map((t) => t.id) ?? [track.id] })
      }
      await loadAndPlay(track)
    },
    [loadAndPlay, library, queue.ids],
  )

  const playIds = useCallback(
    async (ids: string[], label: string, startId?: string) => {
      if (!ids.length) return
      setQueue({ label, ids })
      const start = startId && ids.includes(startId) ? startId : ids[0]
      const track = tracksById.get(start)
      if (track) await loadAndPlay(track)
    },
    [loadAndPlay, tracksById],
  )

  const toggle = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    if (!currentId && library?.tracks[0]) {
      await playIds(
        library.tracks.map((t) => t.id),
        'Библиотека',
      )
      return
    }
    if (audio.paused) await audio.play()
    else audio.pause()
  }, [currentId, library, playIds])
  toggleRef.current = toggle

  const seek = useCallback((t: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(t)) return
    seekingRef.current = true
    setCurrentTime(t)
    try {
      audio.currentTime = t
    } catch {
      seekingRef.current = false
    }
  }, [])

  const seekEnd = useCallback(() => {
    const audio = audioRef.current
    if (!audio) {
      seekingRef.current = false
      return
    }
    // Confirm final position after browser applies seek
    requestAnimationFrame(() => {
      setCurrentTime(audio.currentTime)
      seekingRef.current = false
    })
  }, [])

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))
  }, [])

  return {
    audioRef,
    current,
    playing,
    currentTime,
    duration,
    volume,
    muted,
    repeat,
    shuffle,
    queue,
    playTrack,
    playIds,
    toggle,
    next: () => void playNextInternal(false),
    prev: () => void playPrevInternal(),
    seek,
    seekEnd,
    setVolume,
    setMuted,
    setRepeat,
    cycleRepeat,
    setShuffle,
  }
}
