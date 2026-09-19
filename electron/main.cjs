const { app, BrowserWindow, ipcMain, dialog, protocol, shell, screen, powerSaveBlocker, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')
const { Readable } = require('stream')
const { pathToFileURL } = require('url')
const { scanLibrary, getCachePath } = require('./library.cjs')
const {
  attachAsWallpaper,
  detachWallpaper,
  elevateWallpaperImmersive,
  restoreWallpaperLayer,
  setDesktopChromeVisible,
  toggleDesktopChrome,
  isDesktopChromeHidden,
  ensureDesktopChromeVisible,
} = require('./wallpaper-host.cjs')

// Media keys → SMTC
app.commandLine.appendSwitch(
  'enable-features',
  'HardwareMediaKeyHandling,MediaSessionService,WindowsMediaSessionService',
)
// Keep timers / audio analysis alive when main window is minimized
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.opus'])

const MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      bypassCSP: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
      standard: true,
    },
  },
])

const APP_ID = 'com.armian.player'
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID)
}

let mainWindow = null
let wallpaperWindow = null
let wallpaperEnabled = false
let libraryRoot = null
let displayMetricsHandler = null
let powerBlockerId = null

function loadSettings() {
  try {
    const p = path.join(app.getPath('userData'), 'settings.json')
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    /* ignore */
  }
  return {}
}

function saveSettings(patch) {
  try {
    const p = path.join(app.getPath('userData'), 'settings.json')
    const cur = loadSettings()
    fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }))
  } catch {
    /* ignore */
  }
}

function loadSavedRoot() {
  const s = loadSettings()
  if (s.root && fs.existsSync(s.root)) return s.root
  return null
}

function saveRoot(root) {
  saveSettings({ root })
}

