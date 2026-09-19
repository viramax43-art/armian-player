/**
 * Convert car cutout JPEG-with-black-bg → PNG with real alpha.
 * Usage: node scripts/cut-car-bg.mjs [input] [output]
 */
import fs from 'fs'
import path from 'path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const input = process.argv[2] || path.join(__dirname, '../src/assets/scene/car.png')
const output = process.argv[3] || path.join(__dirname, '../src/assets/scene/car.png')

const buf = fs.readFileSync(input)
const isPng = buf[0] === 0x89 && buf[1] === 0x50
let w, h, data

if (isPng) {
  const png = PNG.sync.read(buf)
  w = png.width
  h = png.height
  data = png.data
} else {
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
  w = raw.width
  h = raw.height
  data = raw.data
}

const thresh = 18
const alpha = new Uint8Array(w * h)
alpha.fill(255)
const visited = new Uint8Array(w * h)
const stack = []

function isBg(i) {
  return Math.max(data[i], data[i + 1], data[i + 2]) <= thresh
}

function push(x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const p = y * w + x
  if (visited[p]) return
  visited[p] = 1
  if (!isBg(p * 4)) return
  stack.push(p)
}

for (let x = 0; x < w; x++) {
  push(x, 0)
  push(x, h - 1)
}
for (let y = 0; y < h; y++) {
  push(0, y)
  push(w - 1, y)
}

while (stack.length) {
  const p = stack.pop()
  alpha[p] = 0
  const x = p % w
  const y = (p / w) | 0
  push(x + 1, y)
  push(x - 1, y)
  push(x, y + 1)
  push(x, y - 1)
}

const soft = new Uint8Array(alpha)
for (let y = 1; y < h - 1; y++) {
  for (let x = 1; x < w - 1; x++) {
    const p = y * w + x
    if (alpha[p] === 0) continue
    let near = 0
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]) {
      if (alpha[(y + dy) * w + (x + dx)] === 0) near++
    }
    if (!near) continue
    const i = p * 4
    const mx = Math.max(data[i], data[i + 1], data[i + 2])
    if (mx < 40) soft[p] = Math.max(0, 255 - near * 40 - (40 - mx) * 4)
    else if (near >= 3) soft[p] = Math.max(120, 255 - near * 25)
  }
}

const png = new PNG({ width: w, height: h })
for (let p = 0; p < w * h; p++) {
  const i = p * 4
  png.data[i] = data[i]
  png.data[i + 1] = data[i + 1]
  png.data[i + 2] = data[i + 2]
  png.data[i + 3] = soft[p]
}
fs.writeFileSync(output, PNG.sync.write(png))
console.log('OK', output)
