export type Track = {
  id: string
  path: string
  fileUrl: string
  title: string
  artist: string
  album: string
  duration: number
  year: number | null
  coverDataUrl: string | null
  coverHash: string | null
  mtime: number
  size: number
}

export type Artist = {
  id: string
  name: string
  trackIds: string[]
  coverDataUrl: string | null
}

export type Album = {
  id: string
  name: string
  artist: string
  trackIds: string[]
  coverDataUrl: string | null
}

export type CoverCluster = {
  id: string
  name: string
  coverDataUrl: string | null
  trackIds: string[]
  count: number
}

export type Library = {
  root: string
  scannedAt: number
  tracks: Track[]
  artists: Artist[]
  albums: Album[]
  coverClusters: CoverCluster[]
}

export type ViewId = 'home' | 'tracks' | 'artists' | 'albums' | 'covers' | 'search' | 'detail' | 'scene'

export type RepeatMode = 'off' | 'one' | 'all'

export type PlayerAPI = {
  getRoot: () => Promise<string>
  pickFolder: () => Promise<string | null>
  scan: (opts?: { force?: boolean }) => Promise<Library>
  mediaUrl: (filePath: string) => Promise<string>
  onProgress: (cb: (p: { done: number; total: number }) => void) => () => void
  onMediaCommand: (cb: (cmd: 'toggle' | 'next' | 'previous' | 'stop') => void) => () => void
  wallpaperEnable: () => Promise<{ ok: boolean; error?: string }>
  wallpaperDisable: () => Promise<{ ok: boolean }>
  wallpaperIsEnabled: () => Promise<boolean>
  setDesktopChromeVisible: (visible: boolean) => Promise<{ ok: boolean; hidden: boolean; error?: string }>
  toggleDesktopChrome: () => Promise<{ ok: boolean; hidden: boolean; error?: string }>
  isDesktopChromeHidden: () => Promise<boolean>
  onDesktopChrome: (cb: (data: { hidden: boolean }) => void) => () => void
  sendWallpaperSync: (sync: {
    mediaUrl: string | null
    playing: boolean
    currentTime: number
    title: string
    artist: string
  }) => void
  sendWallpaperFrame: (frame: {
    bass: number
    mid: number
    treble: number
    energy: number
    beat: number
    bands: number[]
  }) => void
  sendWallpaperMeta: (meta: { title: string; artist: string; playing: boolean }) => void
  onWallpaperSync: (
    cb: (sync: {
      mediaUrl: string | null
      playing: boolean
      currentTime: number
      title: string
      artist: string
    }) => void,
  ) => () => void
  onWallpaperFrame: (
    cb: (frame: {
      bass: number
      mid: number
      treble: number
      energy: number
      beat: number
      bands: number[]
    }) => void,
  ) => () => void
  onWallpaperMeta: (cb: (meta: { title: string; artist: string; playing: boolean }) => void) => () => void
}

declare global {
  interface Window {
    playerAPI: PlayerAPI
  }
}

export {}
