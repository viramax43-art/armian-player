export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export function normalizeQuery(q: string) {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export function fuzzyMatch(hay: string, needle: string) {
  const h = normalizeQuery(hay)
  const n = normalizeQuery(needle)
  if (!n) return true
  if (h.includes(n)) return true
  // subsequence match for typos / partial
  let i = 0
  for (const ch of h) {
    if (ch === n[i]) i++
    if (i >= n.length) return true
  }
  return false
}

export function searchLibrary(
  tracks: { id: string; title: string; artist: string; album: string }[],
  artists: { id: string; name: string }[],
  albums: { id: string; name: string; artist: string }[],
  query: string,
) {
  const q = query.trim()
  if (!q) return { tracks: [], artists: [], albums: [] }
  return {
    tracks: tracks.filter(
      (t) => fuzzyMatch(t.title, q) || fuzzyMatch(t.artist, q) || fuzzyMatch(t.album, q),
    ),
    artists: artists.filter((a) => fuzzyMatch(a.name, q)),
    albums: albums.filter((a) => fuzzyMatch(a.name, q) || fuzzyMatch(a.artist, q)),
  }
}
