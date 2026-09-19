const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { pathToFileURL } = require('url')

const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.opus'])

let parseFile = null
let nativeImage = null

async function loadDeps() {
  if (!parseFile) {
    const mm = await import('music-metadata')
    parseFile = mm.parseFile
  }
  if (!nativeImage) {
    nativeImage = require('electron').nativeImage
  }
}

function getCachePath(userData) {
  return path.join(userData, 'library-cache.json')
}

function walkAudio(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    if (ent.name === 'node_modules' || ent.name === 'player' || ent.name === 'release' || ent.name === 'dist') continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walkAudio(full, out)
    } else if (ent.isFile() && AUDIO_EXT.has(path.extname(ent.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

function cleanArtist(raw) {
  if (!raw) return 'Неизвестный исполнитель'
  return String(raw)
    .replace(/\s+/g, ' ')
    .replace(/\s*(feat\.?|ft\.?|featuring)\s+.*/i, '')
    .trim() || 'Неизвестный исполнитель'
}

function parseFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath))
  const cleaned = base
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const seps = [' - ', ' – ', ' — ', ' —']
  for (const sep of seps) {
    if (cleaned.includes(sep)) {
      const [a, ...rest] = cleaned.split(sep)
      return {
        artist: cleanArtist(a),
        title: rest.join(sep).trim() || cleaned,
      }
    }
  }
  return { artist: 'Неизвестный исполнитель', title: cleaned }
}

/** 8x8 average hash via Electron nativeImage */
function coverAHash(pictureBuffer) {
  try {
    const img = nativeImage.createFromBuffer(pictureBuffer)
    if (img.isEmpty()) return null
    const small = img.resize({ width: 8, height: 8, quality: 'better' })
    const bmp = small.toBitmap()
    // BGRA
    const grays = []
    for (let i = 0; i < 64; i++) {
      const o = i * 4
      const b = bmp[o]
      const g = bmp[o + 1]
      const r = bmp[o + 2]
      grays.push((r + g + b) / 3)
    }
    const avg = grays.reduce((a, b) => a + b, 0) / 64
    let bits = 0n
    for (let i = 0; i < 64; i++) {
      if (grays[i] >= avg) bits |= 1n << BigInt(i)
    }
    return bits.toString(16).padStart(16, '0')
  } catch {
    return null
  }
}

function hammingHex(a, b) {
  if (!a || !b) return 64
  const x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  let v = x
  while (v) {
    n++
    v &= v - 1n
  }
  return n
}

function clusterByCover(tracks, threshold = 10) {
  const withCover = tracks.filter((t) => t.coverHash)
  const used = new Set()
  const clusters = []

  for (let i = 0; i < withCover.length; i++) {
    const t = withCover[i]
    if (used.has(t.id)) continue
    const group = [t]
    used.add(t.id)
    for (let j = i + 1; j < withCover.length; j++) {
      const u = withCover[j]
      if (used.has(u.id)) continue
      if (hammingHex(t.coverHash, u.coverHash) <= threshold) {
        group.push(u)
        used.add(u.id)
      }
    }
    if (group.length >= 2) {
      const albumGuess = group.find((g) => g.album && g.album !== 'Unknown Album')?.album
      clusters.push({
        id: `cover-${t.coverHash}`,
        name: albumGuess || `Похожие обложки (${group.length})`,
        coverDataUrl: group.find((g) => g.coverDataUrl)?.coverDataUrl || null,
        trackIds: group.map((g) => g.id),
        count: group.length,
      })
    }
  }

  clusters.sort((a, b) => b.count - a.count)
  return clusters
}

