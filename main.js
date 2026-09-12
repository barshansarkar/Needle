// ============================================================
//  ⚠️ GPU DISABLE MUST BE FIRST
// ============================================================
const electron = require('electron');
const { app } = electron;

app.disableHardwareAcceleration();

// ============================================================
//  PERFORMANCE FLAGS
// ============================================================
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '64');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('renderer-process-limit', '4');
app.commandLine.appendSwitch('enable-features', 'MemorySaver,HighEfficiencyModeAvailable');
app.commandLine.appendSwitch('disable-features',
  'CalculateNativeWinOcclusion,SpareRendererForSitePerProcess,AutofillServerCommunication,OptimizationHints'
);
app.commandLine.appendSwitch('js-flags',
  '--max-old-space-size=256 --lite-mode --max-semi-space-size=4 --gc-interval=100'
);

// ============================================================
//  IMPORTS
// ============================================================
const { BrowserWindow, ipcMain, Menu, clipboard, shell, session } = electron;
const path = require('path');
const https = require('https');
const { makeStore } = require('./src/data/store');

// ============================================================
//  SECURITY HELPERS
// ============================================================
const SAFE_EXTERNAL = /^(https?|mailto):/i;
const SAFE_NAV      = /^https?:/i;

function isSafeExternalUrl(url) {
  try {
    const proto = new URL(url).protocol;
    return SAFE_EXTERNAL.test(proto + ':');
  } catch { return false; }
}

function safeOpenExternal(url) {
  if (isSafeExternalUrl(url)) return shell.openExternal(url);
  console.warn('[security] blocked openExternal:', url);
}

// ============================================================
//  STATE
// ============================================================
let mainWindow = null;
let bookmarksStore, historyStore, sessionStore, settingsStore;
const downloadingItems = new Map();
const MAX_DOWNLOADS_IN_MEMORY = 50;
const MAX_HISTORY_ITEMS = 500;
const MAX_SESSION_TABS = 50;

const DEFAULT_SETTINGS = {
  homepage: 'newtab',
  searchEngine: 'duckduckgo',
  theme: 'purple',
  animations: true,
  restoreSession: true,
  showBookmarkBar: true,
};

// ============================================================
//  STORES
// ============================================================
function initStores() {
  bookmarksStore = makeStore('bookmarks.json', []);
  historyStore   = makeStore('history.json', []);
  sessionStore   = makeStore('session.json', { tabs: [] });
  settingsStore  = makeStore('settings.json', { ...DEFAULT_SETTINGS });

  // Fill missing keys (schema migration)
  let changed = false;
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (settingsStore.data[k] === undefined) {
      settingsStore.data[k] = v;
      changed = true;
    }
  }
  if (changed) settingsStore.save();
}

// ============================================================
//  WINDOW
// ============================================================
function createWindow({ private: isPrivate = false } = {}) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: true,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableBlinkFeatures: '',
      backgroundThrottling: false,
      v8CacheOptions: 'code',
      spellcheck: false,
      additionalArguments: isPrivate ? ['--nova-private=1'] : []
    }
  });

  win.loadFile('src/index.html');
  win.once('ready-to-show', () => win.show());

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details.reason);
    if (!win.isDestroyed()) win.reload();
  });

  win.webContents.on('unresponsive', () => console.warn('[unresponsive]'));

  if (!isPrivate) mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  return win;
}

// ============================================================
//  DOWNLOADS
// ============================================================
function broadcastDownloads() {
  const list = Array.from(downloadingItems.values()).reverse();
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('downloads:update', list);
  });
}

function pruneDownloads() {
  if (downloadingItems.size <= MAX_DOWNLOADS_IN_MEMORY) return;
  const excess = downloadingItems.size - MAX_DOWNLOADS_IN_MEMORY;
  const keys = Array.from(downloadingItems.keys()).slice(0, excess);
  for (const k of keys) downloadingItems.delete(k);
}

function attachDownloadListener(sess) {
  if (sess.__novaDownloadsHooked) return;
  sess.__novaDownloadsHooked = true;

  sess.on('will-download', (_e, item) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const info = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      savePath: item.getSavePath(),
      startedAt: Date.now()
    };
    downloadingItems.set(id, info);
    pruneDownloads();
    broadcastDownloads();

    item.on('updated', (_e, state) => {
      info.receivedBytes = item.getReceivedBytes();
      info.totalBytes = item.getTotalBytes();
      info.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      broadcastDownloads();
    });

    item.once('done', (_e, state) => {
      info.state = state;
      info.savePath = item.getSavePath();
      info.receivedBytes = item.getReceivedBytes();
      info.finishedAt = Date.now();
      broadcastDownloads();
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('downloads:auto-open');
      });
    });
  });
}

