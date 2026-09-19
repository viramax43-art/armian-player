import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { RepeatMode, Track } from './types'
import { formatTime } from './utils'
import {
  IconMuted,
  IconPause,
  IconPlay,
  IconRepeat,
  IconShuffle,
  IconSkipNext,
  IconSkipPrev,
  IconVolume,
  IconMusic,
} from './icons'

type Props = {
  current: Track | null
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  repeat: RepeatMode
  shuffle: boolean
  queueLabel: string
  onToggle: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (t: number) => void
  onSeekEnd: () => void
  onVolume: (v: number) => void
  onMute: () => void
  onCycleRepeat: () => void
  onToggleShuffle: () => void
}

export function PlayerBar({
  current,
  playing,
  currentTime,
  duration,
  volume,
  muted,
  repeat,
  shuffle,
  queueLabel,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onSeekEnd,
  onVolume,
  onMute,
  onCycleRepeat,
  onToggleShuffle,
}: Props) {
  const dragging = useRef(false)
  const [scrub, setScrub] = useState<number | null>(null)

  const shownTime = scrub != null ? scrub : currentTime
  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (shownTime / duration) * 100)) : 0
  const volumePct = (muted ? 0 : volume) * 100

  const progressStyle = { '--fill': `${progressPct}%` } as CSSProperties
  const volumeStyle = { '--fill': `${volumePct}%` } as CSSProperties

  const applyScrub = (raw: number) => {
    if (!(duration > 0)) return
    const t = Math.min(duration, Math.max(0, raw))
    setScrub(t)
    onSeek(t)
  }

  const endScrub = () => {
    dragging.current = false
    setScrub(null)
    onSeekEnd()
  }

  const onProgressPointerDown = () => {
    dragging.current = true
  }

  const onProgressPointerUp = (_e: PointerEvent<HTMLInputElement>) => {
    endScrub()
  }

  return (
    <footer className="player-bar">
      <div className="now">
        {current?.coverDataUrl ? (
          <img src={current.coverDataUrl} alt="" draggable={false} />
        ) : (
          <div className="now-fallback">
            <IconMusic />
          </div>
        )}
        <div className="now-text">
          <div className="now-title">{current?.title ?? 'Не выбрано'}</div>
          <div className="now-artist">
            {current ? current.artist : 'Выберите трек'}
            {queueLabel ? ` · ${queueLabel}` : ''}
          </div>
        </div>
      </div>

      <div className="controls">
        <div className="controls-row">
          <button
            type="button"
            className={`ctrl${shuffle ? ' active' : ''}`}
            onClick={onToggleShuffle}
            title="Перемешать"
          >
            <IconShuffle />
          </button>
          <button type="button" className="ctrl" onClick={onPrev} title="Предыдущий">
            <IconSkipPrev />
          </button>
          <button type="button" className="ctrl play" onClick={onToggle} title={playing ? 'Пауза' : 'Играть'}>
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button type="button" className="ctrl" onClick={onNext} title="Следующий">
            <IconSkipNext />
          </button>
          <button
            type="button"
            className={`ctrl repeat-badge${repeat !== 'off' ? ' active' : ''}`}
            data-mode={repeat}
            onClick={onCycleRepeat}
            title={
              repeat === 'off'
                ? 'Повтор выкл'
                : repeat === 'all'
                  ? 'Повтор очереди / альбома'
                  : 'Зациклить трек'
            }
          >
            <IconRepeat />
          </button>
        </div>
        <div className="progress">
          <time>{formatTime(shownTime)}</time>
          <div className="progress-track">
            <input
              className="fill-range"
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.01}
              value={duration > 0 ? Math.min(shownTime, duration) : 0}
              disabled={!duration}
              style={progressStyle}
              onPointerDown={onProgressPointerDown}
              onPointerUp={onProgressPointerUp}
              onPointerCancel={onProgressPointerUp}
              onChange={(e) => applyScrub(Number(e.target.value))}
              onInput={(e) => applyScrub(Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <time>{formatTime(duration)}</time>
        </div>
      </div>

      <div className="volume">
        <button type="button" className="ctrl" onClick={onMute} title="Звук">
          {muted || volume === 0 ? <IconMuted /> : <IconVolume />}
        </button>
        <input
          className="fill-range"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          style={volumeStyle}
          onChange={(e) => onVolume(Number(e.target.value))}
          onInput={(e) => onVolume(Number((e.target as HTMLInputElement).value))}
        />
      </div>
    </footer>
  )
}