function defaultMusicRoot() {
  const saved = loadSavedRoot()
  if (saved) return saved

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  const candidates = []

  if (portableDir) {
    candidates.push(path.join(portableDir, 'music'))
    candidates.push(portableDir)
    candidates.push(path.dirname(portableDir))
    candidates.push(path.resolve(portableDir, '..', '..'))
  }

  if (app.isPackaged) {
    const exeDir = path.dirname(process.execPath)
    candidates.push(path.join(exeDir, 'music'), exeDir, path.dirname(exeDir))
  } else {
    candidates.push(path.resolve(__dirname, '..', '..'))
  }

  for (const dir of candidates) {
    try {
      if (!dir || !fs.existsSync(dir)) continue
      const hasAudio = fs.readdirSync(dir).some((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
      if (hasAudio) return dir
    } catch {
      /* skip */
    }
  }

  return portableDir || (app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..', '..'))
}

/**
 * Start Menu shortcut with AppUserModelID — required for Windows to route
 * Samsung Buds AVRCP / SMTC buttons to this app instead of another player.
 */
function ensureWindowsShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return
  try {
    const programs = app.getPath('programs')
    const shortcutPath = path.join(programs, 'Armian Player.lnk')
    const target = process.execPath
    // Portable launcher extracts to TEMP; prefer PORTABLE_EXECUTABLE_DIR target if present
    const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
    const portableExe = portableRoot ? path.join(portableRoot, 'ArmianPlayer.exe') : null
    const linkTarget =
      portableExe && fs.existsSync(portableExe) ? portableExe : target

    shell.writeShortcutLink(shortcutPath, {
      target: linkTarget,
      cwd: path.dirname(linkTarget),
      appUserModelId: APP_ID,
      description: 'Armian Player',
    })
  } catch (err) {
    console.warn('Shortcut create failed:', err)
  }
}

function resolveMediaPath(requestUrl) {
  const u = new URL(requestUrl)
  let filePath = decodeURIComponent(u.pathname)
  if (filePath.startsWith('/') && /^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1)
  }
  return path.normalize(filePath)
}

function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    try {
      const filePath = resolveMediaPath(request.url)
      if (!fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 })
      }

      const stat = fs.statSync(filePath)
      const size = stat.size
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
      const range = request.headers.get('Range') || request.headers.get('range')

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        if (!m) {
          return new Response('Invalid range', { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        }
        let start = m[1] !== '' ? parseInt(m[1], 10) : 0
        let end = m[2] !== '' ? parseInt(m[2], 10) : size - 1
        if (!Number.isFinite(start)) start = 0
        if (!Number.isFinite(end) || end >= size) end = size - 1
        if (start < 0 || start > end || start >= size) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` },
          })
        }

        const chunkSize = end - start + 1
        const nodeStream = fs.createReadStream(filePath, { start, end })
        return new Response(Readable.toWeb(nodeStream), {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
          },
        })
      }

      const nodeStream = fs.createReadStream(filePath)
      return new Response(Readable.toWeb(nodeStream), {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (err) {
      return new Response(String(err), { status: 500 })
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#121212',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#121212',
      symbolColor: '#b3b3b3',
      height: 36,
    },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  try {
    mainWindow.webContents.setBackgroundThrottling(false)
  } catch {
    /* older electron */
  }

  // With live wallpaper: don't stay minimized — hide to tray-like state
  mainWindow.on('minimize', () => {
    if (!wallpaperEnabled) return
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && wallpaperEnabled) {
        mainWindow.restore()
        mainWindow.hide()
      }
    }, 0)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    void disableWallpaper()
  })
}

function getWallpaperUrl() {
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) return `${devUrl.replace(/\/$/, '')}/wallpaper.html`
  return null
}

async function enableWallpaper() {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Только Windows' }
  }
  if (wallpaperEnabled && wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    return { ok: true }
  }

  const display = screen.getPrimaryDisplay()
  const { x, y, width, height } = display.bounds

  wallpaperWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    show: false,
    transparent: false,
    backgroundColor: '#000000',
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    fullscreen: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      offscreen: false,
    },
  })

  wallpaperWindow.setIgnoreMouseEvents(true, { forward: true })
  wallpaperWindow.setMenuBarVisibility(false)
  try {
    wallpaperWindow.webContents.setBackgroundThrottling(false)
    wallpaperWindow.webContents.setFrameRate(60)
  } catch {
    /* ignore */
  }

  const url = getWallpaperUrl()
  if (url) {
    await wallpaperWindow.loadURL(url)
  } else {
    await wallpaperWindow.loadFile(path.join(__dirname, '..', 'dist', 'wallpaper.html'))
  }

  // Show then attach behind icons
  wallpaperWindow.showInactive()
  try {
    attachAsWallpaper(wallpaperWindow, { x, y, width, height })
  } catch (err) {
    console.error('Wallpaper attach failed:', err)
    try {
      wallpaperWindow.destroy()
    } catch {
      /* ignore */
    }
    wallpaperWindow = null
    wallpaperEnabled = false
    return { ok: false, error: String(err?.message || err) }
  }

  wallpaperEnabled = true
  saveSettings({ wallpaper: true })

  if (powerBlockerId == null) {
    try {
      powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    } catch {
      powerBlockerId = null
    }
  }

  if (displayMetricsHandler) {
    try {
      screen.off('display-metrics-changed', displayMetricsHandler)
    } catch {
      /* ignore */
    }
  }
  displayMetricsHandler = () => {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return
    const b = screen.getPrimaryDisplay().bounds
    try {
      if (isDesktopChromeHidden()) {
        elevateWallpaperImmersive(wallpaperWindow, b)
      } else {
        attachAsWallpaper(wallpaperWindow, b)
      }
    } catch (e) {
      console.warn('Wallpaper re-attach:', e)
    }
  }
  screen.on('display-metrics-changed', displayMetricsHandler)

  // If chrome already hidden (hotkey before wallpaper), lift immediately
  if (isDesktopChromeHidden()) {
    try {
      elevateWallpaperImmersive(wallpaperWindow, { x, y, width, height })
    } catch {
      /* ignore */
    }
  }

  return { ok: true }
}

/** Cover full screen (taskbar gap + Activate Windows) when immersing; re-layer when restoring. */
function syncImmersiveWallpaper(hidden) {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return
  const b = screen.getPrimaryDisplay().bounds
  try {
    if (hidden) {
      elevateWallpaperImmersive(wallpaperWindow, b)
    } else {
      restoreWallpaperLayer(wallpaperWindow, b)
    }
  } catch (err) {
    console.warn('Immersive wallpaper sync:', err)
  }
}

function syncMainWindowForImmersive(hidden) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.send('desktop:chrome', { hidden })
  } catch {
    /* ignore */
  }
  try {
    if (hidden) mainWindow.hide()
    else mainWindow.show()
  } catch {
    /* ignore */
  }
}

function applyDesktopChromeVisible(visible) {
  const res = setDesktopChromeVisible(visible)
  if (res.ok) {
    syncImmersiveWallpaper(res.hidden)
    syncMainWindowForImmersive(res.hidden)
  }
  return res
}

async function applyToggleDesktopChrome() {
  // Need a fullscreen cover window to hide taskbar gap + watermark
  if (!isDesktopChromeHidden() && !wallpaperEnabled) {
    try {
      await enableWallpaper()
    } catch (err) {
      console.warn('Auto-enable wallpaper for immersive:', err)
    }
  }
  const res = toggleDesktopChrome()
  if (res.ok) {
    syncImmersiveWallpaper(res.hidden)
    syncMainWindowForImmersive(res.hidden)
  }
  return res
}

async function disableWallpaper() {
  wallpaperEnabled = false
  saveSettings({ wallpaper: false })
  ensureDesktopChromeVisible()
  if (powerBlockerId != null) {
    try {
      powerSaveBlocker.stop(powerBlockerId)
    } catch {
      /* ignore */
    }
    powerBlockerId = null
  }
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    try {
      detachWallpaper(wallpaperWindow)
    } catch {
      /* ignore */
    }
    wallpaperWindow.destroy()
  }
  wallpaperWindow = null
  return { ok: true }
}

app.whenReady().then(async () => {
  registerMediaProtocol()
  libraryRoot = defaultMusicRoot()
  ensureWindowsShortcut()
  createWindow()

  // Immersive toggle even when player is hidden — restore taskbar/icons
  try {
    globalShortcut.register('CommandOrControl+Shift+Alt+D', () => {
      void applyToggleDesktopChrome()
    })
  } catch (err) {
    console.warn('Hotkey register failed:', err)
  }

  const settings = loadSettings()
  if (settings.wallpaper && process.platform === 'win32') {
    setTimeout(() => {
      void enableWallpaper()
    }, 1500)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  ensureDesktopChromeVisible()
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* ignore */
  }
})

app.on('before-quit', () => {
  ensureDesktopChromeVisible()
  void disableWallpaper()
})

app.on('window-all-closed', () => {
  void disableWallpaper()
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('library:getRoot', () => libraryRoot)

ipcMain.handle('library:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Выберите папку с музыкой',
  })
  if (result.canceled || !result.filePaths[0]) return null
  libraryRoot = result.filePaths[0]
  saveRoot(libraryRoot)
  return libraryRoot
})

ipcMain.handle('library:scan', async (_evt, { force } = {}) => {
  const root = libraryRoot || defaultMusicRoot()
  libraryRoot = root
  saveRoot(root)
  const cachePath = getCachePath(app.getPath('userData'))
  return scanLibrary(root, {
    force: !!force,
    cachePath,
    onProgress: (p) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('library:progress', p)
      }
    },
  })
})

ipcMain.handle('library:mediaUrl', (_evt, filePath) => {
  const normalized = path.normalize(filePath).replace(/\\/g, '/')
  return `media://local/${encodeURI(normalized)}`
})

