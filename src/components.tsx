import type { Track } from './types'
import { formatTime } from './utils'
import { IconMusic, IconPlay } from './icons'

export function Cover({
  src,
  className = 'cover',
  fallbackClass = 'cover-fallback',
}: {
  src?: string | null
  className?: string
  fallbackClass?: string
}) {
  if (src) return <img src={src} alt="" className={className} draggable={false} />
  return (
    <div className={fallbackClass}>
      <IconMusic />
    </div>
  )
}

export function Card({
  title,
  subtitle,
  cover,
  onOpen,
  onPlay,
}: {
  title: string
  subtitle: string
  cover?: string | null
  onOpen: () => void
  onPlay: () => void
}) {
  return (
    <button type="button" className="card" onClick={onOpen}>
      <Cover src={cover} />
      <div className="card-title">{title}</div>
      <div className="card-sub">{subtitle}</div>
      <span
        className="play-fab"
        onClick={(e) => {
          e.stopPropagation()
          onPlay()
        }}
        role="button"
        aria-label="Play"
      >
        <IconPlay />
      </span>
    </button>
  )
}

export function TrackTable({
  tracks,
  currentId,
  onPlay,
  showAlbum = true,
}: {
  tracks: Track[]
  currentId: string | null
  onPlay: (track: Track, index: number) => void
  showAlbum?: boolean
}) {
  if (!tracks.length) return <div className="empty">Ничего не найдено</div>

  return (
    <table className="track-table">
      <thead>
        <tr>
          <th className="col-num">#</th>
          <th>Название</th>
          {showAlbum && <th>Альбом</th>}
          <th className="col-dur">⏱</th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((t, i) => (
          <tr
            key={t.id}
            className={`track-row${currentId === t.id ? ' active' : ''}`}
            onDoubleClick={() => onPlay(t, i)}
            onClick={() => onPlay(t, i)}
          >
            <td className="col-num">{i + 1}</td>
            <td>
              <div className="track-meta">
                <Cover src={t.coverDataUrl} className="mini-cover" fallbackClass="mini-cover cover-fallback" />
                <div style={{ minWidth: 0 }}>
                  <div className="track-title">{t.title}</div>
                  <div className="track-artist">{t.artist}</div>
                </div>
              </div>
            </td>
            {showAlbum && <td>{t.album}</td>}
            <td className="col-dur">{formatTime(t.duration)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
