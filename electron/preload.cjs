const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('playerAPI', {
  getRoot: () => ipcRenderer.invoke('library:getRoot'),
  pickFolder: () => ipcRenderer.invoke('library:pickFolder'),
  scan: (opts) => ipcRenderer.invoke('library:scan', opts),
  mediaUrl: (filePath) => ipcRenderer.invoke('library:mediaUrl', filePath),
  onProgress: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('library:progress', handler)
    return () => ipcRenderer.removeListener('library:progress', handler)
  },
  onMediaCommand: (cb) => {
    const handler = (_e, cmd) => cb(cmd)
    ipcRenderer.on('media:command', handler)
    return () => ipcRenderer.removeListener('media:command', handler)
  },

  // Live wallpaper
  wallpaperEnable: () => ipcRenderer.invoke('wallpaper:enable'),
  wallpaperDisable: () => ipcRenderer.invoke('wallpaper:disable'),
  wallpaperIsEnabled: () => ipcRenderer.invoke('wallpaper:isEnabled'),
  setDesktopChromeVisible: (visible) => ipcRenderer.invoke('desktop:setChromeVisible', visible),
  toggleDesktopChrome: () => ipcRenderer.invoke('desktop:toggleChrome'),
  isDesktopChromeHidden: () => ipcRenderer.invoke('desktop:isChromeHidden'),
  onDesktopChrome: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('desktop:chrome', handler)
    return () => ipcRenderer.removeListener('desktop:chrome', handler)
  },
  sendWallpaperSync: (sync) => ipcRenderer.send('wallpaper:sync', sync),
  sendWallpaperFrame: (frame) => ipcRenderer.send('wallpaper:frame', frame),
  sendWallpaperMeta: (meta) => ipcRenderer.send('wallpaper:meta', meta),
  onWallpaperSync: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('wallpaper:sync', handler)
    return () => ipcRenderer.removeListener('wallpaper:sync', handler)
  },
  onWallpaperFrame: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('wallpaper:frame', handler)
    return () => ipcRenderer.removeListener('wallpaper:frame', handler)
  },
  onWallpaperMeta: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('wallpaper:meta', handler)
    return () => ipcRenderer.removeListener('wallpaper:meta', handler)
  },
})
