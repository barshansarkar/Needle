// ============================================================
//  CONFIG
// ============================================================
const DEBUG = false;
const dlog = (...args) => { if (DEBUG) console.log('[niddle]', ...args); };

const TAB_SLEEP_MS = 5 * 60 * 1000;   // 5 minutes
const TAB_SLEEP_TICK = 30 * 1000;     // check every 30s

// ============================================================
//  ICONS
// ============================================================
const ICONS = {
  favicon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>`,
  loading: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.56"/><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.85s" repeatCount="indefinite"/></svg>`,
  secure: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>`,
  internal: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2.5 13.8 7.7 19 9.5l-5.2 1.8L12 16.5 10.2 11.3 5 9.5l5.2-1.8z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4-7 4v-16a1 1 0 0 1 1-1z"/></svg>`,
  starEmpty: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3.5 14.7 9l6.1.9-4.4 4.3 1 6L12 17.5 6.6 20.2l1-6L3.2 9.9 9.3 9z"/></svg>`,
  starFilled: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3.5 14.7 9l6.1.9-4.4 4.3 1 6L12 17.5 6.6 20.2l1-6L3.2 9.9 9.3 9z"/></svg>`,
};

// ============================================================
//  DOM
// ============================================================
const tabsEl        = document.getElementById('tabs');
const viewsEl       = document.getElementById('views');
const urlInput      = document.getElementById('url');
const findbar       = document.getElementById('findbar');
const findInput     = document.getElementById('find-input');
const findCount     = document.getElementById('find-count');
const zoomBadge     = document.getElementById('zoom-reset');
const starBtn       = document.getElementById('star');
const bookmarkBar   = document.getElementById('bookmark-bar');
const suggestionsEl = document.getElementById('suggestions');
const settingsBtn   = document.getElementById('settings-btn');
const dlToast       = document.getElementById('dl-toast');
const dlToastText   = document.getElementById('dl-toast-text');
const dlToastOpen   = document.getElementById('dl-toast-open');
const dlToastClose  = document.getElementById('dl-toast-close');

// ============================================================
//  STATE
// ============================================================
let tabs = [];
let activeId = null;
let bookmarks = [];
let downloadsCache = [];
let saveTimer = null;
let currentSettings = null;

const isPrivate = window.browserAPI?.isPrivate === true;
const PRIVATE_PARTITION = isPrivate ? 'private-' + crypto.randomUUID() : null;

const BASE = window.location.href.replace(/\/[^/]*$/, '');
const PAGE = (name) => `${BASE}/pages/${name}.html`;
const NEWTAB_URL    = PAGE('newtab');
const HISTORY_URL   = PAGE('history');
const DOWNLOADS_URL = PAGE('downloads');
const SETTINGS_URL  = PAGE('settings');

let webviewPreloadPath = null;
const preloadReady = browserAPI
  .webviewPreloadPath()
  .then((p) => { webviewPreloadPath = p; })
  .catch(() => { webviewPreloadPath = null; });

// ============================================================
//  CONSTANTS
// ============================================================
const SEARCH_ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google:     'https://www.google.com/search?q=',
  bing:       'https://www.bing.com/search?q=',
  brave:      'https://search.brave.com/search?q=',
  startpage:  'https://www.startpage.com/sp/search?query=',
  ecosia:     'https://www.ecosia.org/search?q=',
};

const THEMES = {
  purple: { accent: '#8b5cf6', accent2: '#ec4899' },
  blue:   { accent: '#3b82f6', accent2: '#06b6d4' },
  green:  { accent: '#10b981', accent2: '#84cc16' },
  orange: { accent: '#f97316', accent2: '#fbbf24' },
  pink:   { accent: '#ec4899', accent2: '#f43f5e' },
  red:    { accent: '#ef4444', accent2: '#f97316' },
  slate:  { accent: '#64748b', accent2: '#94a3b8' },
  mono:   { accent: '#e5e5e5', accent2: '#a1a1aa' },
};