// ============================================================
//  SEARCH SUGGESTIONS
// ============================================================
function httpGetJson(url, timeout = 3500) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) NovaBrowser/1.0',
        'Accept': 'application/json'
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function fetchDuckDuckGo(q) {
  const data = await httpGetJson(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`);
  if (!Array.isArray(data)) return null;
  const phrases = data.map(d => (typeof d === 'string' ? d : d.phrase)).filter(Boolean);
  return phrases.length ? phrases.slice(0, 8) : null;
}

async function fetchGoogle(q) {
  const data = await httpGetJson(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`);
  if (!Array.isArray(data) || !Array.isArray(data[1])) return null;
  return data[1].slice(0, 8);
}

// ============================================================
//  SECURITY HANDLERS
// ============================================================
function installSecurityHandlers() {
  const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission);
    if (!allowed) console.log('[permission denied]', permission);
    callback(allowed);
  });

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    if (url.startsWith('javascript:') || url.startsWith('data:text/html')) {
      return callback({ cancel: true });
    }
    callback({});
  });
}

function installWebviewSanitizer() {
  app.on('web-contents-created', (_e, contents) => {
    attachDownloadListener(contents.session);

    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) {
        const w = BrowserWindow.getAllWindows()[0];
        if (w && !w.isDestroyed()) w.webContents.send('open-new-tab', url);
      }
      return { action: 'deny' };
    });

    contents.on('will-navigate', (event, url) => {
      const isTop = contents.getType() === 'webview';
      if (isTop && !SAFE_NAV.test(url) && !url.startsWith('file://')) {
        event.preventDefault();
        console.warn('[blocked nav]', url);
      }
    });

    contents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload;
      delete webPreferences.preloadURL;

      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.experimentalFeatures = false;
      webPreferences.enableBlinkFeatures = '';
      webPreferences.sandbox = false;
      webPreferences.backgroundThrottling = false;
      webPreferences.v8CacheOptions = 'code';

      const src = params.src || '';
      const isHttp     = /^https?:\/\//i.test(src);
      const isInternal = src.startsWith('file://') && src.includes('/src/pages/');

      if (!isHttp && !isInternal) {
        event.preventDefault();
        console.warn('[blocked webview]', src);
        return;
      }

      if (isInternal) {
        webPreferences.preload = path.join(__dirname, 'preload-webview.js');
      }
    });
  });
}

