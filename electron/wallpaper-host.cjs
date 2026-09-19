/**
 * Attach an Electron BrowserWindow behind desktop icons (WorkerW / Progman).
 * Windows only — uses koffi → user32.
 * Avoids EnumWindows callbacks (fragile across koffi versions).
 */
const koffi = require('koffi')

const user32 = koffi.load('user32.dll')

const FindWindowA = user32.func('uintptr __stdcall FindWindowA(str lpClassName, str lpWindowName)')
const FindWindowW = user32.func('uintptr __stdcall FindWindowW(str16 lpClassName, str16 lpWindowName)')
const FindWindowExA = user32.func(
  'uintptr __stdcall FindWindowExA(uintptr hWndParent, uintptr hWndChildAfter, str lpszClass, str lpszWindow)',
)
const SendMessageTimeoutA = user32.func(
  'uintptr __stdcall SendMessageTimeoutA(uintptr hWnd, uint32 Msg, uintptr wParam, intptr lParam, uint32 fuFlags, uint32 uTimeout, uintptr lpdwResult)',
)
const SetParent = user32.func('uintptr __stdcall SetParent(uintptr hWndChild, uintptr hWndNewParent)')
const SetWindowPos = user32.func(
  'bool __stdcall SetWindowPos(uintptr hWnd, uintptr hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)',
)
const ShowWindow = user32.func('bool __stdcall ShowWindow(uintptr hWnd, int nCmdShow)')
const UpdateWindow = user32.func('bool __stdcall UpdateWindow(uintptr hWnd)')
const SystemParametersInfoW = user32.func(
  'bool __stdcall SystemParametersInfoW(uint32 uiAction, uint32 uiParam, uintptr pvParam, uint32 fWinIni)',
)
const IsWindow = user32.func('bool __stdcall IsWindow(uintptr hWnd)')
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(uintptr hWnd)')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(uintptr hWnd, uint16* lpString, int nMaxCount)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(uintptr hWnd)')

const SMTO_NORMAL = 0
const SWP_NOZORDER = 0x0004
const SWP_NOACTIVATE = 0x0010
const SWP_SHOWWINDOW = 0x0040
const SPI_SETDESKWALLPAPER = 0x0014
const SW_HIDE = 0
const SW_SHOW = 5
const HWND_TOPMOST = -1n
const HWND_NOTOPMOST = -2n

let desktopChromeHidden = false
/** @type {bigint[]} */
let hiddenWatermarkHwnds = []

function collectDesktopIconViews() {
  const views = []

  const tryAddListView = (defView) => {
    if (!defView) return
    const list = u(FindWindowExA(defView, 0n, 'SysListView32', null))
    if (list && IsWindow(list)) views.push(list)
  }

  // Progman → SHELLDLL_DefView → SysListView32
  const progman = u(FindWindowA('Progman', null))
  if (progman) {
    tryAddListView(u(FindWindowExA(progman, 0n, 'SHELLDLL_DefView', null)))
  }

  // WorkerW hosts (icons often live here on Win10)
  let worker = u(FindWindowExA(0n, 0n, 'WorkerW', null))
  let guard = 0
  while (worker && guard++ < 40) {
    tryAddListView(u(FindWindowExA(worker, 0n, 'SHELLDLL_DefView', null)))
    worker = u(FindWindowExA(0n, worker, 'WorkerW', null))
  }

  return views
}

function collectTaskbars() {
  const bars = []
  const primary = u(FindWindowA('Shell_TrayWnd', null))
  if (primary) bars.push(primary)

  let sec = u(FindWindowExA(0n, 0n, 'Shell_SecondaryTrayWnd', null))
  let guard = 0
  while (sec && guard++ < 8) {
    bars.push(sec)
    sec = u(FindWindowExA(0n, sec, 'Shell_SecondaryTrayWnd', null))
  }

  const overflow = u(FindWindowA('NotifyIconOverflowWindow', null))
  if (overflow) bars.push(overflow)

  // Peek / thumbnail strip near taskbar
  for (const cls of ['TaskListThumbnailWnd', 'Shell_DragImage', 'DV2ControlHost']) {
    const h = u(FindWindowA(cls, null))
    if (h) bars.push(h)
  }

  return bars
}

function readWide(fn, hwnd, maxLen) {
  const len = Math.max(1, Math.min(maxLen, 512))
  const buf = Buffer.alloc(len * 2)
  const n = fn(hwnd, buf, len)
  if (!n || n <= 0) return ''
  return buf.toString('utf16le', 0, n * 2).replace(/\0+$/, '')
}

function isActivationWatermarkTitle(title) {
  if (!title) return false
  const t = title.toLowerCase()
  return (
    t.includes('activate windows') ||
    t.includes('активация windows') ||
    t.includes('activation') ||
    (t.includes('activate') && t.includes('windows'))
  )
}