// ============================================================
//  HELPERS
// ============================================================
const activeTab  = () => tabs.find(t => t.id === activeId);
const activeView = () => activeTab()?.view;
const isInternalPage = (url) => typeof url === 'string' && url.includes('/src/pages/');
const isNewTabUrl = (url) => typeof url === 'string' && url.includes('newtab');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function getHomepageUrl() {
  const s = currentSettings;
  if (!s || s.homepage === 'newtab') return NEWTAB_URL;
  return s.homepage;
}

// ============================================================
//  GUEST → HOST BRIDGE
// ============================================================
function sendToGuest(view, payload) {
  if (!view) return;
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  try {
    const p = view.executeJavaScript(
      `window.__novaHostMessage && window.__novaHostMessage(${json});`
    );
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (err) {
    dlog('bridge executeJavaScript failed', err);
  }
}

function handleSuggestRequest(view, query, reqId) {
  dlog('handleSuggestRequest', query, reqId);
  sendToGuest(view, { stage: 'received', query, reqId });

  if (!query || query.length < 2) {
    sendToGuest(view, { stage: 'error', reason: 'query too short', query, reqId });
    return;
  }
  if (currentSettings?.suggestions === false) {
    sendToGuest(view, { stage: 'error', reason: 'suggestions disabled', query, reqId });
    return;
  }

  browserAPI.searchSuggest(query)
    .then((items) => {
      const arr = Array.isArray(items) ? items : [];
      dlog('suggest results:', arr.length);
      sendToGuest(view, { stage: 'results', query, reqId, items: arr });
    })
    .catch((err) => {
      sendToGuest(view, { stage: 'error', reason: String(err?.message || err), query, reqId });
    });
}

function handleNavigateRequest(url) {
  if (!url) return;
  const t = activeTab();
  if (t && t.isInternal && isNewTabUrl(t.view.getURL() || '')) {
    navigateTab(t, url);
  } else {
    createTab(url, { activate: !currentSettings?.backgroundTabs });
  }
}

// ============================================================
//  SETTINGS
// ============================================================
function applyTheme(themeName) {
  const t = THEMES[themeName] || THEMES.purple;
  document.documentElement.style.setProperty('--accent', t.accent);
  document.documentElement.style.setProperty('--accent-2', t.accent2);
  const r = parseInt(t.accent.slice(1, 3), 16);
  const g = parseInt(t.accent.slice(3, 5), 16);
  const b = parseInt(t.accent.slice(5, 7), 16);
  document.documentElement.style.setProperty('--glow', `0 0 24px rgba(${r}, ${g}, ${b}, 0.45)`);
}

function applySettings(s) {
  currentSettings = s;
  applyTheme(s.theme);
  document.body.classList.toggle('no-animations',   s.animations === false);
  document.body.classList.toggle('hide-bookmarks',  s.showBookmarkBar === false);
  document.body.classList.toggle('no-favicons',     s.showFavicons === false);
  document.body.classList.toggle('compact-tabs',    s.compactTabs === true);
  document.body.classList.toggle('mode-darker',     s.colorMode === 'darker');
  document.body.classList.toggle('mode-system',     s.colorMode === 'system');
}

async function loadSettings() {
  try {
    const s = await browserAPI.settingsGet();
    applySettings(s);
  } catch (e) {
    console.warn('settings load failed', e);
  }
}

browserAPI.on('settings:update', (s) => applySettings(s));

// ============================================================
//  WINDOW CONTROLS
// ============================================================
document.getElementById('min-btn').onclick   = () => browserAPI.minimize();
document.getElementById('max-btn').onclick   = () => browserAPI.maximize();
document.getElementById('close-btn').onclick = () => {
  if (currentSettings?.confirmCloseAll && tabs.length > 1) {
    if (!confirm(`Close all ${tabs.length} tabs?`)) return;
  }
  browserAPI.close();
};

if (isPrivate) document.getElementById('private-badge').classList.remove('hidden');

// ============================================================
//  SHORTCUTS
// ============================================================
function handleShortcut({ ctrl, shift, alt, key, preventDefault }) {
  const k = String(key || '').toLowerCase();
  if (!k) return false;

  if (ctrl && shift && k === 'n') { preventDefault(); browserAPI.openIncognito(); return true; }

  if (ctrl && !shift && k === 't') { preventDefault(); createTab(); return true; }
  if (ctrl && !shift && k === 'w') { preventDefault(); if (activeId) closeTab(activeId); return true; }
  if (ctrl && k === 'tab' && !shift) {
    preventDefault();
    if (tabs.length > 1) {
      const i = tabs.findIndex(t => t.id === activeId);
      activateTab(tabs[(i + 1) % tabs.length].id);
    }
    return true;
  }
  if (ctrl && k === 'tab' && shift) {
    preventDefault();
    if (tabs.length > 1) {
      const i = tabs.findIndex(t => t.id === activeId);
      activateTab(tabs[(i - 1 + tabs.length) % tabs.length].id);
    }
    return true;
  }

  if (ctrl && !shift && k === 'l') { preventDefault(); urlInput.focus(); urlInput.select(); return true; }
  if (ctrl && !shift && k === 'r') { preventDefault(); activeView()?.reload(); return true; }
  if (ctrl && shift && k === 'r') { preventDefault(); activeView()?.reloadIgnoringCache(); return true; }
  if (ctrl && !shift && k === 'f') { preventDefault(); showFindBar(); return true; }

  if (ctrl && !shift && k === 'h') { preventDefault(); document.getElementById('history-btn').click(); return true; }
  if (ctrl && !shift && k === 'j') { preventDefault(); document.getElementById('downloads-btn').click(); return true; }
  if (ctrl && !shift && k === 'd') { preventDefault(); starBtn.click(); return true; }
  if (ctrl && k === ',') { preventDefault(); settingsBtn.click(); return true; }

  if (ctrl && (k === '=' || k === '+')) { preventDefault(); zoomIn(); return true; }
  if (ctrl && k === '-') { preventDefault(); zoomOut(); return true; }
  if (ctrl && k === '0') { preventDefault(); zoomReset(); return true; }

  if (k === 'f12') { preventDefault(); activeView()?.openDevTools(); return true; }
  if (ctrl && shift && k === 'i') { preventDefault(); activeView()?.openDevTools(); return true; }

  if (alt && !ctrl && k === 'arrowleft')  { preventDefault(); const v = activeView(); if (v?.canGoBack())    v.goBack();    return true; }
  if (alt && !ctrl && k === 'arrowright') { preventDefault(); const v = activeView(); if (v?.canGoForward()) v.goForward(); return true; }

  return false;
}

document.addEventListener('keydown', (e) => {
  handleShortcut({
    ctrl:  e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt:   e.altKey,
    key:   e.key,
    preventDefault: () => e.preventDefault(),
  });
}, true);

// ============================================================
//  TAB CREATION
// ============================================================
const MAX_TABS = 40;

function createTab(url, { activate = true, record = true } = {}) {
  if (tabs.length >= MAX_TABS) {
    dlog('tab limit reached');
    return null;
  }
  if (!url) url = getHomepageUrl();

  const id = crypto.randomUUID();

  const view = document.createElement('webview');
  view.setAttribute('allowpopups', '');
  view.className = 'tab-view';
  view.setAttribute('partition', isPrivate ? PRIVATE_PARTITION : 'persist:main');

  const internal = isInternalPage(url);
  if (internal && webviewPreloadPath) {
    view.setAttribute('preload', webviewPreloadPath);
  }

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.id = id;
  tabEl.innerHTML = `
    <span class="favicon">${ICONS.favicon}</span>
    <span class="title">New Tab</span>
    <span class="close" title="Close tab">${ICONS.close}</span>
  `;
  tabEl.querySelector('.close').onclick = (e) => {
    e.stopPropagation();
    closeTab(id);
  };
  tabEl.onclick = () => activateTab(id);
  tabsEl.appendChild(tabEl);

  const tab = {
    id, view, el: tabEl,
    title: 'New Tab',
    url,
    zoom: 0,
    isInternal: internal,
    sleeping: false,
    savedUrl: null,
    lastActive: Date.now(),
    pinned: false,
  };
  tabs.push(tab);

  // ── Keyboard forwarding ──
  view.addEventListener('before-input-event', (event) => {
    const input = event.input || event;
    if (!input || input.type !== 'keyDown') return;
    if (input.isAutoRepeat) return;

    handleShortcut({
      ctrl:  !!(input.control || input.meta),
      shift: !!input.shift,
      alt:   !!input.alt,
      key:   input.key || '',
      preventDefault: () => event.preventDefault?.(),
    });
  });

  // ── Guest → Host via console-message ──
  view.addEventListener('console-message', (...args) => {
    let msg = '';
    for (const a of args) {
      if (typeof a === 'string' && a.indexOf('__NOVA_') === 0) {
        msg = a;
        break;
      }
      // New Electron API: event object with .message
      if (a && typeof a === 'object' && typeof a.message === 'string' && a.message.indexOf('__NOVA_') === 0) {
        msg = a.message;
        break;
      }
    }
    if (!msg) return;

    if (msg.startsWith('__NOVA_SUGGEST__')) {
      try {
        const data = JSON.parse(msg.slice('__NOVA_SUGGEST__'.length));
        if (data && typeof data.query === 'string') {
          handleSuggestRequest(view, data.query, data.reqId);
        }
      } catch {}
      return;
    }

    if (msg.startsWith('__NOVA_NAVIGATE__')) {
      try {
        const data = JSON.parse(msg.slice('__NOVA_NAVIGATE__'.length));
        if (data && typeof data.url === 'string') {
          handleNavigateRequest(data.url);
        }
      } catch {}
      return;
    }
  });

  // ── Lifecycle ──
  view.addEventListener('did-start-loading', () => {
    const f = tab.el?.querySelector('.favicon');
    if (f) f.innerHTML = ICONS.loading;
  });

  view.addEventListener('did-stop-loading', () => {
    const u = view.getURL();
    tab.url = u;
    tab.isInternal = isInternalPage(u);
    const f = tab.el?.querySelector('.favicon');
    if (f) f.innerHTML = tab.isInternal ? ICONS.internal : ICONS.secure;
    if (activeId === id) {
      urlInput.value = tab.isInternal ? '' : u;
      updateStar();
    }
  });

  view.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    const t = tab.el?.querySelector('.title');
    if (t) t.textContent = e.title;
  });

  view.addEventListener('did-navigate', (e) => {
    // Skip sleep transition
    if (e.url === 'about:blank') return;
    // Skip while sleeping
    if (tab.sleeping) return;

    tab.url = e.url;
    tab.isInternal = isInternalPage(e.url);
    if (activeId === id) {
      urlInput.value = tab.isInternal ? '' : e.url;
      updateStar();
    }
    if (record && !tab.isInternal && !isPrivate) {
      browserAPI.historyAdd({ url: e.url, title: view.getTitle() || e.url });
    }
    if (e.url !== NEWTAB_URL) saveSession();
  });

  view.addEventListener('did-navigate-in-page', (e) => {
    if (tab.sleeping) return;
    tab.url = e.url;
    if (activeId === id && !tab.isInternal) urlInput.value = e.url;
  });

  view.addEventListener('context-menu', (e) => {
    e.preventDefault();
    browserAPI.showContextMenu({
      x: e.params.x,
      y: e.params.y,
      linkURL: e.params.linkURL || '',
      srcURL: e.params.srcURL || '',
      selectionText: e.params.selectionText || '',
      isEditable: e.params.isEditable,
      editFlags: e.params.editFlags || {},
    });
  });

  view.addEventListener('found-in-page', (e) => {
    const { activeMatchOrdinal, matches } = e.result;
    findCount.textContent = `${activeMatchOrdinal}/${matches}`;
  });

  viewsEl.appendChild(view);
  view.setAttribute('src', url);

  if (activate) activateTab(id);
  return tab;
}

