import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Album, Artist, CoverCluster, Library, Track, ViewId } from './types'
import { searchLibrary } from './utils'
import { usePlayer } from './usePlayer'
import { useAudioAnalyser, type AnalyserFrame } from './useAudioAnalyser'
import { Card, Cover, TrackTable } from './components'
import { PlayerBar } from './PlayerBar'
import { SceneVisualizer } from './SceneVisualizer'
import {
  IconDisc,
  IconHome,
  IconImage,
  IconLibrary,
  IconPlay,
  IconScene,
  IconSearch,
  IconUsers,
} from './icons'
import './styles.css'

type Detail =
  | { kind: 'artist'; data: Artist }
  | { kind: 'album'; data: Album }
  | { kind: 'cover'; data: CoverCluster }

export default function App() {
  const [library, setLibrary] = useState<Library | null>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [view, setView] = useState<ViewId>('home')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [wallpaperOn, setWallpaperOn] = useState(false)
  const [wallpaperBusy, setWallpaperBusy] = useState(false)
  const [wallpaperError, setWallpaperError] = useState<string | null>(null)
  const [desktopHidden, setDesktopHidden] = useState(false)
  const currentTimeRef = useRef(0)
  const wallpaperOnRef = useRef(false)
  wallpaperOnRef.current = wallpaperOn

  const player = usePlayer(library)
  currentTimeRef.current = player.currentTime

  useEffect(() => {
    void window.playerAPI.wallpaperIsEnabled?.().then((on) => {
      if (on) setWallpaperOn(true)
    })
    void window.playerAPI.isDesktopChromeHidden?.().then((h) => setDesktopHidden(!!h))
    return window.playerAPI.onDesktopChrome?.((d) => {
      setDesktopHidden(!!d.hidden)
      // Immersive auto-enables live wallpaper in main — keep React state in sync for frame bridge
      if (d.hidden) setWallpaperOn(true)
    })
  }, [])

  const toggleDesktopHide = async () => {
    const res = await window.playerAPI.toggleDesktopChrome()
    if (res.ok) setDesktopHidden(res.hidden)
  }

  const pushWallpaperFrame = useCallback((f: AnalyserFrame) => {
    if (!wallpaperOnRef.current) return
    window.playerAPI.sendWallpaperFrame({
      bass: f.bass,
      mid: f.mid,
      treble: f.treble,
      energy: f.energy,
      beat: f.beat,
      bands: Array.from(f.bands),
    })
  }, [])

  // Only when wallpaper is on but scene view is not mounted (SceneVisualizer owns analyser on scene)
  useAudioAnalyser({
    audioRef: player.audioRef,
    playing: player.playing,
    enabled: wallpaperOn && view !== 'scene',
    onFrame: pushWallpaperFrame,
  })

  // Wallpaper gets meta/clock only — no second <audio> (that stole Buds SMTC)
  useEffect(() => {
    if (!wallpaperOn) return
    let cancelled = false

    const push = () => {
      if (cancelled) return
      const track = player.current
      window.playerAPI.sendWallpaperSync({
        mediaUrl: null,
        playing: player.playing,
        currentTime: currentTimeRef.current,
        title: track?.title ?? '',
        artist: track?.artist ?? '',
      })
    }

    push()
    const id = window.setInterval(push, 400)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [wallpaperOn, player.playing, player.current?.id, player.current?.title, player.current?.artist])

  const toggleWallpaper = async () => {
    setWallpaperBusy(true)
    setWallpaperError(null)
    try {
      if (wallpaperOn) {
        await window.playerAPI.wallpaperDisable()
        setWallpaperOn(false)
      } else {
        const res = await window.playerAPI.wallpaperEnable()
        if (!res.ok) {
          setWallpaperError(res.error || 'Не удалось включить обои')
          setWallpaperOn(false)
        } else {
          setWallpaperOn(true)
        }
      }
    } catch (e) {
      setWallpaperError(String(e))
      setWallpaperOn(false)
    } finally {
      setWallpaperBusy(false)
    }
  }

  const tracksById = useMemo(() => {
    const m = new Map<string, Track>()
    library?.tracks.forEach((t) => m.set(t.id, t))
    return m
  }, [library])

  const scan = useCallback(async (force = false) => {
    setLoading(true)
    setProgress({ done: 0, total: 0 })
    try {
      const lib = await window.playerAPI.scan({ force })
      setLibrary(lib)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }, [])

  useEffect(() => {
    const off = window.playerAPI.onProgress(setProgress)
    void scan(false)
    return off
  }, [scan])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        void player.toggle()
      } else if (e.code === 'ArrowRight') {
        player.next()
      } else if (e.code === 'ArrowLeft') {
        player.prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.toggle, player.next, player.prev])

  const pickFolder = async () => {
    const root = await window.playerAPI.pickFolder()
    if (root) await scan(true)
  }

  const openSearch = (q: string) => {
    setQuery(q)
    setView('search')
    setDetail(null)
  }

  const results = useMemo(() => {
    if (!library || !query.trim()) return null
    return searchLibrary(library.tracks, library.artists, library.albums, query)
  }, [library, query])

  const detailTracks = useMemo(() => {
    if (!detail) return []
    return detail.data.trackIds.map((id) => tracksById.get(id)).filter(Boolean) as Track[]
  }, [detail, tracksById])

  const playTracks = (tracks: Track[], label: string, start?: Track) => {
    void player.playIds(
      tracks.map((t) => t.id),
      label,
      start?.id,
    )
  }

  const nav = (id: ViewId) => {
    setView(id)
    setDetail(null)
  }

  const renderHome = () => {
    if (!library) return null
    const topArtists = library.artists.slice(0, 8)
    const topAlbums = library.albums.filter((a) => a.trackIds.length >= 2).slice(0, 8)
    const covers = library.coverClusters.slice(0, 8)

    return (
      <>
        <h1 className="section-title">Твоя библиотека</h1>
        <p className="section-sub">
          {library.tracks.length} треков · {library.artists.length} исполнителей · {library.albums.length} альбомов
        </p>

        {topArtists.length > 0 && (
          <>
            <h2 className="section-title" style={{ fontSize: 20 }}>
              Исполнители
            </h2>
            <div className="card-grid">
              {topArtists.map((a) => (
                <Card
                  key={a.id}
                  title={a.name}
                  subtitle={`${a.trackIds.length} треков`}
                  cover={a.coverDataUrl}
                  onOpen={() => {
                    setDetail({ kind: 'artist', data: a })
                    setView('detail')
                  }}
                  onPlay={() => {
                    const ts = a.trackIds.map((id) => tracksById.get(id)!).filter(Boolean)
                    playTracks(ts, a.name)
                  }}
                />
              ))}
            </div>
          </>
        )}

        {topAlbums.length > 0 && (
          <>
            <h2 className="section-title" style={{ fontSize: 20, marginTop: 28 }}>
              Альбомы
            </h2>
            <div className="card-grid">
              {topAlbums.map((a) => (
                <Card
                  key={a.id}
                  title={a.name}
                  subtitle={`${a.artist} · ${a.trackIds.length}`}
                  cover={a.coverDataUrl}
                  onOpen={() => {
                    setDetail({ kind: 'album', data: a })
                    setView('detail')
                  }}
                  onPlay={() => {
                    const ts = a.trackIds.map((id) => tracksById.get(id)!).filter(Boolean)
                    playTracks(ts, a.name)
                  }}
                />
              ))}
            </div>
          </>
        )}

        {covers.length > 0 && (
          <>
            <h2 className="section-title" style={{ fontSize: 20, marginTop: 28 }}>
              Похожие обложки
            </h2>
            <div className="card-grid">
              {covers.map((c) => (
                <Card
                  key={c.id}
                  title={c.name}
                  subtitle={`${c.count} треков`}
                  cover={c.coverDataUrl}
                  onOpen={() => {
                    setDetail({ kind: 'cover', data: c })
                    setView('detail')
                  }}
                  onPlay={() => {
                    const ts = c.trackIds.map((id) => tracksById.get(id)!).filter(Boolean)
                    playTracks(ts, c.name)
                  }}
                />
              ))}
            </div>
          </>
        )}
      </>
    )
  }

  const renderDetail = () => {
    if (!detail) return null
    const title =
      detail.kind === 'artist'
        ? detail.data.name
        : detail.kind === 'album'
          ? detail.data.name
          : detail.data.name
    const subtitle =
      detail.kind === 'artist'
        ? `${detail.data.trackIds.length} треков`
        : detail.kind === 'album'
          ? `${detail.data.artist} · ${detail.data.trackIds.length} треков`
          : `${detail.data.count} треков с похожими обложками`
    const cover = detail.data.coverDataUrl
    const typeLabel = detail.kind === 'artist' ? 'Исполнитель' : detail.kind === 'album' ? 'Альбом' : 'Обложки'

    return (
      <>
        <div className="detail-hero">
          <Cover src={cover} className="hero-cover" fallbackClass="hero-fallback" />
          <div>
            <div className="detail-type">{typeLabel}</div>
            <h1 className="detail-name">{title}</h1>
            <div className="detail-meta">{subtitle}</div>
            <div className="detail-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => playTracks(detailTracks, title)}
              >
                <IconPlay /> Слушать
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  player.setRepeat('all')
                  playTracks(detailTracks, title)
                }}
                title="Слушать с зацикливанием альбома/подборки"
              >
                Зациклить подборку
              </button>
            </div>
          </div>
        </div>
        <TrackTable
          tracks={detailTracks}
          currentId={player.current?.id ?? null}
          showAlbum={detail.kind !== 'album'}
          onPlay={(t) => playTracks(detailTracks, title, t)}
        />
      </>
    )
  }

  const renderContent = () => {
    if (!library && view !== 'scene') return <div className="empty">Библиотека пуста</div>

    if (view === 'scene') {
      return (
        <SceneVisualizer
          audioRef={player.audioRef}
          playing={player.playing}
          title={player.current?.title}
          artist={player.current?.artist}
          onFrameOut={pushWallpaperFrame}
        />
      )
    }

    if (!library) return <div className="empty">Библиотека пуста</div>

    if (view === 'detail') return renderDetail()

    if (view === 'home') return renderHome()

    if (view === 'tracks') {
      return (
        <>
          <h1 className="section-title">Все треки</h1>
          <TrackTable
            tracks={library.tracks}
            currentId={player.current?.id ?? null}
            onPlay={(t) => playTracks(library.tracks, 'Все треки', t)}
          />
        </>
      )
    }

    if (view === 'artists') {
      return (
        <>
          <h1 className="section-title">Исполнители</h1>
          <div className="card-grid">
            {library.artists.map((a) => (
              <Card
                key={a.id}
                title={a.name}
                subtitle={`${a.trackIds.length} треков`}
                cover={a.coverDataUrl}
                onOpen={() => {
                  setDetail({ kind: 'artist', data: a })
                  setView('detail')
                }}
                onPlay={() => {
                  const ts = a.trackIds.map((id) => tracksById.get(id)!).filter(Boolean)
                  playTracks(ts, a.name)
                }}
              />
            ))}
          </div>
        </>
      )
    }

    if (view === 'albums') {
      return (
        <>
          <h1 className="section-title">Альбомы</h1>
          <div className="card-grid">
            {library.albums.map((a) => (
              <Card
                key={a.id}
                title={a.name}
                subtitle={`${a.artist} · ${a.trackIds.length}`}
                cover={a.coverDataUrl}
                onOpen={() => {
                  setDetail({ kind: 'album', data: a })
                  setView('detail')
                }}
                onPlay={() => {
                  const ts = a.trackIds.map((id) => tracksById.get(id)!).filter(Boolean)
                  playTracks(ts, a.name)
                }}
              />
            ))}
          </div>
        </>
      )
    }

    if (view === 'covers') {
      return (
        <>
          <h1 className="section-title">Похожие обложки</h1>
          <p className="section-sub">Группы треков с визуально похожими обложками (perceptual hash)</p>
          {library.coverClusters.length === 0 ? (
            <div className="empty">Недостаточно совпадений обложек</div>
          ) : (
            <div className="card-grid">
              {library.coverClusters.map((c) => (
                <Card
                  key={c.id}
                  title={c.name}
                  subtitle={`${c.count} треков`}
                  cover={c.coverDataUrl}
                  onOpen={() => {
                    setDetail({ kind: 'cover', data: c })
                    setView('detail')
                  }}
                  onPlay={() => {
                    const ts = c.trackIds.map((id) => tracksById.get(id)!).filter(Boolean)
                    playTracks(ts, c.name)
                  }}
                />
              ))}
            </div>
          )}
        </>
      )
    }

    if (view === 'search') {
      if (!results) {
        return (
          <>
            <h1 className="section-title">Поиск</h1>
            <p className="section-sub">Начните вводить название, исполнителя или альбом</p>
          </>
        )
      }
      return (
        <>
          <h1 className="section-title">Результаты</h1>
          {results.artists.length > 0 && (
            <>
              <h2 className="section-title" style={{ fontSize: 18 }}>
                Исполнители
              </h2>
              <div className="card-grid" style={{ marginBottom: 24 }}>
                {results.artists.slice(0, 8).map((a) => {
                  const full = library.artists.find((x) => x.id === a.id)!
                  return (
                    <Card
                      key={a.id}
                      title={full.name}
                      subtitle={`${full.trackIds.length} треков`}
                      cover={full.coverDataUrl}
                      onOpen={() => {
                        setDetail({ kind: 'artist', data: full })
                        setView('detail')
                      }}
                      onPlay={() => {
                        const ts = full.trackIds.map((id) => tracksById.get(id)!).filter(Boolean)
                        playTracks(ts, full.name)
                      }}
                    />
                  )
                })}
              </div>
            </>
          )}
          {results.albums.length > 0 && (
            <>
              <h2 className="section-title" style={{ fontSize: 18 }}>
                Альбомы
              </h2>
              <div className="card-grid" style={{ marginBottom: 24 }}>
                {results.albums.slice(0, 8).map((a) => {
                  const full = library.albums.find((x) => x.id === a.id)!
                  return (
                    <Card
                      key={a.id}
                      title={full.name}
                      subtitle={full.artist}
                      cover={full.coverDataUrl}
                      onOpen={() => {
                        setDetail({ kind: 'album', data: full })
                        setView('detail')
                      }}
                      onPlay={() => {
                        const ts = full.trackIds.map((id) => tracksById.get(id)!).filter(Boolean)
                        playTracks(ts, full.name)
                      }}
                    />
                  )
                })}
              </div>
            </>
          )}
          <h2 className="section-title" style={{ fontSize: 18 }}>
            Треки
          </h2>
          <TrackTable
            tracks={results.tracks as Track[]}
            currentId={player.current?.id ?? null}
            onPlay={(t) => playTracks(results.tracks as Track[], 'Поиск', t)}
          />
        </>
      )
    }

    return null
  }

  return (
    <div className="app">
      <audio ref={player.audioRef} preload="auto" playsInline style={{ display: 'none' }} />
      <div className="title-drag" />
      <div className="app-body" style={{ position: 'relative' }}>
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark" />
            Armian
          </div>
          <button type="button" className={`nav-btn${view === 'home' ? ' active' : ''}`} onClick={() => nav('home')}>
            <IconHome /> Главная
          </button>
          <button
            type="button"
            className={`nav-btn${view === 'search' ? ' active' : ''}`}
            onClick={() => nav('search')}
          >
            <IconSearch /> Поиск
          </button>
          <button
            type="button"
            className={`nav-btn${view === 'tracks' ? ' active' : ''}`}
            onClick={() => nav('tracks')}
          >
            <IconLibrary /> Треки
          </button>
          <button
            type="button"
            className={`nav-btn${view === 'artists' ? ' active' : ''}`}
            onClick={() => nav('artists')}
          >
            <IconUsers /> Исполнители
          </button>
          <button
            type="button"
            className={`nav-btn${view === 'albums' ? ' active' : ''}`}
            onClick={() => nav('albums')}
          >
            <IconDisc /> Альбомы
          </button>
          <button
            type="button"
            className={`nav-btn${view === 'covers' ? ' active' : ''}`}
            onClick={() => nav('covers')}
          >
            <IconImage /> Обложки
          </button>
          <button
            type="button"
            className={`nav-btn${view === 'scene' ? ' active' : ''}`}
            onClick={() => nav('scene')}
          >
            <IconScene /> Сцена
          </button>
          <div className="sidebar-footer">
            {library?.root ?? '…'}
            <div style={{ marginTop: 8 }}>{library ? `${library.tracks.length} файлов` : ''}</div>
          </div>
        </aside>

        <main className={`main${view === 'scene' ? ' main-scene' : ''}`}>
          <div className="main-top">
            <div className="search-box">
              <IconSearch />
              <input
                value={query}
                placeholder="Что хотите послушать?"
                onChange={(e) => openSearch(e.target.value)}
                onFocus={() => setView('search')}
              />
            </div>
            <div className="top-actions">
              {view === 'scene' && (
                <>
                  <button
                    type="button"
                    className={`ghost-btn${wallpaperOn ? ' ghost-btn-on' : ''}`}
                    disabled={wallpaperBusy}
                    onClick={() => void toggleWallpaper()}
                    title="Живые обои рабочего стола"
                  >
                    {wallpaperBusy ? '…' : wallpaperOn ? 'Обои вкл' : 'На рабочий стол'}
                  </button>
                  <button
                    type="button"
                    className={`ghost-btn${desktopHidden ? ' ghost-btn-on' : ''}`}
                    onClick={() => void toggleDesktopHide()}
                    title="Скрыть иконки и панель задач (Ctrl+Shift+Alt+D)"
                  >
                    {desktopHidden ? 'Показать стол' : 'Скрыть стол'}
                  </button>
                </>
              )}
              {view !== 'scene' && (
                <button type="button" className="ghost-btn" onClick={() => nav('scene')}>
                  Сцена
                </button>
              )}
              <button type="button" className="ghost-btn" onClick={() => void pickFolder()}>
                Папка…
              </button>
              <button type="button" className="ghost-btn" onClick={() => void scan(true)}>
                Обновить
              </button>
            </div>
          </div>
          {view === 'scene' && desktopHidden && (
            <div className="wallpaper-hint">Стол скрыт · вернуть: Ctrl+Shift+Alt+D или кнопка «Показать стол»</div>
          )}
          {wallpaperError && view === 'scene' && (
            <div className="wallpaper-error">{wallpaperError}</div>
          )}
          <div className="content">{renderContent()}</div>
          {loading && (
            <div className="loading-overlay">
              <div className="loading-card">
                <div className="spinner" />
                <strong>Сканирование библиотеки</strong>
                <p>
                  {progress && progress.total
                    ? `${progress.done} / ${progress.total}`
                    : 'Чтение метаданных…'}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      <PlayerBar
        current={player.current}
        playing={player.playing}
        currentTime={player.currentTime}
        duration={player.duration || player.current?.duration || 0}
        volume={player.volume}
        muted={player.muted}
        repeat={player.repeat}
        shuffle={player.shuffle}
        queueLabel={player.queue.label}
        onToggle={() => void player.toggle()}
        onNext={player.next}
        onPrev={player.prev}
        onSeek={player.seek}
        onSeekEnd={player.seekEnd}
        onVolume={(v) => {
          player.setMuted(false)
          player.setVolume(v)
        }}
        onMute={() => player.setMuted(!player.muted)}
        onCycleRepeat={player.cycleRepeat}
        onToggleShuffle={() => player.setShuffle(!player.shuffle)}
      />
    </div>
  )
}
