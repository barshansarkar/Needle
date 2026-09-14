// ============================================================
//  NIDDLE · main.js — WebContentsView architecture
//  CSP fix + ad blocker with correct match() call
// ============================================================

// ── GPU / perf flags ──
const electron = require('electron');
const { app } = electron;
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '64');
app.commandLine.appendSwitch('renderer-process-limit', '6');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('enable-features', 'MemorySaver,HighEfficiencyModeAvailable');
app.commandLine.appendSwitch('disable-features',
  'CalculateNativeWinOcclusion,SpareRendererForSitePerProcess,AutofillServerCommunication,OptimizationHints,MediaRouter,GlobalMediaControls,HardwareMediaKeyHandling,BackgroundFetch,NotificationTriggers');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128 --max-semi-space-size=2');

const { BaseWindow, WebContentsView, ipcMain, Menu, clipboard, shell, session } = electron;
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { makeStore } = require('./src/data/store');

// ── Ad blocker (optional dependency) ──
let ElectronBlocker = null;
let fetch = null;
try {
  ({ ElectronBlocker } = require('@ghostery/adblocker-electron'));
  fetch = require('cross-fetch');
} catch (err) {
  console.warn('[adblocker] library not installed — ad blocking disabled');
}

// ============================================================
//  SAFETY HELPERS
// ============================================================
const SAFE_EXTERNAL = /^(https?|mailto):/i;
const SAFE_NAV      = /^https?:/i;

function isSafeExternalUrl(url) {
  try { return SAFE_EXTERNAL.test(new URL(url).protocol + ':'); }
  catch { return false; }
}
function safeOpenExternal(url) {
  if (isSafeExternalUrl(url)) return shell.openExternal(url);
  console.warn('[security] blocked openExternal:', url);
}
function isInternalPageUrl(url) {
  return typeof url === 'string' && url.startsWith('file://') && url.includes('/src/pages/');
}
function isNewTabUrl(url) {
  return typeof url === 'string' && url.includes('/newtab');
}

// CSP allows inline <script> so internal pages can run their JS.
const INTERNAL_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://duckduckgo.com https://suggestqueries.google.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// ============================================================
//  CONSTANTS
// ============================================================
const DEFAULT_CHROME_HEIGHT = 138;
const MAX_TABS              = 40;
const MAX_HISTORY_ITEMS     = 200;
const MAX_SESSION_TABS      = 20;
const MAX_DOWNLOADS_IN_MEMORY = 20;
const TAB_SLEEP_MS   = 5 * 60 * 1000;
const TAB_SLEEP_TICK = 30 * 1000;

const WEBVIEW_PRELOAD_PATH = path.join(__dirname, 'preload-webview.js');
const CHROME_PRELOAD       = path.join(__dirname, 'preload.js');
const CHROME_HTML          = path.join(__dirname, 'src/index.html');

const DEFAULT_SETTINGS = {
  homepage: 'newtab', searchEngine: 'duckduckgo',
  restoreSession: true, backgroundTabs: false, confirmCloseAll: false,
  theme: 'purple', colorMode: 'dark', animations: true,
  showBookmarkBar: true, showFavicons: true, compactTabs: false,
  doNotTrack: false, blockThirdParty: false, clearHistoryOnExit: false,
  suggestions: true,
  adblocker: true,
};
const ALLOWED_ENGINES = ['duckduckgo','google','bing','brave','startpage','ecosia'];
const ALLOWED_THEMES  = ['purple','blue','green','orange','pink','red','slate','mono'];
const ALLOWED_MODES   = ['dark','darker','system'];
const BOOL_KEYS = ['animations','restoreSession','showBookmarkBar','showFavicons',
  'compactTabs','backgroundTabs','confirmCloseAll','doNotTrack','blockThirdParty',
  'clearHistoryOnExit','suggestions','adblocker'];

// ============================================================
//  STATE
// ============================================================
const winStates = new Map();
let mainWindowState = null;
let bookmarksStore, historyStore, sessionStore, settingsStore;
const downloadingItems = new Map();

// ── Ad blocker runtime ──
let adBlocker = null;
let adBlockerBlockedCount = 0;
const adblockerHookedSessions = new WeakSet();

// ============================================================
//  LIVENESS + SAFE WRAPPERS
// ============================================================
function isLive(ws) {
  try {
    if (!ws) return false;
    if (ws.destroyed) return false;
    if (!ws.win) return false;
    return !ws.win.isDestroyed();
  } catch { return false; }
}

function safeWinListener(ws, event, fn) {
  const wrapped = (...args) => {
    if (ws.destroyed) return;
    try { fn(...args); }
    catch (e) {
      if (process.env.NIDDLE_DEBUG) console.warn(`[win:${event}]`, e.message);
    }
  };
  try { ws.win.on(event, wrapped); } catch {}
  return wrapped;
}

function getWsFromSender(sender) {
  for (const ws of winStates.values()) {
    if (!isLive(ws)) continue;
    if (ws.chromeWc === sender) return ws;
    for (const t of ws.tabs.values()) {
      if (t.wc === sender) return ws;
    }
  }
  return null;
}

function sendToChrome(ws, channel, payload) {
  if (!isLive(ws)) return;
  try { ws.chromeWc.send(channel, payload); } catch {}
}

function broadcastToChrome(channel, payload) {
  for (const ws of winStates.values()) sendToChrome(ws, channel, payload);
}

// ============================================================
//  AD BLOCKER
//  Uses the library's own bound onBeforeRequest(), which correctly
//  constructs a Request object and maps resourceType. This works on
//  any Electron version — no registerPreloadScript involved.
// ============================================================
const ADBLOCKER_CACHE_PATH = path.join(app.getPath('userData'), 'adblocker-engine.bin');
const ADBLOCKER_CACHE_MAX_AGE_DAYS = 7;
const ADBLOCKER_CACHE_MIN_BYTES    = 512 * 1024;   // real caches are multi-MB

/**
 * Count parsed filters in the engine. Unlike `engine.lists` (which is
 * empty for engines built via fromPrebuilt*), getFilters() returns the
 * actual network + cosmetic filters that were parsed.
 */