// ============================================================
//  NAVIGATION
// ============================================================
function normalizeUrl(input) {
  let url = String(input).trim();
  if (!url) return null;
  const looksLikeUrl = /^(https?:\/\/)|^[\w-]+\.[\w.-]+/.test(url);
  if (!looksLikeUrl) {
    const engine = currentSettings?.searchEngine || 'duckduckgo';
    const prefix = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
    return prefix + encodeURIComponent(url);
  }
  if (!/^https?:\/\//.test(url)) return 'https://' + url;
  return url;
}

function navigateTab(tab, rawUrl) {
  if (!tab) return;
  const url = normalizeUrl(rawUrl);
  if (!url) return;
  tab.view.loadURL(url);
}

function navigate(input) {
  const t = activeTab();
  if (!t) return;
  navigateTab(t, input);
}

// ============================================================
//  TAB ACTIVATION · single unified function
//  Handles: wake from sleep, focus, UI sync
// ============================================================
function activateTab(id) {
  activeId = id;

  const t = tabs.find(x => x.id === id);

  // Wake sleeping tab BEFORE activating
  let displayUrl = '';
  if (t) {
    t.lastActive = Date.now();

    if (t.sleeping && t.savedUrl) {
      const wakeUrl = t.savedUrl;
      t.sleeping = false;
      t.savedUrl = null;
      try { t.view.loadURL(wakeUrl); } catch {}
      displayUrl = wakeUrl;
    } else {
      try { displayUrl = t.view.getURL() || t.url || ''; }
      catch { displayUrl = t.url || ''; }
    }
  }

  tabs.forEach(x => {
    const on = x.id === id;
    x.el.classList.toggle('active', on);
    x.view.classList.toggle('active', on);
  });

  if (t) {
    urlInput.value = t.isInternal ? '' : displayUrl;
    updateZoomBadge(t.zoom);
    updateStar();
  }
  hideFindBar();
  hideSuggestions();
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const [tab] = tabs.splice(idx, 1);

  try { tab.view.stop(); } catch {}
  try { tab.view.loadURL('about:blank'); } catch {}
  try { tab.view.remove(); } catch {}
  try { tab.el.remove(); } catch {}

  tab.view = null;
  tab.el = null;

  if (tabs.length === 0) {
    if (isPrivate) return browserAPI.close();
    return createTab();
  }
  if (activeId === id) activateTab(tabs[Math.max(0, idx - 1)].id);
  saveSession();
}

// ============================================================
//  TAB SLEEP · unload inactive tabs after 5 minutes
// ============================================================
setInterval(() => {
  const now = Date.now();
  tabs.forEach(t => {
    if (t.id === activeId) return;
    if (t.sleeping) return;
    if (t.pinned) return;
    if (!t.view || typeof t.view.getURL !== 'function') return;

    const url = t.view.getURL() || '';
    if (!url) return;
    if (url.startsWith('about:')) return;
    if (isInternalPage(url)) return;

    // Never sleep audible tabs (music/video playing)
    try {
      if (typeof t.view.isCurrentlyAudible === 'function' && t.view.isCurrentlyAudible()) return;
    } catch {}

    const last = t.lastActive || 0;
    if (now - last > TAB_SLEEP_MS) {
      t.savedUrl = url;
      t.sleeping = true;
      try {
        t.view.loadURL('about:blank');
        dlog('sleeping tab:', t.title, '(' + Math.round((now - last) / 60000) + 'm idle)');
      } catch {
        t.sleeping = false;
        t.savedUrl = null;
      }
    }
  });
}, TAB_SLEEP_TICK);

// ============================================================
//  SEARCH SUGGESTIONS (host URL bar)
// ============================================================
let suggestTimer = null;
let suggestItems = [];
let suggestIndex = -1;
let suggestRequestId = 0;

function hideSuggestions() {
  suggestionsEl.classList.add('hidden');
  suggestionsEl.innerHTML = '';
  suggestItems = [];
  suggestIndex = -1;
}

function renderSuggestions(items, query) {
  suggestItems = items;
  suggestIndex = -1;

  if (!items.length) return hideSuggestions();

  const q = query.toLowerCase();
  suggestionsEl.innerHTML = items.map((s, i) => {
    const lower = String(s).toLowerCase();
    const matchIdx = lower.indexOf(q);
    let html = escapeHtml(s);
    if (matchIdx >= 0) {
      html =
        escapeHtml(String(s).slice(0, matchIdx)) +
        '<b>' + escapeHtml(String(s).slice(matchIdx, matchIdx + q.length)) + '</b>' +
        escapeHtml(String(s).slice(matchIdx + q.length));
    }
    return `
      <div class="sug-item" data-idx="${i}" data-value="${encodeURIComponent(s)}">
        <span class="sug-icon">${ICONS.search}</span>
        <span class="sug-text">${html}</span>
        <span class="sug-type">Search</span>
      </div>
    `;
  }).join('');

  suggestionsEl.classList.remove('hidden');

  suggestionsEl.querySelectorAll('.sug-item').forEach(el => {
    el.onmousedown = (e) => {
      e.preventDefault();
      const value = decodeURIComponent(el.dataset.value);
      navigate(value);
      hideSuggestions();
      urlInput.blur();
    };
  });
}

function setActiveSuggestion(idx) {
  const items = suggestionsEl.querySelectorAll('.sug-item');
  items.forEach((el, i) => el.classList.toggle('active', i === idx));
  suggestIndex = idx;
  if (idx >= 0 && items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
}

async function fetchSuggestions(query) {
  const myId = ++suggestRequestId;
  try {
    const items = await browserAPI.searchSuggest(query);
    if (myId !== suggestRequestId) return;
    renderSuggestions(items || [], query);
  } catch {
    if (myId === suggestRequestId) hideSuggestions();
  }
}

// ============================================================
//  URL INPUT
// ============================================================
urlInput.addEventListener('input', () => {
  if (currentSettings?.suggestions === false) return hideSuggestions();
  const v = urlInput.value.trim();
  clearTimeout(suggestTimer);
  if (!v || v.length < 2) return hideSuggestions();
  if (/^(https?:\/\/)|^[\w-]+\.[\w.-]+(\/|$)/.test(v)) return hideSuggestions();
  suggestTimer = setTimeout(() => fetchSuggestions(v), 100);
});

urlInput.addEventListener('keydown', (e) => {
  const open = !suggestionsEl.classList.contains('hidden');

  if (e.key === 'ArrowDown' && open) {
    e.preventDefault();
    setActiveSuggestion((suggestIndex + 1) % suggestItems.length);
    return;
  }
  if (e.key === 'ArrowUp' && open) {
    e.preventDefault();
    setActiveSuggestion((suggestIndex - 1 + suggestItems.length) % suggestItems.length);
    return;
  }
  if (e.key === 'Enter') {
    if (suggestIndex >= 0 && suggestItems[suggestIndex]) {
      navigate(suggestItems[suggestIndex]);
    } else {
      navigate(urlInput.value);
    }
    hideSuggestions();
    urlInput.blur();
    return;
  }
  if (e.key === 'Escape') {
    hideSuggestions();
    urlInput.blur();
  }
});

urlInput.addEventListener('focus', () => urlInput.select());
urlInput.addEventListener('blur', () => setTimeout(hideSuggestions, 120));

document.getElementById('back').onclick    = () => { const v = activeView(); if (v?.canGoBack()) v.goBack(); };
document.getElementById('forward').onclick = () => { const v = activeView(); if (v?.canGoForward()) v.goForward(); };
document.getElementById('reload').onclick  = () => activeView()?.reload();
document.getElementById('new-tab').onclick = () => createTab();

// ============================================================
//  ZOOM
// ============================================================
function updateZoomBadge(level) {
  zoomBadge.textContent = `${Math.round(Math.pow(1.2, level) * 100)}%`;
}
function zoomIn()    { const t = activeTab(); if (!t || t.zoom >= 8) return; t.zoom++; t.view.setZoomLevel(t.zoom); updateZoomBadge(t.zoom); }
function zoomOut()   { const t = activeTab(); if (!t || t.zoom <= -5) return; t.zoom--; t.view.setZoomLevel(t.zoom); updateZoomBadge(t.zoom); }
function zoomReset() { const t = activeTab(); if (!t) return; t.zoom = 0; t.view.setZoomLevel(0); updateZoomBadge(0); }
document.getElementById('zoom-in').onclick    = zoomIn;
document.getElementById('zoom-out').onclick   = zoomOut;
document.getElementById('zoom-reset').onclick = zoomReset;

document.getElementById('devtools').onclick = () => activeView()?.openDevTools();

// ============================================================
//  FIND
// ============================================================
function showFindBar() {
  findbar.classList.remove('hidden');
  findInput.focus();
  findInput.select();
}
function hideFindBar() {
  findbar.classList.add('hidden');
  activeView()?.stopFindInPage('clearSelection');
  findCount.textContent = '0/0';
}
let findDebounce = null;
findInput.addEventListener('input', () => {
  clearTimeout(findDebounce);
  const q = findInput.value;
  if (!q) {
    activeView()?.stopFindInPage('clearSelection');
    findCount.textContent = '0/0';
    return;
  }
  findDebounce = setTimeout(() => {
    activeView()?.findInPage(q, { forward: true, findNext: false });
  }, 80);
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') activeView()?.findInPage(findInput.value, { forward: !e.shiftKey, findNext: true });
  if (e.key === 'Escape') hideFindBar();
});
document.getElementById('find-next').onclick  = () => activeView()?.findInPage(findInput.value, { forward: true, findNext: true });
document.getElementById('find-prev').onclick  = () => activeView()?.findInPage(findInput.value, { forward: false, findNext: true });
document.getElementById('find-close').onclick = hideFindBar;

// ============================================================
//  BOOKMARKS
// ============================================================
async function loadBookmarks() {
  bookmarks = (await browserAPI.bookmarksList()) || [];
  renderBookmarkBar();
  updateStar();
}

function renderBookmarkBar() {
  bookmarkBar.innerHTML = bookmarks.map(b => `
    <div class="bm-item" data-url="${encodeURIComponent(b.url)}">
      <span class="fav">${ICONS.bookmark}</span>
      <span>${escapeHtml(b.title || b.url)}</span>
      <span class="bm-remove" title="Remove">${ICONS.close}</span>
    </div>
  `).join('');

  bookmarkBar.querySelectorAll('.bm-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.bm-remove')) return;
      const url = decodeURIComponent(el.dataset.url);
      const t = activeTab();
      if (t && t.isInternal && isNewTabUrl(t.view.getURL() || '')) navigateTab(t, url);
      else createTab(url, { activate: !currentSettings?.backgroundTabs });
    });
    el.querySelector('.bm-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = decodeURIComponent(el.dataset.url);
      bookmarks = await browserAPI.bookmarksRemove(url) || [];
      renderBookmarkBar();
      updateStar();
    });
  });
}