// ============================================================
//  IPC
// ============================================================
function registerIpc() {
  const safeWindowFrom = (e) => BrowserWindow.fromWebContents(e.sender);

  // Window controls
  ipcMain.on('window:minimize', (e) => safeWindowFrom(e)?.minimize());
  ipcMain.on('window:maximize', (e) => {
    const w = safeWindowFrom(e);
    if (!w) return;
    w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  ipcMain.on('window:close', (e) => safeWindowFrom(e)?.close());
  ipcMain.on('window:new-incognito', () => createWindow({ private: true }));

  // Webview preload path
  ipcMain.handle('app:webviewPreloadPath', () => {
    return 'file://' + path.join(__dirname, 'preload-webview.js');
  });

  // App metrics
  ipcMain.handle('app:metrics', () => app.getAppMetrics());

  // Search suggestions
  ipcMain.handle('search:suggest', async (_e, q) => {
    if (!q || q.trim().length < 2) return [];
    const query = q.trim().slice(0, 100);
    let items = await fetchDuckDuckGo(query);
    if (items && items.length) return items;
    items = await fetchGoogle(query);
    return items || [];
  });

  // Context menu
  ipcMain.on('webview:context-menu', (event, params) => {
    const { editFlags, linkURL, srcURL, selectionText, isEditable, x, y } = params;
    const targetWin = safeWindowFrom(event);
    const template = [];

    if (linkURL) {
      template.push(
        { label: 'Open Link in New Tab', click: () => event.sender.send('ctx:open-link-new-tab', linkURL) },
        { label: 'Open Link in New Window', click: () => safeOpenExternal(linkURL) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(linkURL) },
        { type: 'separator' }
      );
    }

    if (isEditable) {
      template.push(
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' }
      );
    } else if (selectionText) {
      template.push(
        { label: 'Copy', enabled: editFlags.canCopy, click: () => clipboard.writeText(selectionText) },
        {
          label: `Search for "${selectionText.slice(0, 20)}${selectionText.length > 20 ? '…' : ''}"`,
          click: () => event.sender.send('ctx:search-text', selectionText)
        },
        { type: 'separator' }
      );
    }

    template.push(
      { label: 'Back', click: () => event.sender.send('ctx:back') },
      { label: 'Forward', click: () => event.sender.send('ctx:forward') },
      { label: 'Reload', click: () => event.sender.send('ctx:reload') },
      { type: 'separator' },
      { label: 'Inspect Element', click: () => event.sender.send('ctx:inspect', x, y) }
    );

    Menu.buildFromTemplate(template).popup({ window: targetWin });
  });

  // ---------- Bookmarks ----------
  ipcMain.handle('bookmarks:list', () => bookmarksStore.data);
  ipcMain.handle('bookmarks:add', (_e, bm) => {
    if (!bm || typeof bm.url !== 'string' || !SAFE_NAV.test(bm.url)) return bookmarksStore.data;
    if (!bookmarksStore.data.some(b => b.url === bm.url)) {
      bookmarksStore.data.unshift({
        id: Date.now(),
        url: bm.url,
        title: String(bm.title || bm.url).slice(0, 300),
        createdAt: Date.now()
      });
      bookmarksStore.save();
    }
    const payload = bookmarksStore.data;
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('bookmarks:update', payload);
    });
    return payload;
  });
  ipcMain.handle('bookmarks:remove', (_e, url) => {
    bookmarksStore.data = bookmarksStore.data.filter(b => b.url !== url);
    bookmarksStore.save();
    const payload = bookmarksStore.data;
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('bookmarks:update', payload);
    });
    return payload;
  });

  // ---------- History ----------
  ipcMain.handle('history:list', () => historyStore.data);
  ipcMain.handle('history:add', (_e, entry) => {
    if (!entry || typeof entry.url !== 'string' || !SAFE_NAV.test(entry.url)) return false;
    const last = historyStore.data[0];
    if (!last || last.url !== entry.url) {
      historyStore.data.unshift({
        id: Date.now(),
        url: entry.url,
        title: String(entry.title || entry.url).slice(0, 300),
        visitedAt: Date.now()
      });
      if (historyStore.data.length > MAX_HISTORY_ITEMS) {
        historyStore.data.length = MAX_HISTORY_ITEMS;
      }
      historyStore.save();
    }
    return true;
  });
  ipcMain.handle('history:clear', () => {
    historyStore.data = [];
    historyStore.save();
    return true;
  });
  ipcMain.handle('history:delete', (_e, id) => {
    historyStore.data = historyStore.data.filter(h => h.id !== id);
    historyStore.save();
    return true;
  });

  // ---------- Session ----------
  ipcMain.handle('session:save', (_e, data) => {
    const tabs = Array.isArray(data?.tabs)
      ? data.tabs
          .filter(t => t && typeof t.url === 'string' && SAFE_NAV.test(t.url))
          .slice(0, MAX_SESSION_TABS)
      : [];
    sessionStore.data.tabs = tabs;
    sessionStore.save();
    return true;
  });
  ipcMain.handle('session:load', () => sessionStore.data.tabs || []);
  ipcMain.handle('session:clear', () => {
    sessionStore.data.tabs = [];
    sessionStore.save();
    return true;
  });

  // ---------- Settings ----------
  ipcMain.handle('settings:get', () => settingsStore.data);

  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settingsStore.data;

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in patch) {
        if (key === 'homepage') {
          const v = String(patch[key] || '');
          if (v === 'newtab' || /^https?:\/\//i.test(v)) {
            settingsStore.data[key] = v;
          }
        } else if (key === 'searchEngine') {
          const allowed = ['duckduckgo', 'google', 'bing', 'brave', 'startpage', 'ecosia'];
          if (allowed.includes(patch[key])) settingsStore.data[key] = patch[key];
        } else if (key === 'theme') {
          const allowed = ['purple', 'blue', 'green', 'orange', 'pink'];
          if (allowed.includes(patch[key])) settingsStore.data[key] = patch[key];
        } else if (key === 'animations' || key === 'restoreSession' || key === 'showBookmarkBar') {
          settingsStore.data[key] = Boolean(patch[key]);
        }
      }
    }

    settingsStore.save();

    const payload = settingsStore.data;
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('settings:update', payload);
    });

    return payload;
  });

  ipcMain.handle('settings:reset', () => {
    settingsStore.data = { ...DEFAULT_SETTINGS };
    settingsStore.save();
    const payload = settingsStore.data;
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('settings:update', payload);
    });
    return payload;
  });

  // ---------- Shell ----------
  ipcMain.handle('shell:openPath', (_e, p) => {
    if (typeof p !== 'string' || !p) return '';
    return shell.openPath(p);
  });
  ipcMain.handle('shell:showItem', (_e, p) => {
    if (typeof p !== 'string' || !p) return;
    shell.showItemInFolder(p);
  });
}

// ============================================================
//  APP LIFECYCLE
// ============================================================
app.whenReady().then(() => {
  initStores();
  installSecurityHandlers();
  installWebviewSanitizer();
  attachDownloadListener(session.defaultSession);
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));