ipcMain.handle('library:fileUrl', (_evt, filePath) => pathToFileURL(path.normalize(filePath)).href)

ipcMain.handle('wallpaper:enable', () => enableWallpaper())
ipcMain.handle('wallpaper:disable', () => disableWallpaper())
ipcMain.handle('wallpaper:isEnabled', () => wallpaperEnabled)

ipcMain.handle('desktop:setChromeVisible', async (_e, visible) => {
  if (!visible && !wallpaperEnabled) {
    try {
      await enableWallpaper()
    } catch {
      /* ignore */
    }
  }
  return applyDesktopChromeVisible(!!visible)
})
ipcMain.handle('desktop:toggleChrome', () => applyToggleDesktopChrome())
ipcMain.handle('desktop:isChromeHidden', () => isDesktopChromeHidden())

ipcMain.on('wallpaper:sync', (_evt, sync) => {
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    wallpaperWindow.webContents.send('wallpaper:sync', sync)
  }
})

ipcMain.on('wallpaper:frame', (_evt, frame) => {
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    wallpaperWindow.webContents.send('wallpaper:frame', frame)
  }
})

ipcMain.on('wallpaper:meta', (_evt, meta) => {
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    wallpaperWindow.webContents.send('wallpaper:meta', meta)
  }
})

ipcMain.handle('app:showMain', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
})