function updateStar() {
  const t = activeTab();
  if (!t || t.isInternal) {
    starBtn.classList.remove('active');
    starBtn.innerHTML = ICONS.starEmpty;
    return;
  }
  let url = '';
  try { url = t.view.getURL() || ''; } catch {}
  const isBookmarked = bookmarks.some(b => b.url === url);
  starBtn.classList.toggle('active', isBookmarked);
  starBtn.innerHTML = isBookmarked ? ICONS.starFilled : ICONS.starEmpty;
}

starBtn.onclick = async () => {
  const t = activeTab();
  if (!t || t.isInternal) return;
  const url = t.view.getURL();
  if (!url) return;
  if (bookmarks.some(b => b.url === url)) {
    bookmarks = await browserAPI.bookmarksRemove(url) || [];
  } else {
    bookmarks = await browserAPI.bookmarksAdd({ url, title: t.view.getTitle() || url }) || [];
  }
  renderBookmarkBar();
  updateStar();
};

browserAPI.on('bookmarks:update', (list) => {
  bookmarks = list || [];
  renderBookmarkBar();
  updateStar();
});

// ============================================================
//  INTERNAL PAGES
// ============================================================
document.getElementById('history-btn').onclick = () => {
  const t = activeTab();
  if (t && t.isInternal) navigateTab(t, HISTORY_URL);
  else createTab(HISTORY_URL, { record: false });
};