function aggregate(tracks) {
  const artistsMap = new Map()
  const albumsMap = new Map()

  for (const t of tracks) {
    const artistKey = t.artist.toLowerCase()
    if (!artistsMap.has(artistKey)) {
      artistsMap.set(artistKey, {
        id: `artist-${crypto.createHash('md5').update(artistKey).digest('hex').slice(0, 12)}`,
        name: t.artist,
        trackIds: [],
        coverDataUrl: null,
      })
    }
    const artist = artistsMap.get(artistKey)
    artist.trackIds.push(t.id)
    if (!artist.coverDataUrl && t.coverDataUrl) artist.coverDataUrl = t.coverDataUrl

    const albumName = t.album || 'Unknown Album'
    const albumKey = `${artistKey}::${albumName.toLowerCase()}`
    if (!albumsMap.has(albumKey)) {
      albumsMap.set(albumKey, {
        id: `album-${crypto.createHash('md5').update(albumKey).digest('hex').slice(0, 12)}`,
        name: albumName,
        artist: t.artist,
        trackIds: [],
        coverDataUrl: null,
      })
    }
    const album = albumsMap.get(albumKey)
    album.trackIds.push(t.id)
    if (!album.coverDataUrl && t.coverDataUrl) album.coverDataUrl = t.coverDataUrl
  }

  const artists = [...artistsMap.values()].sort((a, b) => b.trackIds.length - a.trackIds.length || a.name.localeCompare(b.name, 'ru'))
  const albums = [...albumsMap.values()]
    .filter((a) => a.trackIds.length >= 1)
    .sort((a, b) => b.trackIds.length - a.trackIds.length || a.name.localeCompare(b.name, 'ru'))

  const coverClusters = clusterByCover(tracks)

  return { artists, albums, coverClusters }
}

async function scanOne(filePath) {
  const stat = fs.statSync(filePath)
  const id = crypto.createHash('md5').update(filePath + '::' + stat.mtimeMs + '::' + stat.size).digest('hex')
  const fromName = parseFromFilename(filePath)

  let title = fromName.title
  let artist = fromName.artist
  let album = 'Unknown Album'
  let duration = 0
  let year = null
  let coverDataUrl = null
  let coverHash = null

  try {
    const meta = await parseFile(filePath, { duration: true, skipCovers: false })
    const c = meta.common
    if (c.title) title = c.title
    if (c.artist) artist = cleanArtist(c.artist)
    else if (c.artists?.length) artist = cleanArtist(c.artists[0])
    if (c.album) album = c.album
    if (c.year) year = c.year
    duration = meta.format.duration || 0

    const pic = c.picture?.[0]
    if (pic?.data) {
      const buf = Buffer.isBuffer(pic.data) ? pic.data : Buffer.from(pic.data)
      const mime = pic.format || 'image/jpeg'
      coverDataUrl = `data:${mime};base64,${buf.toString('base64')}`
      coverHash = coverAHash(buf)
    }
  } catch {
    // keep filename fallbacks
  }

  return {
    id,
    path: filePath,
    fileUrl: pathToFileURL(filePath).href,
    title,
    artist,
    album,
    duration,
    year,
    coverDataUrl,
    coverHash,
    mtime: stat.mtimeMs,
    size: stat.size,
  }
}

async function scanLibrary(root, { force = false, cachePath, onProgress } = {}) {
  await loadDeps()

  const files = walkAudio(root)
  let cache = null
  if (!force && cachePath && fs.existsSync(cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    } catch {
      cache = null
    }
  }

  const byPath = new Map((cache?.tracks || []).map((t) => [t.path, t]))
  const tracks = []
  let done = 0

  // Parallel with concurrency limit for speed
  const CONCURRENCY = 8
  let idx = 0

  async function worker() {
    while (idx < files.length) {
      const i = idx++
      const file = files[i]
      const prev = byPath.get(file)
      let track
      try {
        const st = fs.statSync(file)
        if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) {
          track = prev
        } else {
          track = await scanOne(file)
        }
      } catch {
        track = null
      }
      if (track) tracks.push(track)
      done++
      if (onProgress && done % 5 === 0) {
        onProgress({ done, total: files.length })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length || 1) }, () => worker()))
  onProgress?.({ done: files.length, total: files.length })

  tracks.sort((a, b) => a.artist.localeCompare(b.artist, 'ru') || a.album.localeCompare(b.album, 'ru') || a.title.localeCompare(b.title, 'ru'))

  const { artists, albums, coverClusters } = aggregate(tracks)
  const result = {
    root,
    scannedAt: Date.now(),
    tracks,
    artists,
    albums,
    coverClusters,
  }

  if (cachePath) {
    try {
      // Strip huge covers from disk cache? Keep them for instant UI — ~few MB is fine for 138 tracks
      fs.writeFileSync(cachePath, JSON.stringify(result))
    } catch {
      // ignore cache write errors
    }
  }

  return result
}

module.exports = { scanLibrary, getCachePath }