/**
 * Collect "Activate Windows" / licensing watermark HWNDs (and similar overlays).
 * Prefer FindWindow — EnumWindows callbacks are fragile with koffi on some builds.
 */
function collectActivationWatermarks() {
  const found = new Set()

  const add = (hwnd) => {
    const h = u(hwnd)
    if (h && IsWindow(h)) found.add(h.toString())
  }

  for (const title of ['Activate Windows', 'Активация Windows']) {
    try {
      add(FindWindowW(null, title))
    } catch {
      /* ignore */
    }
    try {
      add(FindWindowA(null, title))
    } catch {
      /* ignore */
    }
  }

  // Walk a few top-level peers after Progman for titled watermark hosts
  try {
    let hwnd = u(FindWindowExA(0n, 0n, null, null))
    let guard = 0
    while (hwnd && guard++ < 120) {
      try {
        if (IsWindowVisible(hwnd)) {
          const titleLen = GetWindowTextLengthW(hwnd)
          if (titleLen > 0 && titleLen < 80) {
            const title = readWide(GetWindowTextW, hwnd, titleLen + 2)
            if (isActivationWatermarkTitle(title)) add(hwnd)
          }
        }
      } catch {
        /* ignore */
      }
      hwnd = u(FindWindowExA(0n, hwnd, null, null))
    }
  } catch {
    /* ignore */
  }

  return [...found].map((s) => BigInt(s))
}

function setWatermarkWindowsVisible(visible) {
  if (visible) {
    for (const hwnd of hiddenWatermarkHwnds) {
      try {
        if (IsWindow(hwnd)) ShowWindow(hwnd, SW_SHOW)
      } catch {
        /* ignore */
      }
    }
    hiddenWatermarkHwnds = []
    return
  }

  hiddenWatermarkHwnds = collectActivationWatermarks()
  for (const hwnd of hiddenWatermarkHwnds) {
    try {
      ShowWindow(hwnd, SW_HIDE)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pull wallpaper out of WorkerW and pin it topmost fullscreen —
 * covers taskbar gap + Activate Windows watermark.
 */
function elevateWallpaperImmersive(browserWindow, bounds) {
  if (process.platform !== 'win32' || !browserWindow || browserWindow.isDestroyed()) return
  const hwnd = hwndFromBuffer(browserWindow.getNativeWindowHandle())
  if (!hwnd) return

  const { x, y, width, height } = bounds
  try {
    SetParent(hwnd, 0n)
  } catch {
    /* ignore */
  }

  try {
    browserWindow.setAlwaysOnTop(true, 'screen-saver')
  } catch {
    try {
      browserWindow.setAlwaysOnTop(true)
    } catch {
      /* ignore */
    }
  }

  try {
    browserWindow.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    })
  } catch {
    /* ignore */
  }

  SetWindowPos(
    hwnd,
    HWND_TOPMOST,
    Math.round(x),
    Math.round(y),
    Math.round(width),
    Math.round(height),
    SWP_SHOWWINDOW | SWP_NOACTIVATE,
  )
  ShowWindow(hwnd, SW_SHOW)
  UpdateWindow(hwnd)
  try {
    browserWindow.showInactive()
  } catch {
    /* ignore */
  }
}

/**
 * Return wallpaper under desktop icons (WorkerW) after immersive mode.
 */
function restoreWallpaperLayer(browserWindow, bounds) {
  if (process.platform !== 'win32' || !browserWindow || browserWindow.isDestroyed()) return
  try {
    browserWindow.setAlwaysOnTop(false)
  } catch {
    /* ignore */
  }
  const hwnd = hwndFromBuffer(browserWindow.getNativeWindowHandle())
  if (hwnd) {
    try {
      // SWP_NOSIZE | SWP_NOMOVE — drop topmost without moving
      SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | SWP_NOACTIVATE)
    } catch {
      /* ignore */
    }
  }
  attachAsWallpaper(browserWindow, bounds)
}

/**
 * Hide / show desktop icons + taskbar(s) + activation watermark for immersion.
 * Restore with the same call or Ctrl+Shift+Alt+D.
 */
function setDesktopChromeVisible(visible) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Только Windows', hidden: false }
  }

  const cmd = visible ? SW_SHOW : SW_HIDE

  for (const hwnd of collectDesktopIconViews()) {
    try {
      ShowWindow(hwnd, cmd)
    } catch {
      /* ignore */
    }
  }
  for (const hwnd of collectTaskbars()) {
    try {
      ShowWindow(hwnd, cmd)
    } catch {
      /* ignore */
    }
  }

  try {
    setWatermarkWindowsVisible(visible)
  } catch {
    /* ignore */
  }

  desktopChromeHidden = !visible
  return { ok: true, hidden: desktopChromeHidden }
}