document.getElementById('downloads-btn').onclick = () => {
  const t = activeTab();
  if (t && t.isInternal) navigateTab(t, DOWNLOADS_URL);
  else createTab(DOWNLOADS_URL, { record: false });
};

settingsBtn.onclick = () => {
  const t = activeTab();
  if (t && t.isInternal) navigateTab(t, SETTINGS_URL);
  else createTab(SETTINGS_URL, { record: false });
};

// ============================================================
//  DOWNLOADS
// ============================================================
browserAPI.on('downloads:update', (list) => {
  downloadsCache = list || [];
  tabs.forEach(t => {
    if (t.isInternal && t.view && (t.view.getURL() || '').includes('downloads.html')) {
      try { t.view.send('downloads:update', downloadsCache); } catch {}
    }
  });
});

browserAPI.on('downloads:auto-open', () => {
  const latest = downloadsCache[0];
  if (latest) {
    dlToastText.textContent = `Downloaded: ${latest.filename}`;
    dlToastOpen.onclick = () => {
      if (latest.savePath) browserAPI.openPath(latest.savePath);
      dlToast.classList.add('hidden');
    };
    dlToast.classList.remove('hidden');
    clearTimeout(window.__dlToastTimer);
    window.__dlToastTimer = setTimeout(() => dlToast.classList.add('hidden'), 6000);
  }
});