function countFilters(engine) {
  try {
    if (!engine || typeof engine.getFilters !== 'function') return 0;
    const f = engine.getFilters();
    if (!f) return 0;
    const n = (f.networkFilters?.length || 0) + (f.cosmeticFilters?.length || 0);
    return n;
  } catch { return 0; }
}

async function initAdBlocker() {
  if (!ElectronBlocker || !fetch) {
    console.warn('[adblocker] library not installed — ad blocking disabled');
    return;
  }

  try {
    let engine = null;

    // ── 1. Try cache, but validate it via getFilters() ──
    try {
      if (fs.existsSync(ADBLOCKER_CACHE_PATH)) {
        const stat = await fs.promises.stat(ADBLOCKER_CACHE_PATH);
        const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        const tooOld   = ageDays > ADBLOCKER_CACHE_MAX_AGE_DAYS;
        const tooSmall = stat.size < ADBLOCKER_CACHE_MIN_BYTES;

        if (tooOld || tooSmall) {
          console.log(`[adblocker] cache invalid (size=${(stat.size/1024/1024).toFixed(1)}MB, age=${ageDays.toFixed(1)}d) — refetching`);
        } else {
          const buf = await fs.promises.readFile(ADBLOCKER_CACHE_PATH);
          engine = ElectronBlocker.deserialize(new Uint8Array(buf));
          const count = countFilters(engine);
          if (count === 0) {
            console.warn('[adblocker] cache deserialized but 0 filters — refetching');
            engine = null;
          } else {
            console.log(`[adblocker] loaded from cache — ${count.toLocaleString()} filters, ${ageDays.toFixed(1)}d old`);
          }
        }
      }
    } catch (e) {
      console.warn('[adblocker] cache read failed:', e.message);
      engine = null;
    }

    // ── 2. Fetch fresh if cache wasn't usable ──
    if (!engine) {
      console.log('[adblocker] fetching filter lists from CDN…');
      engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);

      const count = countFilters(engine);
      if (count === 0) {
        console.error('[adblocker] fetched engine has 0 filters — check network');
      } else {
        console.log(`[adblocker] fetched ${count.toLocaleString()} filters`);
      }

      try {
        const serialized = engine.serialize();
        const buf = Buffer.from(serialized);
        if (buf.length >= ADBLOCKER_CACHE_MIN_BYTES) {
          await fs.promises.writeFile(ADBLOCKER_CACHE_PATH, buf);
          console.log(`[adblocker] cached to disk (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
        } else {
          console.warn(`[adblocker] refusing to cache tiny engine (${buf.length}B)`);
        }
      } catch (e) {
        console.warn('[adblocker] cache write failed:', e.message);
      }
    }

    adBlocker = engine;

    attachAdBlockerToSession(session.defaultSession);
    for (const ws of winStates.values()) {
      for (const t of ws.tabs.values()) {
        try { attachAdBlockerToSession(t.wc.session); } catch {}
      }
    }

    console.log(`[adblocker] ready — ${countFilters(adBlocker).toLocaleString()} filters loaded`);
  } catch (err) {
    console.error('[adblocker] init failed:', err);
    adBlocker = null;
  }
}

/**
 * Hook the ad blocker onto a session by delegating to the library's own
 * `onBeforeRequest`. It handles Request construction and resourceType
 * mapping correctly — passing a plain object to match() does NOT work.
 */
function attachAdBlockerToSession(sess) {
  if (!sess || !adBlocker) return;
  if (adblockerHookedSessions.has(sess)) return;
  adblockerHookedSessions.add(sess);

  try {
    sess.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
      if (settingsStore?.data?.adblocker === false) return cb({});

      // Guard against double-callback: the library calls cb() exactly once,
      // but if it throws synchronously before that, we need to release it.
      let called = false;
      const safeCb = (response) => {
        if (called) return;
        called = true;
        // Bump the blocked counter if the library cancelled the request
        if (response && response.cancel) adBlockerBlockedCount++;
        try { cb(response || {}); } catch {}
      };

      try {
        adBlocker.onBeforeRequest(details, safeCb);
      } catch {
        safeCb({});
      }
    });
  } catch (e) {
    console.warn('[adblocker] webRequest hook failed:', e.message);
  }
}

/**
 * Kept as a hook point for the settings handler. The webRequest filter
 * already checks `settingsStore.data.adblocker` on every request.
 */
function applyAdblockerToAllSessions() {
  // No-op — see comment above.
}

// ============================================================
//  STORES
// ============================================================
function initStores() {
  bookmarksStore = makeStore('bookmarks.json', []);
  historyStore   = makeStore('history.json', []);
  sessionStore   = makeStore('session.json', { tabs: [] });
  settingsStore  = makeStore('settings.json', { ...DEFAULT_SETTINGS });

  let changed = false;
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (settingsStore.data[k] === undefined) { settingsStore.data[k] = v; changed = true; }
  }
  if (changed) settingsStore.save();
  if (Array.isArray(historyStore.data) && historyStore.data.length > MAX_HISTORY_ITEMS) {
    historyStore.data.length = MAX_HISTORY_ITEMS;
    historyStore.save();
  }
}
function addHistory(url, title) {
  if (!SAFE_NAV.test(url)) return;
  const last = historyStore.data[0];
  if (last && last.url === url) return;
  historyStore.data.unshift({ id: Date.now(), url, title, visitedAt: Date.now() });
  if (historyStore.data.length > MAX_HISTORY_ITEMS) historyStore.data.length = MAX_HISTORY_ITEMS;
  historyStore.save();
}

// ============================================================
//  WINDOW CREATION
// ============================================================
function createBrowserWindow({ private: isPrivate = false } = {}) {
  const win = new BaseWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    frame: false, titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    show: false,
  });

  const chromeView = new WebContentsView({
    webPreferences: {
      preload: CHROME_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      backgroundThrottling: true,
      v8CacheOptions: 'code',
      spellcheck: false,
      additionalArguments: isPrivate ? ['--nova-private=1'] : [],
    },
  });

  win.contentView.addChildView(chromeView);

  const ws = {
    win,
    chromeView,
    chromeWc: chromeView.webContents,
    isPrivate,
    tabs: new Map(),
    activeTabId: null,
    chromeHeight: DEFAULT_CHROME_HEIGHT,
    privatePartition: isPrivate ? 'private-' + crypto.randomUUID() : null,
    destroyed: false,
    layoutScheduled: false,
    winListeners: [],
  };

  winStates.set(win.id, ws);
  if (!isPrivate) mainWindowState = ws;

  ws.chromeWc.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) sendToChrome(ws, 'open-new-tab', url);
    return { action: 'deny' };
  });

  ws.chromeWc.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (isSafeExternalUrl(url)) sendToChrome(ws, 'open-new-tab', url);
    }
  });

  ws.chromeWc.on('render-process-gone', (_e, d) => {
    console.error('[chrome renderer gone]', d.reason);
    if (!isLive(ws)) return;
    try { ws.chromeWc.reload(); } catch {}
  });

  ws.chromeWc.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return;
    console.error('[chrome did-fail-load]', code, desc, url);
  });

  ws.chromeWc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const handled = handleShortcut(ws, {
      ctrl: !!(input.control || input.meta),
      shift: !!input.shift, alt: !!input.alt, key: input.key || '',
    });
    if (handled) e.preventDefault();
  });

  try {
    ws.chromeWc.loadFile(CHROME_HTML).catch(err => {
      console.error('[chrome loadFile rejected]', err);
    });
  } catch (err) {
    console.error('[chrome loadFile threw]', err);
  }

  ws.chromeWc.once('dom-ready', () => {
  if (!isLive(ws)) return;
  try { win.show(); }
  catch (e) { console.warn('[dom-ready show skipped]', e.message); }
  // ws.chromeWc.openDevTools({ mode: 'detach' });   // ← ADD THIS LINE  <<<<<<<<<<<<<<<<<<<<<<<<<<<<< debug window open hoy
  if (!isPrivate && isLive(ws)) restoreSession(ws);
});

  const scheduleLayout = () => {
    if (ws.destroyed || ws.layoutScheduled) return;
    ws.layoutScheduled = true;
    setImmediate(() => {
      ws.layoutScheduled = false;
      if (!isLive(ws)) return;
      try { layoutWindow(ws); } catch {}
    });
  };

  const events = ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'];
  for (const ev of events) {
    const wrapped = safeWinListener(ws, ev, scheduleLayout);
    ws.winListeners.push({ event: ev, fn: wrapped });
  }

  const onClose = safeWinListener(ws, 'close', () => {
    ws.destroyed = true;
    detachWinListeners(ws);
  });
  ws.winListeners.push({ event: 'close', fn: onClose });

  const onClosed = safeWinListener(ws, 'closed', () => {
    ws.destroyed = true;
    const tabs = [...ws.tabs.values()];
    ws.tabs.clear();
    for (const t of tabs) {
      try { ws.win.contentView.removeChildView(t.view); } catch {}
      try { if (t.wc && !t.wc.isDestroyed()) t.wc.close(); } catch {}
    }
    winStates.delete(win.id);
    if (mainWindowState === ws) mainWindowState = null;
  });
  ws.winListeners.push({ event: 'closed', fn: onClosed });

  layoutWindow(ws);
  return ws;
}

function detachWinListeners(ws) {
  if (!ws || !ws.winListeners || !ws.win) return;
  const list = ws.winListeners;
  ws.winListeners = [];
  for (const { event, fn } of list) {
    try { ws.win.removeListener(event, fn); } catch {}
  }
}

function layoutWindow(ws) {
  if (!isLive(ws)) return;

  let bounds;
  try { bounds = ws.win.getContentBounds(); }
  catch { return; }

  const { width: w, height: h } = bounds;
  const chromeH = Math.min(Math.max(0, ws.chromeHeight), h);

  try {
    ws.chromeView.setBounds({ x: 0, y: 0, width: w, height: chromeH });
  } catch {}

  const tabY = chromeH;
  const tabH = Math.max(0, h - tabY);
  for (const t of ws.tabs.values()) {
    try {
      if (!t.view) continue;
      const twc = t.view.webContents;
      if (twc && twc.isDestroyed && twc.isDestroyed()) continue;
      t.view.setBounds({ x: 0, y: tabY, width: w, height: tabH });
    } catch {}
  }
}

// ============================================================
//  TAB LIFECYCLE
// ============================================================
function serializeTab(t) {
  return {
    id: t.id, url: t.url, title: t.title,
    isInternal: t.isInternal, isLoading: t.isLoading,
    canGoBack: t.canGoBack, canGoForward: t.canGoForward,
    isAudible: t.isAudible, zoom: t.zoom,
    favicon: t.favicon || null, sleeping: t.sleeping,
  };
}
function sendTabMeta(ws, tab) {
  if (!isLive(ws)) return;
  sendToChrome(ws, 'tab:updated', serializeTab(tab));
}

function getHomepageUrl() {
  const s = settingsStore?.data;
  if (!s || s.homepage === 'newtab') return PAGE_URL('newtab');
  try { return new URL(s.homepage).href; } catch { return PAGE_URL('newtab'); }
}
function PAGE_URL(name) {
  return 'file://' + path.join(__dirname, 'src/pages', name + '.html');
}

function createTab(ws, rawUrl, { activate = true, record = true } = {}) {
  if (!isLive(ws)) return null;
  if (ws.tabs.size >= MAX_TABS) return null;

  let url = rawUrl ? (safeNavUrl(rawUrl) || getHomepageUrl()) : getHomepageUrl();
  const isInternal = isInternalPageUrl(url);
  const id = crypto.randomUUID();

  let view;
  try {
    view = new WebContentsView({
      webPreferences: {
        preload: WEBVIEW_PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        backgroundThrottling: true,
        v8CacheOptions: 'code',
        spellcheck: false,
        webviewTag: false,
        partition: ws.isPrivate ? ws.privatePartition : 'persist:main',
      },
    });
  } catch (err) {
    console.error('[createTab] WebContentsView failed', err);
    return null;
  }

  const wc = view.webContents;
  attachSessionHandlers(wc.session);
  attachAdBlockerToSession(wc.session);

  wc.setWindowOpenHandler(({ url: u }) => {
    if (isSafeExternalUrl(u)) sendToChrome(ws, 'open-new-tab', u);
    return { action: 'deny' };
  });

  const tab = {
    id, view, wc, url,
    title: 'New Tab', isInternal,
    isLoading: false, canGoBack: false, canGoForward: false,
    isAudible: false, zoom: 0,
    sleeping: false, savedUrl: null,
    lastActive: Date.now(), pinned: false,
    record, favicon: null,
  };
  ws.tabs.set(id, tab);

  hookTabEvents(ws, tab);

  try { wc.loadURL(url); }
  catch (err) {
    console.error('[createTab] loadURL failed', url, err);
    ws.tabs.delete(id);
    try { if (!wc.isDestroyed()) wc.close(); } catch {}
    return null;
  }

  sendToChrome(ws, 'tab:created', serializeTab(tab));
  if (activate) activateTab(ws, id);
  return tab;
}

function hookTabEvents(ws, tab) {
  const wc = tab.wc;

  wc.on('did-start-loading', () => { tab.isLoading = true;  sendTabMeta(ws, tab); });
  wc.on('did-stop-loading',  () => {
    tab.isLoading = false;
    const u = wc.getURL();
    if (u) { tab.url = u; tab.isInternal = isInternalPageUrl(u); }
    tab.canGoBack    = wc.canGoBack();
    tab.canGoForward = wc.canGoForward();
    sendTabMeta(ws, tab);
  });

  wc.on('page-title-updated', (_e, title) => {
    tab.title = String(title || 'Untitled').slice(0, 512);
    sendTabMeta(ws, tab);
  });
  wc.on('page-favicon-updated', (_e, icons) => {
    if (Array.isArray(icons) && icons[0]) { tab.favicon = icons[0]; sendTabMeta(ws, tab); }
  });

  wc.on('did-navigate', (_e, url) => {
    if (url === 'about:blank') return;
    tab.url = url;
    tab.isInternal = isInternalPageUrl(url);
    tab.canGoBack = wc.canGoBack();
    tab.canGoForward = wc.canGoForward();
    sendTabMeta(ws, tab);
    if (tab.record && !tab.isInternal && !ws.isPrivate) {
      addHistory(url, String(wc.getTitle() || url).slice(0, 300));
    }
    saveSession();
  });

  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = url;
    tab.canGoBack = wc.canGoBack();
    tab.canGoForward = wc.canGoForward();
    sendTabMeta(ws, tab);
  });

  wc.on('will-navigate', (e, url) => {
    if (/^(javascript|data|blob|vbscript|filesystem):/i.test(url)) { e.preventDefault(); return; }
    if (url.startsWith('file://') && !isInternalPageUrl(url)) { e.preventDefault(); }
  });

  wc.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (code === -3 || !isMainFrame) return;
  });

  wc.on('context-menu', (_e, params) => {
    if (!isLive(ws)) return;
    showContextMenu(ws, params);
  });

  wc.on('found-in-page', (_e, result) => {
    if (ws.activeTabId !== tab.id) return;
    sendToChrome(ws, 'find:result', {
      tabId: tab.id,
      activeMatchOrdinal: result?.activeMatchOrdinal || 0,
      matches: result?.matches || 0,
    });
  });

  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const handled = handleShortcut(ws, {
      ctrl: !!(input.control || input.meta),
      shift: !!input.shift, alt: !!input.alt, key: input.key || '',
    });
    if (handled) e.preventDefault();
  });

  wc.on('media-started-playing', () => { tab.isAudible = true;  sendTabMeta(ws, tab); });
  wc.on('media-paused',         () => { tab.isAudible = false; sendTabMeta(ws, tab); });
}

function activateTab(ws, id) {
  if (!isLive(ws)) return;
  const t = ws.tabs.get(id);
  if (!t) return;

  if (t.sleeping && t.savedUrl) {
    const wake = t.savedUrl;
    t.sleeping = false;
    t.savedUrl = null;
    try { t.wc.loadURL(wake); } catch {}
  }

  const prev = ws.tabs.get(ws.activeTabId);
  if (prev && prev.id !== id) {
    try { ws.win.contentView.removeChildView(prev.view); } catch {}
  }
  ws.activeTabId = id;
  t.lastActive = Date.now();

  try { ws.win.contentView.addChildView(t.view); } catch {}
  layoutWindow(ws);

  sendToChrome(ws, 'tab:activated', { id });
  sendTabMeta(ws, t);
}

function closeTab(ws, id) {
  if (!ws) return;
  const t = ws.tabs.get(id);
  if (!t) return;

  // Remember neighbours before we delete
  const ids = [...ws.tabs.keys()];
  const idx = ids.indexOf(id);
  const wasActive = ws.activeTabId === id;

  ws.tabs.delete(id);

  const viewToRemove = t.view;
  const wcToClose    = t.wc;
  setImmediate(() => {
    try { if (isLive(ws)) ws.win.contentView.removeChildView(viewToRemove); } catch {}
    try { wcToClose.stop(); } catch {}
    try { wcToClose.loadURL('about:blank'); } catch {}
    try { if (!wcToClose.isDestroyed()) wcToClose.close(); } catch {}
  });

  sendToChrome(ws, 'tab:closed', { id });

  if (ws.tabs.size === 0) {
    if (ws.isPrivate) { try { ws.win.close(); } catch {} return; }
    if (isLive(ws)) createTab(ws);
    return;
  }

  if (wasActive) {
    const remaining = [...ws.tabs.keys()];
    // Prefer the tab that was to the right, fall back to the last one
    const nextIdx = Math.min(idx, remaining.length - 1);
    activateTab(ws, remaining[nextIdx]);
  }
  saveSession();
}

// Reorder tabs in the ws.tabs Map and tell the chrome
function reorderTab(ws, id, newIndex) {
  if (!ws.tabs.has(id)) return;
  const entries = [...ws.tabs.entries()];
  const oldIndex = entries.findIndex(([tid]) => tid === id);
  if (oldIndex === -1) return;
  newIndex = Math.max(0, Math.min(entries.length - 1, newIndex | 0));
  if (newIndex === oldIndex) return;

  const [entry] = entries.splice(oldIndex, 1);
  entries.splice(newIndex, 0, entry);

  ws.tabs.clear();
  for (const [k, v] of entries) ws.tabs.set(k, v);

  sendToChrome(ws, 'tab:reordered', { order: [...ws.tabs.keys()] });
}
function navigateTab(ws, id, rawUrl) {
  const t = ws?.tabs.get(id);
  if (!t) return;
  const url = safeNavUrl(rawUrl);
  if (!url) return;
  try { t.wc.loadURL(url); } catch {}
}

function cycleTab(ws, dir) {
  if (!isLive(ws)) return;
  const ids = [...ws.tabs.keys()];
  if (ids.length < 2) return;
  const i = ids.indexOf(ws.activeTabId);
  const next = ids[(i + dir + ids.length) % ids.length];
  activateTab(ws, next);
}

// ============================================================
//  SHORTCUTS
// ============================================================
function handleShortcut(ws, { ctrl, shift, alt, key }) {
  if (!isLive(ws)) return false;
  const k = String(key || '').toLowerCase();
  if (!k) return false;

  if (ctrl && shift && k === 'n') { createBrowserWindow({ private: true }); return true; }
  if (ctrl && !shift && k === 't') { createTab(ws); return true; }
  if (ctrl && !shift && k === 'w') { if (ws.activeTabId) closeTab(ws, ws.activeTabId); return true; }
  if (ctrl && !shift && k === 'tab')  { cycleTab(ws, 1);  return true; }
  if (ctrl && shift  && k === 'tab')  { cycleTab(ws, -1); return true; }

  if (ctrl && !shift && k === 'l') { sendToChrome(ws, 'focus-url');   return true; }
  if (ctrl && !shift && k === 'r') { reloadTab(ws, false);            return true; }
  if (ctrl && shift  && k === 'r') { reloadTab(ws, true);             return true; }
  if (ctrl && !shift && k === 'f') { sendToChrome(ws, 'show-find');   return true; }

  if (ctrl && !shift && k === 'h') { openInternal(ws, 'history');     return true; }
  if (ctrl && !shift && k === 'j') { openInternal(ws, 'downloads');   return true; }
  if (ctrl && !shift && k === 'd') { sendToChrome(ws, 'toggle-bookmark'); return true; }
  if (ctrl && k === ',')           { openInternal(ws, 'settings');    return true; }

  if (ctrl && (k === '=' || k === '+')) { zoomTab(ws, +1); return true; }
  if (ctrl && k === '-')                { zoomTab(ws, -1); return true; }
  if (ctrl && k === '0')                { zoomTab(ws,  0); return true; }

  if (k === 'f12')                { devtoolsTab(ws); return true; }
  if (ctrl && shift && k === 'i') { devtoolsTab(ws); return true; }

  if (alt && !ctrl && k === 'arrowleft')  { const t = activeTab(ws); if (t && t.wc.canGoBack())    t.wc.goBack();    return true; }
  if (alt && !ctrl && k === 'arrowright') { const t = activeTab(ws); if (t && t.wc.canGoForward()) t.wc.goForward(); return true; }

  return false;
}

function activeTab(ws) { return ws ? ws.tabs.get(ws.activeTabId) : null; }

function reloadTab(ws, ignoreCache) {
  const t = activeTab(ws);
  if (!t) return;
  try { ignoreCache ? t.wc.reloadIgnoringCache() : t.wc.reload(); } catch {}
}
function zoomTab(ws, delta) {
  const t = activeTab(ws);
  if (!t) return;
  if (delta === 0) t.zoom = 0;
  else t.zoom = Math.max(-5, Math.min(8, t.zoom + delta));
  try { t.wc.setZoomLevel(t.zoom); } catch {}
  sendTabMeta(ws, t);
}
function devtoolsTab(ws) {
  const t = activeTab(ws);
  if (!t) return;
  try { t.wc.openDevTools({ mode: 'detach' }); } catch {}
}
function openInternal(ws, name) {
  if (!isLive(ws)) return;
  const url = PAGE_URL(name);
  const t = activeTab(ws);
  if (t && t.isInternal && isNewTabUrl(t.url)) navigateTab(ws, t.id, url);
  else createTab(ws, url, { record: false });
}

// ============================================================
//  CONTEXT MENU
// ============================================================
function showContextMenu(ws, params) {
  if (!isLive(ws)) return;
  if (!params || typeof params !== 'object') return;

  const { editFlags = {}, linkURL = '', selectionText = '', isEditable, x = 0, y = 0 } = params;
  const template = [];

  if (linkURL && isSafeExternalUrl(linkURL)) {
    template.push(
      { label: 'Open Link in New Tab',    click: () => createTab(ws, linkURL) },
      { label: 'Open Link in New Window', click: () => safeOpenExternal(linkURL) },
      { label: 'Copy Link Address',       click: () => clipboard.writeText(linkURL) },
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
      { label: `Search for "${selectionText.slice(0, 20)}${selectionText.length > 20 ? '…' : ''}"`,
        click: () => {
          const engine = settingsStore?.data?.searchEngine || 'duckduckgo';
          const prefix = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
          createTab(ws, prefix + encodeURIComponent(selectionText));
        } },
      { type: 'separator' }
    );
  }
  const t = activeTab(ws);
  template.push(
    { label: 'Back',    enabled: !!t?.wc.canGoBack(),    click: () => t?.wc.goBack() },
    { label: 'Forward', enabled: !!t?.wc.canGoForward(), click: () => t?.wc.goForward() },
    { label: 'Reload',  click: () => t?.wc.reload() },
    { type: 'separator' },
    { label: 'Inspect Element', click: () => {
        try { t?.wc.inspectElement(Number(x)||0, Number(y)||0); } catch {}
        try { t?.wc.openDevTools({ mode: 'detach' }); } catch {}
    } }
  );

  try { Menu.buildFromTemplate(template).popup({ window: ws.win }); } catch {}
}

// ============================================================
//  SEARCH SUGGESTIONS
// ============================================================
const SEARCH_ENGINES = Object.freeze({
  duckduckgo: 'https://duckduckgo.com/?q=',
  google:     'https://www.google.com/search?q=',
  bing:       'https://www.bing.com/search?q=',
  brave:      'https://search.brave.com/search?q=',
  startpage:  'https://www.startpage.com/sp/search?query=',
  ecosia:     'https://www.ecosia.org/search?q=',
});

function httpGetJson(url, timeout = 3500) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      timeout,
      headers: { 'User-Agent': 'Mozilla/5.0 NIDDLE/1.0', 'Accept': 'application/json' },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
async function fetchDuckDuckGo(q) {
  const d = await httpGetJson(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}`);
  return Array.isArray(d) ? d.map(x => typeof x === 'string' ? x : x?.phrase).filter(Boolean) : [];
}
async function fetchGoogle(q) {
  const d = await httpGetJson(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`);
  return Array.isArray(d) && Array.isArray(d[1]) ? d[1].filter(Boolean) : [];
}
async function getMergedSuggestions(query) {
  const ql = query.toLowerCase();
  const [ddg, gg] = await Promise.all([
    fetchDuckDuckGo(query).catch(() => []),
    fetchGoogle(query).catch(() => []),
  ]);
  const seen = new Set([ql]);
  const out = [];
  for (const item of [...ddg, ...gg]) {
    const s = String(item).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= 10) break;
  }
  return out;
}

// ============================================================
//  SESSION SECURITY
// ============================================================
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

function attachSessionHandlers(sess) {
  if (!sess || sess.__novaHooked) return;
  sess.__novaHooked = true;

  sess.on('will-download', (_e, item) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const info = {
      id, filename: item.getFilename(), url: item.getURL(),
      totalBytes: item.getTotalBytes(), receivedBytes: 0,
      state: 'progressing', savePath: item.getSavePath(), startedAt: Date.now(),
    };
    downloadingItems.set(id, info);
    pruneDownloads();
    broadcastDownloads();

    item.on('updated', (_e2, state) => {
      info.receivedBytes = item.getReceivedBytes();
      info.totalBytes = item.getTotalBytes();
      info.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      broadcastDownloads();
    });
    item.once('done', (_e2, state) => {
      info.state = state;
      info.savePath = item.getSavePath();
      info.receivedBytes = item.getReceivedBytes();
      info.finishedAt = Date.now();
      broadcastDownloads();
      broadcastToChrome('downloads:auto-open');
    });
  });

  sess.setPermissionRequestHandler((_wc, permission, cb) => {
    const ok = ALLOWED_PERMISSIONS.has(permission);
    if (!ok) console.log('[permission denied]', permission);
    cb(ok);
  });
  sess.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  sess.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url;
    if (url.startsWith('javascript:') || url.startsWith('data:text/html')) return cb({ cancel: true });
    if (url.startsWith('file://')) {
      const ref = details.referrer || '';
      if (ref.startsWith('http://') || ref.startsWith('https://')) {
        console.warn('[blocked file read]', url);
        return cb({ cancel: true });
      }
    }
    cb({});
  });

  sess.webRequest.onBeforeSendHeaders((details, cb) => {
    if (settingsStore?.data?.doNotTrack) {
      details.requestHeaders['DNT'] = '1';
      details.requestHeaders['Sec-GPC'] = '1';
    }
    cb({ requestHeaders: details.requestHeaders });
  });

  sess.webRequest.onHeadersReceived((details, cb) => {
    if (isInternalPageUrl(details.url)) {
      cb({ responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [INTERNAL_CSP],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
      }});
    } else cb({ responseHeaders: details.responseHeaders });
  });
}

function pruneDownloads() {
  if (downloadingItems.size <= MAX_DOWNLOADS_IN_MEMORY) return;
  const excess = downloadingItems.size - MAX_DOWNLOADS_IN_MEMORY;
  const keys = Array.from(downloadingItems.keys()).slice(0, excess);
  for (const k of keys) downloadingItems.delete(k);
}
function broadcastDownloads() {
  const list = Array.from(downloadingItems.values()).reverse();
  broadcastToChrome('downloads:update', list);
  for (const ws of winStates.values()) {
    if (!isLive(ws)) continue;
    for (const t of ws.tabs.values()) {
      if (!t.isInternal) continue;
      try {
        const u = t.wc.getURL();
        if (u && u.includes('/downloads')) t.wc.send('downloads:update', list);
      } catch {}
    }
  }
}

// ============================================================
//  IPC
// ============================================================
function registerIpc() {

  
ipcMain.on('tab:reorder', (e, p) => {
  const ws = getWsFromSender(e.sender);
  if (!isLive(ws)) return;
  const id = p?.id;
  const index = p?.index;
  if (typeof id !== 'string' || !Number.isInteger(index)) return;
  try { reorderTab(ws, id, index); } catch (err) { console.error('[reorder]', err); }
});

  ipcMain.on('window:minimize', (e) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    try { ws.win.minimize(); } catch {}
  });
  ipcMain.on('window:maximize', (e) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    try {
      ws.win.isMaximized() ? ws.win.unmaximize() : ws.win.maximize();
    } catch {}
  });
  ipcMain.on('window:close', (e) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    try { ws.win.close(); } catch {}
  });
  ipcMain.on('window:new-incognito', () => createBrowserWindow({ private: true }));

  ipcMain.on('chrome:bounds', (e, payload) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    const h = Math.max(0, Math.min(2000, Number(payload?.height) || DEFAULT_CHROME_HEIGHT));
    if (Math.abs(ws.chromeHeight - h) < 1) return;
    ws.chromeHeight = h;
    try { layoutWindow(ws); } catch {}
  });

  ipcMain.on('shortcut', (e, data) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    try { handleShortcut(ws, data); } catch {}
  });

  ipcMain.handle('tab:create', (e, opts) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return null;
    const t = createTab(ws, opts?.url, {
      activate: opts?.activate !== false,
      record:   opts?.record   !== false,
    });
    return t ? t.id : null;
  });

  ipcMain.handle('tab:list', (e) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return { tabs: [], activeId: null };
    return { tabs: [...ws.tabs.values()].map(serializeTab), activeId: ws.activeTabId };
  });

 ipcMain.on('tab:close', (e, id) => {
  console.log('[NIDDLE-main] ▶ tab:close received. id =', id);
  if (typeof id !== 'string' || id.length < 5 || id.length > 64) {
    console.warn('[NIDDLE-main]   ✗ bad id, ignoring');
    return;
  }
  let ws = getWsFromSender(e.sender);
  console.log('[NIDDLE-main]   ws via sender:', ws ? 'found' : 'NULL');
  if (!ws) ws = mainWindowState;
  if (!ws) { console.warn('[NIDDLE-main]   ✗ no window at all'); return; }
  if (!isLive(ws)) { console.warn('[NIDDLE-main]   ✗ ws not live'); return; }

  console.log('[NIDDLE-main]   ws.tabs keys:', [...ws.tabs.keys()].map(x => x.slice(0,8)));
  const t = ws.tabs.get(id);
  if (!t) { console.warn('[NIDDLE-main]   ✗ tab id NOT in ws.tabs'); return; }

  console.log('[NIDDLE-main]   ✓ closing:', id.slice(0,8));
  closeTab(ws, id);
});
  ipcMain.on('tab:activate', (e, id) => { const ws = getWsFromSender(e.sender); if (isLive(ws)) activateTab(ws, id); });
  ipcMain.on('tab:navigate', (e, p) => { const ws = getWsFromSender(e.sender); if (isLive(ws)) navigateTab(ws, p?.id, p?.url); });

  ipcMain.on('tab:action', (e, p) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    const t = ws.tabs.get(p?.id); if (!t) return;
    const a = p.action;
    try {
      if (a === 'back'       && t.wc.canGoBack())    t.wc.goBack();
      if (a === 'forward'    && t.wc.canGoForward()) t.wc.goForward();
      if (a === 'reload')    t.wc.reload();
      if (a === 'reloadHard')t.wc.reloadIgnoringCache();
      if (a === 'stop')      t.wc.stop();
    } catch {}
  });

  ipcMain.on('tab:zoom', (e, p) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    const t = ws.tabs.get(p?.id); if (!t) return;
    const d = Number(p?.delta) || 0;
    if (d === 0) t.zoom = 0;
    else t.zoom = Math.max(-5, Math.min(8, t.zoom + d));
    try { t.wc.setZoomLevel(t.zoom); } catch {}
    sendTabMeta(ws, t);
  });

  ipcMain.on('tab:find', (e, p) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    const t = ws.tabs.get(p?.id); if (!t) return;
    const text = typeof p?.text === 'string' ? p.text.slice(0, 200) : '';
    if (!text) return;
    try { t.wc.findInPage(text, { forward: p?.forward !== false, findNext: !!p?.findNext }); } catch {}
  });

  ipcMain.on('tab:find-stop', (e, p) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    const t = ws.tabs.get(p?.id); if (!t) return;
    try { t.wc.stopFindInPage(p?.action || 'clearSelection'); } catch {}
  });

  ipcMain.on('tab:devtools', (e, p) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    const t = ws.tabs.get(p?.id); if (!t) return;
    try { t.wc.openDevTools({ mode: 'detach' }); } catch {}
  });

  ipcMain.handle('guest:navigate', (e, url) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return false;
    const safe = safeNavUrl(url); if (!safe) return false;
    const t = activeTab(ws);
    if (t && t.isInternal && isNewTabUrl(t.url)) navigateTab(ws, t.id, safe);
    else createTab(ws, safe);
    return true;
  });

  ipcMain.handle('guest:suggest', async (e, query) => {
    if (typeof query !== 'string') return [];
    if (settingsStore?.data?.suggestions === false) return [];
    const q = query.trim().slice(0, 100);
    if (q.length < 2) return [];
    try { return await getMergedSuggestions(q); } catch { return []; }
  });

  ipcMain.on('guest:open-internal', (e, name) => {
    const ws = getWsFromSender(e.sender);
    if (!isLive(ws)) return;
    if (['history','downloads','settings','newtab'].includes(name)) openInternal(ws, name);
  });

  ipcMain.handle('app:webviewPreloadPath', () => 'file://' + WEBVIEW_PRELOAD_PATH);
  ipcMain.handle('app:metrics', () => app.getAppMetrics());

  ipcMain.handle('search:suggest', async (_e, q) => {
    if (typeof q !== 'string' || q.trim().length < 2) return [];
    if (settingsStore?.data?.suggestions === false) return [];
    try { return await getMergedSuggestions(q.trim().slice(0, 100)); } catch { return []; }
  });

  ipcMain.handle('adblocker:stats', () => {
    return {
      available: !!adBlocker,
      enabled: settingsStore?.data?.adblocker !== false,
      filters: countFilters(adBlocker),
      blocked: adBlockerBlockedCount,
    };
  });

  ipcMain.handle('bookmarks:list', () => bookmarksStore.data);
  ipcMain.handle('bookmarks:add', (_e, bm) => {
    if (!bm || typeof bm.url !== 'string' || !SAFE_NAV.test(bm.url)) return bookmarksStore.data;
    if (!bookmarksStore.data.some(b => b.url === bm.url)) {
      bookmarksStore.data.unshift({ id: Date.now(), url: bm.url,
        title: String(bm.title || bm.url).slice(0, 300), createdAt: Date.now() });
      bookmarksStore.save();
    }
    const payload = bookmarksStore.data;
    broadcastToChrome('bookmarks:update', payload);
    return payload;
  });
  ipcMain.handle('bookmarks:remove', (_e, url) => {
    if (typeof url !== 'string') return bookmarksStore.data;
    bookmarksStore.data = bookmarksStore.data.filter(b => b.url !== url);
    bookmarksStore.save();
    const payload = bookmarksStore.data;
    broadcastToChrome('bookmarks:update', payload);
    return payload;
  });

  ipcMain.handle('history:list', () => historyStore.data);
  ipcMain.handle('history:add', (_e, entry) => {
    if (!entry || typeof entry.url !== 'string' || !SAFE_NAV.test(entry.url)) return false;
    addHistory(entry.url, String(entry.title || entry.url).slice(0, 300));
    return true;
  });
  ipcMain.handle('history:clear', () => {
    historyStore.data = []; historyStore.save();
    broadcastToChrome('history:update', []);
    return true;
  });
  ipcMain.handle('history:delete', (_e, id) => {
    historyStore.data = historyStore.data.filter(h => h.id !== id);
    historyStore.save();
    return true;
  });

  ipcMain.handle('browser:clear-data', async (_e, kind) => {
    try {
      if (kind === 'history') {
        historyStore.data = []; historyStore.save();
        broadcastToChrome('history:update', []);
        return true;
      }
      if (kind === 'cookies') {
        await session.defaultSession.clearStorageData({
          storages: ['cookies','localstorage','indexdb','websql','serviceworkers','cachestorage','shadercache'],
        });
        return true;
      }
      if (kind === 'cache') { await session.defaultSession.clearCache(); return true; }
      if (kind === 'downloads') { downloadingItems.clear(); broadcastDownloads(); return true; }
    } catch (e) { console.error('[clear-data]', kind, e); return false; }
    return false;
  });

  ipcMain.handle('session:save', (_e, data) => {
    const tabs = Array.isArray(data?.tabs)
      ? data.tabs.filter(t => t && typeof t.url === 'string' && SAFE_NAV.test(t.url)).slice(0, MAX_SESSION_TABS)
      : [];
    sessionStore.data.tabs = tabs; sessionStore.save();
    return true;
  });
  ipcMain.handle('session:load',  () => sessionStore.data.tabs || []);
  ipcMain.handle('session:clear', () => { sessionStore.data.tabs = []; sessionStore.save(); return true; });

  ipcMain.handle('settings:get', () => settingsStore.data);
  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settingsStore.data;

    const prevAdblocker = settingsStore.data.adblocker;

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!(key in patch)) continue;
      if (key === 'homepage') {
        const v = String(patch[key] || '');
        if (v === 'newtab' || /^https?:\/\//i.test(v)) settingsStore.data[key] = v;
      } else if (key === 'searchEngine') {
        if (ALLOWED_ENGINES.includes(patch[key])) settingsStore.data[key] = patch[key];
      } else if (key === 'theme') {
        if (ALLOWED_THEMES.includes(patch[key])) settingsStore.data[key] = patch[key];
      } else if (key === 'colorMode') {
        if (ALLOWED_MODES.includes(patch[key])) settingsStore.data[key] = patch[key];
      } else if (BOOL_KEYS.includes(key)) {
        settingsStore.data[key] = Boolean(patch[key]);
      }
    }
    settingsStore.save();

    if (prevAdblocker !== settingsStore.data.adblocker) {
      applyAdblockerToAllSessions();
    }

    const payload = settingsStore.data;
    broadcastToChrome('settings:update', payload);
    return payload;
  });
  ipcMain.handle('settings:reset', () => {
    settingsStore.data = { ...DEFAULT_SETTINGS };
    settingsStore.save();
    applyAdblockerToAllSessions();
    const payload = settingsStore.data;
    broadcastToChrome('settings:update', payload);
    return payload;
  });

  ipcMain.handle('shell:openPath', (_e, p) => (typeof p === 'string' && p) ? shell.openPath(p) : '');
  ipcMain.handle('shell:showItem', (_e, p) => { if (typeof p === 'string' && p) shell.showItemInFolder(p); });
}

// ============================================================
//  SESSION SAVE / RESTORE
// ============================================================
let saveTimer = null;
function saveSession() {
  if (!isLive(mainWindowState) || mainWindowState.isPrivate) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!isLive(mainWindowState)) return;
    const data = [];
    for (const t of mainWindowState.tabs.values()) {
      let url;
      try { url = t.sleeping ? t.savedUrl : (t.wc.getURL() || t.url); }
      catch { url = t.url; }
      if (url && !url.startsWith('about:') && !isInternalPageUrl(url)) {
        data.push({ url, title: t.title });
      }
    }
    sessionStore.data.tabs = data.slice(0, MAX_SESSION_TABS);
    sessionStore.save();
  }, 800);
}

async function restoreSession(ws) {
  if (!isLive(ws)) return;
  if (ws.isPrivate) { createTab(ws); return; }
  if (settingsStore?.data?.restoreSession === false) { createTab(ws); return; }
  const saved = sessionStore.data.tabs || [];
  if (saved.length) {
    saved.forEach((s, i) => createTab(ws, s.url, { activate: i === 0 }));
  } else {
    createTab(ws);
  }
}

// ============================================================
//  URL HELPERS
// ============================================================
function safeNavUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 8192) return null;
  try {
    const u = new URL(raw);
    if (['javascript:','data:','blob:','vbscript:','filesystem:'].includes(u.protocol)) return null;
    return u.href;
  } catch { return null; }
}

// ============================================================
//  APP LIFECYCLE
// ============================================================

setInterval(() => {
  const now = Date.now();
  for (const ws of winStates.values()) {
    if (!isLive(ws)) continue;
    for (const t of ws.tabs.values()) {
      if (t.id === ws.activeTabId || t.sleeping || t.pinned) continue;
      let url;
      try { url = t.wc.getURL(); } catch { continue; }
      if (!url || url.startsWith('about:') || isInternalPageUrl(url)) continue;
      try { if (t.wc.isCurrentlyAudible()) continue; } catch {}
      if (now - (t.lastActive || 0) > TAB_SLEEP_MS) {
        t.savedUrl = url;
        t.sleeping = true;
        try { t.wc.loadURL('about:blank'); }
        catch { t.sleeping = false; t.savedUrl = null; }
        sendTabMeta(ws, t);
      }
    }
  }
}, TAB_SLEEP_TICK);

app.whenReady().then(async () => {
  initStores();

  try { await initAdBlocker(); } catch (e) { console.error('[startup] adblocker init threw', e); }

  attachSessionHandlers(session.defaultSession);

  app.on('session-created', (sess) => {
    attachSessionHandlers(sess);
    attachAdBlockerToSession(sess);
  });

  registerIpc();
  createBrowserWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (winStates.size === 0) createBrowserWindow(); });
app.on('before-quit', () => {
  if (settingsStore?.data?.clearHistoryOnExit) {
    historyStore.data = []; historyStore.save();
  }
});

process.on('uncaughtException', (e) => {
  if (e && /Object has been destroyed/.test(e.message)) return;
  console.error('[uncaught]', e);
});
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));