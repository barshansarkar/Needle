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

const BASE = window.location.href.replace(/\/[^/]*$/, '');
const PAGE = (name) => `${BASE}/pages/${name}.html`;
const NEWTAB_URL    = PAGE('newtab');
const HISTORY_URL   = PAGE('history');
const DOWNLOADS_URL = PAGE('downloads');
const SETTINGS_URL  = PAGE('settings');

let webviewPreloadPath = null;
browserAPI.webviewPreloadPath().then(p => { webviewPreloadPath = p; });

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
  purple: { accent: '#7c5cff', accent2: '#ff5cd0' },
  blue:   { accent: '#3b82f6', accent2: '#06b6d4' },
  green:  { accent: '#10b981', accent2: '#84cc16' },
  orange: { accent: '#f97316', accent2: '#fbbf24' },
  pink:   { accent: '#ec4899', accent2: '#f43f5e' },
};

// ============================================================
//  HELPERS
// ============================================================
const activeTab  = () => tabs.find(t => t.id === activeId);
const activeView = () => activeTab()?.view;
const isInternalPage = (url) => typeof url === 'string' && url.includes('/src/pages/');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function getHomepageUrl() {
  const s = currentSettings;
  if (!s || s.homepage === 'newtab') return NEWTAB_URL;
  return s.homepage;
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
  document.body.classList.toggle('no-animations', !s.animations);
  document.body.classList.toggle('hide-bookmarks', !s.showBookmarkBar);
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
document.getElementById('close-btn').onclick = () => browserAPI.close();

if (isPrivate) document.getElementById('private-badge').classList.remove('hidden');

// ============================================================
//  TAB CREATION
// ============================================================
const MAX_TABS = 40;

function createTab(url, { activate = true, record = true } = {}) {
  if (tabs.length >= MAX_TABS) {
    console.warn('[nova] tab limit reached');
    return null;
  }
  if (!url) url = getHomepageUrl();

  const id = crypto.randomUUID();

  const view = document.createElement('webview');
  view.setAttribute('src', url);
  view.setAttribute('allowpopups', '');
  view.className = 'tab-view';
  view.setAttribute('partition', isPrivate ? 'private-' + Date.now() : 'persist:main');

  if (isInternalPage(url) && webviewPreloadPath) {
    view.setAttribute('preload', webviewPreloadPath);
  }

  viewsEl.appendChild(view);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.id = id;
  tabEl.innerHTML = `
    <span class="favicon">🌐</span>
    <span class="title">New Tab</span>
    <span class="close">✕</span>
  `;
  tabEl.querySelector('.close').onclick = (e) => { e.stopPropagation(); closeTab(id); };
  tabEl.onclick = () => activateTab(id);
  tabsEl.appendChild(tabEl);

  const tab = { id, view, el: tabEl, title: 'New Tab', url, zoom: 0, isInternal: isInternalPage(url) };
  tabs.push(tab);

  // Webview events
  view.addEventListener('did-start-loading', () => {
    tab.el.querySelector('.favicon').textContent = '⏳';
  });

  view.addEventListener('did-stop-loading', () => {
    const u = view.getURL();
    tab.url = u;
    tab.isInternal = isInternalPage(u);
    tab.el.querySelector('.favicon').textContent = tab.isInternal ? '✨' : '🔒';
    if (activeId === id) {
      urlInput.value = tab.isInternal ? '' : u;
      updateStar();
    }
  });

  view.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    tab.el.querySelector('.title').textContent = e.title;
  });

  view.addEventListener('did-navigate', (e) => {
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
    tab.url = e.url;
    if (activeId === id && !tab.isInternal) urlInput.value = e.url;
  });

  view.addEventListener('context-menu', (e) => {
    e.preventDefault();
    browserAPI.showContextMenu({
      x: e.params.x, y: e.params.y,
      linkURL: e.params.linkURL || '',
      srcURL: e.params.srcURL || '',
      selectionText: e.params.selectionText || '',
      isEditable: e.params.isEditable,
      editFlags: e.params.editFlags || {}
    });
  });

  view.addEventListener('found-in-page', (e) => {
    const { activeMatchOrdinal, matches } = e.result;
    findCount.textContent = `${activeMatchOrdinal}/${matches}`;
  });

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
//  TAB ACTIVATION / CLOSE
// ============================================================
function activateTab(id) {
  activeId = id;
  tabs.forEach(t => {
    const on = t.id === id;
    t.el.classList.toggle('active', on);
    t.view.classList.toggle('active', on);
  });
  const t = activeTab();
  if (t) {
    urlInput.value = t.isInternal ? '' : (t.view.getURL() || t.url || '');
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
  tab.view.remove();
  tab.el.remove();
  if (tabs.length === 0) {
    if (isPrivate) return browserAPI.close();
    return createTab();
  }
  if (activeId === id) activateTab(tabs[Math.max(0, idx - 1)].id);
  saveSession();
}

// ============================================================
//  SEARCH SUGGESTIONS
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
        <span class="sug-icon">🔍</span>
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
function showFindBar() { findbar.classList.remove('hidden'); findInput.focus(); findInput.select(); }
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
      <span class="fav">🔖</span>
      <span>${escapeHtml(b.title || b.url)}</span>
      <span class="bm-remove" title="Remove">✕</span>
    </div>
  `).join('');

  bookmarkBar.querySelectorAll('.bm-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('bm-remove')) return;
      const url = decodeURIComponent(el.dataset.url);
      const t = activeTab();
      if (t && t.isInternal && (t.view.getURL() || '').includes('newtab.html')) navigateTab(t, url);
      else createTab(url);
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
    starBtn.textContent = '☆';
    return;
  }
  const url = t.view.getURL() || '';
  const isBookmarked = bookmarks.some(b => b.url === url);
  starBtn.classList.toggle('active', isBookmarked);
  starBtn.textContent = isBookmarked ? '★' : '☆';
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
//  HISTORY / DOWNLOADS / SETTINGS PAGES
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
    if (t.isInternal && (t.view.getURL() || '').includes('downloads.html')) {
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
//  MESSAGES FROM INTERNAL PAGES
// ============================================================
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'nova-navigate' && d.url) {
    const t = activeTab();
    if (t && t.isInternal && (t.view.getURL() || '').includes('newtab.html')) navigateTab(t, d.url);
    else createTab(d.url);
  }
});

// ============================================================
//  SESSION
// ============================================================
function saveSession() {
  if (isPrivate) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const data = tabs
      .map(t => ({ url: t.view.getURL() || t.url, title: t.title }))
      .filter(t => t.url && !isInternalPage(t.url));
    await browserAPI.sessionSave({ tabs: data });
  }, 800);
}

async function restoreSession() {
  if (isPrivate) { createTab(); return; }
  // Respect "restoreSession" setting
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
browserAPI.on('ctx:open-link-new-tab', (url) => createTab(url));
browserAPI.on('ctx:search-text', (text) => {
  const engine = currentSettings?.searchEngine || 'duckduckgo';
  const prefix = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
  createTab(prefix + encodeURIComponent(text));
});

// ============================================================
//  KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;

  if (ctrl && shift && e.key.toLowerCase() === 'n') { e.preventDefault(); browserAPI.openIncognito(); return; }
  if (ctrl && e.key.toLowerCase() === 't' && !shift) { e.preventDefault(); createTab(); return; }
  if (ctrl && e.key.toLowerCase() === 'w' && !shift) { e.preventDefault(); if (activeId) closeTab(activeId); return; }
  if (ctrl && e.key.toLowerCase() === 'l') { e.preventDefault(); urlInput.focus(); return; }
  if (ctrl && e.key.toLowerCase() === 'r') { e.preventDefault(); activeView()?.reload(); return; }
  if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); showFindBar(); return; }
  if (ctrl && e.key.toLowerCase() === 'h' && !shift) { e.preventDefault(); document.getElementById('history-btn').click(); return; }
  if (ctrl && e.key.toLowerCase() === 'j' && !shift) { e.preventDefault(); document.getElementById('downloads-btn').click(); return; }
  if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); starBtn.click(); return; }
  if (ctrl && e.key === ',') { e.preventDefault(); settingsBtn.click(); return; }
  if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); return; }
  if (ctrl && e.key === '-') { e.preventDefault(); zoomOut(); return; }
  if (ctrl && e.key === '0') { e.preventDefault(); zoomReset(); return; }
  if (e.key === 'F12') { e.preventDefault(); activeView()?.openDevTools(); return; }
  if (ctrl && e.key === 'Tab' && !shift) {
    e.preventDefault();
    const i = tabs.findIndex(t => t.id === activeId);
    activateTab(tabs[(i + 1) % tabs.length].id);
    return;
  }
  if (ctrl && e.key === 'Tab' && shift) {
    e.preventDefault();
    const i = tabs.findIndex(t => t.id === activeId);
    activateTab(tabs[(i - 1 + tabs.length) % tabs.length].id);
    return;
  }
  if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); const v = activeView(); if (v?.canGoBack()) v.goBack(); }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); const v = activeView(); if (v?.canGoForward()) v.goForward(); }
}, true);

// ============================================================
//  EXTERNAL NEW TAB
// ============================================================
browserAPI.onNewTab((url) => createTab(url));

// ============================================================
//  BOOT
// ============================================================
(async () => {
  await loadSettings();
  await loadBookmarks();
  await restoreSession();
})();