dlToastClose.onclick = () => dlToast.classList.add('hidden');

// ============================================================
//  MESSAGES FROM INTERNAL PAGES · postMessage fallback
// ============================================================
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;

  if (d.type === 'nova-navigate' && d.url) {
    handleNavigateRequest(d.url);
    return;
  }

  if (d.type === 'nova-suggest' && typeof d.query === 'string') {
    const query = d.query.trim();
    if (query.length < 2) return;
    if (currentSettings?.suggestions === false) return;

    const t = activeTab();
    if (!t || !t.isInternal || !isNewTabUrl(t.view.getURL() || '')) return;

    handleSuggestRequest(t.view, query, d.reqId);
  }
});

// ============================================================
//  SESSION
//  Uses savedUrl when a tab is sleeping so we don't persist about:blank
// ============================================================
function saveSession() {
  if (isPrivate) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const data = tabs.map(t => {
      let url = '';
      if (t.sleeping && t.savedUrl) {
        url = t.savedUrl;
      } else {
        try { url = t.view.getURL() || t.url || ''; }
        catch { url = t.url || ''; }
      }
      return { url, title: t.title };
    }).filter(t =>
      t.url &&
      t.url !== 'about:blank' &&
      !t.url.startsWith('about:') &&
      !isInternalPage(t.url)
    );
    await browserAPI.sessionSave({ tabs: data });
  }, 800);
}