function toggleDesktopChrome() {
  return setDesktopChromeVisible(desktopChromeHidden)
}

function isDesktopChromeHidden() {
  return desktopChromeHidden
}

function ensureDesktopChromeVisible() {
  if (desktopChromeHidden) setDesktopChromeVisible(true)
}

function hwndFromBuffer(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return 0n
  if (buf.length >= 8) return buf.readBigUInt64LE(0)
  return BigInt(buf.readUInt32LE(0))
}

function u(hwnd) {
  if (hwnd == null || hwnd === 0 || hwnd === 0n) return 0n
  return typeof hwnd === 'bigint' ? hwnd : BigInt(hwnd)
}

function spawnWorkerW() {
  const progman = u(FindWindowA('Progman', null))
  if (!progman) throw new Error('Progman not found')

  // Undocumented: create the WorkerW wallpaper layer under the desktop
  SendMessageTimeoutA(progman, 0x052c, 0xdn, 0x1n, SMTO_NORMAL, 1000, 0)
  SendMessageTimeoutA(progman, 0x052c, 0n, 0n, SMTO_NORMAL, 1000, 0)

  return progman
}

/**
 * Classic Win10 layout:
 *   Progman
 *   WorkerW  ← contains SHELLDLL_DefView (icons)
 *   WorkerW  ← empty sibling BEHIND icons (wallpaper surface)
 */
function findWallpaperTarget() {
  const progman = spawnWorkerW()

  // Walk all top-level WorkerW windows
  let worker = u(FindWindowExA(0n, 0n, 'WorkerW', null))
  let workerWithIcons = 0n
  let workerBehind = 0n

  while (worker) {
    const defView = u(FindWindowExA(worker, 0n, 'SHELLDLL_DefView', null))
    if (defView) {
      workerWithIcons = worker
      // Next WorkerW after the icons host is the wallpaper canvas
      workerBehind = u(FindWindowExA(0n, worker, 'WorkerW', null))
      break
    }
    worker = u(FindWindowExA(0n, worker, 'WorkerW', null))
  }

  if (workerBehind && IsWindow(workerBehind)) return workerBehind

  // Win10 sometimes nests WorkerW under Progman
  let child = u(FindWindowExA(progman, 0n, 'WorkerW', null))
  while (child) {
    const hasDef = u(FindWindowExA(child, 0n, 'SHELLDLL_DefView', null))
    if (!hasDef && IsWindow(child)) return child
    child = u(FindWindowExA(progman, child, 'WorkerW', null))
  }

  // DefView directly under Progman (some Win11 builds)
  const defUnderProgman = u(FindWindowExA(progman, 0n, 'SHELLDLL_DefView', null))
  if (defUnderProgman) return progman

  if (workerWithIcons && IsWindow(workerWithIcons)) {
    // Last resort: parent under the icons WorkerW (may cover icons — avoid if possible)
    const next = u(FindWindowExA(0n, workerWithIcons, 'WorkerW', null))
    if (next && IsWindow(next)) return next
  }

  // Any WorkerW at all
  const any = u(FindWindowExA(0n, 0n, 'WorkerW', null))
  if (any && IsWindow(any)) return any

  throw new Error('WorkerW not found — слой обоев рабочего стола недоступен')
}

function attachAsWallpaper(browserWindow, bounds) {
  if (process.platform !== 'win32') {
    throw new Error('Live wallpaper is Windows-only')
  }

  const hwnd = hwndFromBuffer(browserWindow.getNativeWindowHandle())
  if (!hwnd) throw new Error('Invalid window handle')

  const parent = findWallpaperTarget()
  const prev = SetParent(hwnd, parent)
  if (!prev && !IsWindow(hwnd)) {
    throw new Error('SetParent failed')
  }

  const { x, y, width, height } = bounds
  SetWindowPos(
    hwnd,
    0n,
    Math.round(x),
    Math.round(y),
    Math.round(width),
    Math.round(height),
    SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW,
  )
  ShowWindow(hwnd, SW_SHOW)
  UpdateWindow(hwnd)

  return { hwnd: hwnd.toString(), parent: parent.toString() }
}

function detachWallpaper(browserWindow) {
  if (process.platform !== 'win32' || !browserWindow || browserWindow.isDestroyed()) return
  try {
    const hwnd = hwndFromBuffer(browserWindow.getNativeWindowHandle())
    SetParent(hwnd, 0n)
  } catch {
    /* ignore */
  }
  try {
    SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, 0n, 0x01 | 0x02)
  } catch {
    /* ignore */
  }
}

module.exports = {
  attachAsWallpaper,
  detachWallpaper,
  hwndFromBuffer,
  elevateWallpaperImmersive,
  restoreWallpaperLayer,
  setDesktopChromeVisible,
  toggleDesktopChrome,
  isDesktopChromeHidden,
  ensureDesktopChromeVisible,
}