async function restoreSession() {
  if (isPrivate) { createTab(); return; }
  if (currentSettings && currentSettings.restoreSession === false) {
    createTab();
    return;
  }
  const saved = await browserAPI.sessionLoad();
  if (saved && saved.length) {
    saved.forEach((s, i) => createTab(s.url, { activate: i === 0 }));
  } else {
    createTab();
  }
}

// ============================================================
//  CONTEXT MENU CALLBACKS
// ============================================================
browserAPI.on('ctx:back',    () => { const v = activeView(); if (v?.canGoBack()) v.goBack(); });
browserAPI.on('ctx:forward', () => { const v = activeView(); if (v?.canGoForward()) v.goForward(); });
browserAPI.on('ctx:reload',  () => activeView()?.reload());
browserAPI.on('ctx:inspect', (x, y) => { activeView()?.inspectElement(x, y); activeView()?.openDevTools(); });
browserAPI.on('ctx:open-link-new-tab', (url) => createTab(url, { activate: !currentSettings?.backgroundTabs }));
browserAPI.on('ctx:search-text', (text) => {
  const engine = currentSettings?.searchEngine || 'duckduckgo';
  const prefix = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
  createTab(prefix + encodeURIComponent(text), { activate: !currentSettings?.backgroundTabs });
});

// ============================================================
//  EXTERNAL NEW TAB
// ============================================================
browserAPI.onNewTab((url) => createTab(url, { activate: !currentSettings?.backgroundTabs }));

// ============================================================
//  BOOT
// ============================================================
(async () => {
  await preloadReady;
  await loadSettings();
  await loadBookmarks();
  await restoreSession();
})();