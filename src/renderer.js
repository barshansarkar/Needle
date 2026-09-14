// ════════════════════════════════════════════════════════════════
//  NIDDLE · renderer.js  v8
//  Optimistic close — UI updates instantly, main informed after
// ════════════════════════════════════════════════════════════════
console.log('%cNIDDLE renderer v8 loaded', 'color:#8b5cf6;font-weight:bold');

// ────────────────────────────────────────────────────────────────
//  CONFIG
// ────────────────────────────────────────────────────────────────
const MAX_NAV_URL_LEN     = 8192;
const MAX_SUGGEST_QUERY   = 256;
const MAX_SUGGEST_ITEMS   = 10;
const SUGGEST_TTL_MS      = 5 * 60 * 1000;
const SUGGEST_CACHE_MAX   = 100;

const SEARCH_ENGINES = Object.freeze({
  duckduckgo: 'https://duckduckgo.com/?q=',
  google:     'https://www.google.com/search?q=',
  bing:       'https://www.bing.com/search?q=',
  brave:      'https://search.brave.com/search?q=',
  startpage:  'https://www.startpage.com/sp/search?query=',
  ecosia:     'https://www.ecosia.org/search?q=',
});

const THEMES = Object.freeze({
  purple: { accent: '#8b5cf6', accent2: '#ec4899' },
  blue:   { accent: '#3b82f6', accent2: '#06b6d4' },
  green:  { accent: '#10b981', accent2: '#84cc16' },
  orange: { accent: '#f97316', accent2: '#fbbf24' },
  pink:   { accent: '#ec4899', accent2: '#f43f5e' },
  red:    { accent: '#ef4444', accent2: '#f97316' },
  slate:  { accent: '#64748b', accent2: '#94a3b8' },
  mono:   { accent: '#e5e5e5', accent2: '#a1a1aa' },
});

const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'blob:', 'vbscript:', 'filesystem:']);

// ────────────────────────────────────────────────────────────────
//  ICONS
// ────────────────────────────────────────────────────────────────
const ICONS = Object.freeze({
  favicon:  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>`,
  loading:  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.56"/><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.85s" repeatCount="indefinite"/></svg>`,
  secure:   `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>`,
  internal: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2.5 13.8 7.7 19 9.5l-5.2 1.8L12 16.5 10.2 11.3 5 9.5l5.2-1.8z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7"/></svg>`,
  close:    `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  search:   `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4-7 4v-16a1 1 0 0 1 1-1z"/></svg>`,
  starEmpty:`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3.5 14.7 9l6.1.9-4.4 4.3 1 6L12 17.5 6.6 20.2l1-6L3.2 9.9 9.3 9z"/></svg>`,
  starFilled:`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3.5 14.7 9l6.1.9-4.4 4.3 1 6L12 17.5 6.6 20.2l1-6L3.2 9.9 9.3 9z"/></svg>`,
});

// ────────────────────────────────────────────────────────────────
//  HELPERS
// ────────────────────────────────────────────────────────────────
const isStr    = (v, max = MAX_NAV_URL_LEN) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isObj    = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function safeUrl(raw) {
  if (!isStr(raw)) return null;
  try {
    const u = new URL(raw);
    if (BLOCKED_PROTOCOLS.has(u.protocol)) return null;
    return u.href;
  } catch { return null; }
}
function isBlockedProtocol(raw) {
  if (!isStr(raw)) return true;
  try { return BLOCKED_PROTOCOLS.has(new URL(raw).protocol); }
  catch { return true; }
}
function safeTabUrl(tab) {
  if (!tab || typeof tab.url !== 'string') return '';
  return tab.url.length > MAX_NAV_URL_LEN ? tab.url.slice(0, MAX_NAV_URL_LEN) : tab.url;
}
function isNewTabUrl(url) {
  return isStr(url) && url.includes('/newtab');
}
function looksLikeUrl(v) {
  return typeof v === 'string' && /^(https?:\/\/)|^[\w-]+\.[\w.-]+/.test(v);
}

// ────────────────────────────────────────────────────────────────
//  DOM REFS
// ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const tabsEl        = $('tabs');
const urlInput      = $('url');
const findbar       = $('findbar');
const findInput     = $('find-input');
const findCount     = $('find-count');
const zoomBadge     = $('zoom-reset');
const starBtn       = $('star');
const bookmarkBar   = $('bookmark-bar');
const suggestionsEl = $('suggestions');
const settingsBtn   = $('settings-btn');
const dlToast       = $('dl-toast');
const dlToastText   = $('dl-toast-text');
const dlToastOpen   = $('dl-toast-open');
const dlToastClose  = $('dl-toast-close');

// ────────────────────────────────────────────────────────────────
//  STATE
// ────────────────────────────────────────────────────────────────
const state = {
  tabs: [],
  activeId: null,
  bookmarks: [],
  downloads: [],
  settings: null,
  toastTimer: null,
};

const isPrivate = window.browserAPI?.isPrivate === true;

// ────────────────────────────────────────────────────────────────
//  INTERNAL PAGE URLS
// ────────────────────────────────────────────────────────────────
const BASE = window.location.href.replace(/\/[^/]*$/, '');
const PAGE = (name) => `${BASE}/pages/${name}.html`;
const HISTORY_URL   = PAGE('history');
const DOWNLOADS_URL = PAGE('downloads');
const SETTINGS_URL  = PAGE('settings');

const activeTab = () => state.tabs.find(t => t.id === state.activeId);

// ────────────────────────────────────────────────────────────────
//  SUGGESTION CACHE
// ────────────────────────────────────────────────────────────────
const suggestCache = new Map();
const recentQueries = [];

function cacheGet(q) {
  const hit = suggestCache.get(q);
  if (!hit) return null;
  if (Date.now() - hit.ts > SUGGEST_TTL_MS) { suggestCache.delete(q); return null; }
  suggestCache.delete(q);
  suggestCache.set(q, hit);
  return hit.items;
}
function cacheSet(q, items) {
  suggestCache.set(q, { items, ts: Date.now() });
  while (suggestCache.size > SUGGEST_CACHE_MAX) {
    const oldest = suggestCache.keys().next().value;
    suggestCache.delete(oldest);
  }
}
function rememberQuery(q) {
  const i = recentQueries.indexOf(q);
  if (i !== -1) recentQueries.splice(i, 1);
  recentQueries.unshift(q);
  if (recentQueries.length > 10) recentQueries.pop();
}
function clearSuggestionCache() {
  suggestCache.clear();
  recentQueries.length = 0;
}

async function fetchSuggestionsDirect(query) {
  const ql = query.toLowerCase();
  const [ddg, gg] = await Promise.all([
    fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}`, {
      headers: { 'Accept': 'application/json' },
    })
      .then(r => r.json())
      .then(d => Array.isArray(d)
        ? d.map(x => typeof x === 'string' ? x : x?.phrase).filter(Boolean)
        : [])
      .catch(() => []),
    fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`, {
      headers: { 'Accept': 'application/json' },
    })
      .then(r => r.json())
      .then(d => Array.isArray(d) && Array.isArray(d[1]) ? d[1].filter(Boolean) : [])
      .catch(() => []),
  ]);
  const seen = new Set([ql]);
  const out = [];
  for (const item of [...ddg, ...gg]) {
    const s = String(item).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_SUGGEST_ITEMS) break;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
//  CHROME HEIGHT REPORTING
// ────────────────────────────────────────────────────────────────
function measureChromeHeight() {
  let h = 0;
  for (const sel of ['.chrome-top', '.chrome-toolbar', '.bookmark-bar']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom > h) h = r.bottom;
  }
  return Math.ceil(h);
}
function reportChromeBounds() {
  try { browserAPI.setChromeBounds({ height: measureChromeHeight() }); } catch {}
}
const chromeRO = new ResizeObserver(reportChromeBounds);
for (const sel of ['.chrome-top', '.chrome-toolbar', '.bookmark-bar']) {
  const el = document.querySelector(sel);
  if (el) chromeRO.observe(el);
}
window.addEventListener('resize', reportChromeBounds);

// ────────────────────────────────────────────────────────────────
//  THEME / SETTINGS
// ────────────────────────────────────────────────────────────────
function applyTheme(themeName) {
  const t = THEMES[themeName] || THEMES.purple;
  const r = parseInt(t.accent.slice(1, 3), 16);
  const g = parseInt(t.accent.slice(3, 5), 16);
  const b = parseInt(t.accent.slice(5, 7), 16);
  const root = document.documentElement.style;
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-2', t.accent2);
  root.setProperty('--glow', `0 0 24px rgba(${r}, ${g}, ${b}, 0.45)`);
}
function applySettings(s) {
  if (!isObj(s)) return;
  state.settings = s;
  applyTheme(s.theme);
  document.body.classList.toggle('no-animations',   s.animations === false);
  document.body.classList.toggle('hide-bookmarks',  s.showBookmarkBar === false);
  document.body.classList.toggle('no-favicons',     s.showFavicons === false);
  document.body.classList.toggle('compact-tabs',    s.compactTabs === true);
  document.body.classList.toggle('mode-darker',     s.colorMode === 'darker');
  document.body.classList.toggle('mode-system',     s.colorMode === 'system');
  requestAnimationFrame(reportChromeBounds);
}

// ────────────────────────────────────────────────────────────────
//  URL NORMALIZATION
// ────────────────────────────────────────────────────────────────
function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) return null;
  if (url.length > MAX_NAV_URL_LEN) url = url.slice(0, MAX_NAV_URL_LEN);
  if (!looksLikeUrl(url)) {
    const engine = state.settings?.searchEngine || 'duckduckgo';
    const prefix = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
    return prefix + encodeURIComponent(url);
  }
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  return safeUrl(url);
}

// ────────────────────────────────────────────────────────────────
//  WINDOW CONTROLS
// ────────────────────────────────────────────────────────────────
$('min-btn').onclick   = () => browserAPI.minimize();
$('max-btn').onclick   = () => browserAPI.maximize();
$('close-btn').onclick = () => {
  if (state.settings?.confirmCloseAll && state.tabs.length > 1) {
    if (!confirm(`Close all ${state.tabs.length} tabs?`)) return;
  }
  browserAPI.close();
};

if (isPrivate) $('private-badge').classList.remove('hidden');

// ────────────────────────────────────────────────────────────────
//  KEYBOARD
// ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement === urlInput) {
    hideSuggestions();
    urlInput.blur();
  }
}, true);

// ════════════════════════════════════════════════════════════════
//  TAB STRIP — full rebuild every render
// ════════════════════════════════════════════════════════════════
let dragState = null;

function renderTabStrip() {
  if (dragState) return;   // don't destroy the element mid-drag

  tabsEl.replaceChildren();

  for (const t of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab';
    el.dataset.id = t.id;
    if (t.id === state.activeId) el.classList.add('active');
    if (t.sleeping) el.classList.add('sleeping');

    let favHtml = ICONS.secure;
    if (t.isLoading)          favHtml = ICONS.loading;
    else if (t.isInternal)    favHtml = ICONS.internal;
    else if (t.favicon)       favHtml = `<img src="${escapeHtml(t.favicon)}" alt="" style="width:14px;height:14px;border-radius:2px" onerror="this.remove()">`;

    const label = t.title || (isNewTabUrl(t.url) ? 'New Tab' : (t.url || 'New Tab'));

    el.innerHTML =
      `<span class="favicon">${favHtml}</span>` +
      `<span class="title">${escapeHtml(label)}</span>` +
      `<span class="close" role="button" aria-label="Close tab" title="Close tab">${ICONS.close}</span>`;

    tabsEl.appendChild(el);
  }
}

// ════════════════════════════════════════════════════════════════
//  OPTIMISTIC CLOSE
//  UI updates instantly — we don't wait for main to confirm.
// ════════════════════════════════════════════════════════════════
function closeTabLocal(id) {
  if (!id) return;
  const idx = state.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const wasActive = state.activeId === id;

  // 1) Remove from local state right away
  state.tabs = state.tabs.filter(t => t.id !== id);

  // 2) If it was active, pick a neighbour locally and tell main to follow
  if (wasActive) {
    if (state.tabs.length === 0) {
      state.activeId = null;
    } else {
      const nextIdx = Math.min(idx, state.tabs.length - 1);
      state.activeId = state.tabs[nextIdx].id;
      try { browserAPI.tabActivate(state.activeId); } catch {}
    }
  }

  // 3) Repaint — tab vanishes instantly
  renderTabStrip();
  updateActiveUI();

  // 4) Now inform main (fire-and-forget)
  try { browserAPI.tabClose(id); }
  catch (err) { console.error('[niddle] tabClose threw', err); }
}

// ════════════════════════════════════════════════════════════════
//  TAB EVENT DELEGATION  (one handler per event, no overlap)
// ════════════════════════════════════════════════════════════════
tabsEl.addEventListener('pointerdown', (e) => {
  const tabEl    = e.target.closest ? e.target.closest('.tab')   : null;
  const closeBtn = e.target.closest ? e.target.closest('.close') : null;
  if (!tabEl) return;

  // Close button — close IMMEDIATELY, don't wait for click
  if (closeBtn) {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    console.log('[niddle] ✕ close', tabEl.dataset.id.slice(0,8));
    closeTabLocal(tabEl.dataset.id);
    return;
  }

  // Body — start drag (click vs drag decided on pointerup)
  if (e.button === 0) beginTabDrag(e, tabEl);
}, true);

tabsEl.addEventListener('click', (e) => {
  const tabEl = e.target.closest ? e.target.closest('.tab') : null;
  if (!tabEl) return;
  if (e.target.closest('.close')) return;   // already handled by pointerdown
  browserAPI.tabActivate(tabEl.dataset.id);
}, true);

tabsEl.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;
  const tabEl = e.target.closest ? e.target.closest('.tab') : null;
  if (!tabEl) return;
  e.preventDefault();
  closeTabLocal(tabEl.dataset.id);
}, true);

// ════════════════════════════════════════════════════════════════
//  MANUAL POINTER DRAG  (tab reorder)
// ════════════════════════════════════════════════════════════════
function beginTabDrag(downEv, tabEl) {
  if (dragState) return;

  const id = tabEl.dataset.id;
  const startX = downEv.clientX;
  const startY = downEv.clientY;
  let moved = false;
  let ghost = null;

  dragState = { id, el: tabEl, ghost: null, moved: false };

  function onMove(ev) {
    if (!dragState) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    if (!moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      moved = true;
      dragState.moved = true;
      const rect = tabEl.getBoundingClientRect();
      ghost = tabEl.cloneNode(true);
      ghost.classList.add('tab-ghost');
      Object.assign(ghost.style, {
        position: 'fixed',
        left: rect.left + 'px',
        top: rect.top + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
        pointerEvents: 'none',
        zIndex: '9999',
      });
      document.body.appendChild(ghost);
      dragState.ghost = ghost;
      tabEl.classList.add('dragging');
      document.body.classList.add('tab-dragging');
    }

    if (!moved) return;

    const rect = tabEl.getBoundingClientRect();
    ghost.style.left = (rect.left + dx) + 'px';
    ghost.style.top  = (rect.top  + dy) + 'px';

    const others = [...tabsEl.querySelectorAll('.tab')].filter(x => x !== tabEl);
    let insertBeforeEl = null;
    for (const other of others) {
      const r = other.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      if (ev.clientX < mid) { insertBeforeEl = other; break; }
    }
    if (insertBeforeEl) tabsEl.insertBefore(tabEl, insertBeforeEl);
    else                tabsEl.appendChild(tabEl);
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    try { tabEl.releasePointerCapture(downEv.pointerId); } catch {}

    if (ghost) { ghost.remove(); ghost = null; }
    tabEl.classList.remove('dragging');
    document.body.classList.remove('tab-dragging');

    const wasDrag = dragState && dragState.moved;
    dragState = null;

    if (wasDrag) {
      const order = [...tabsEl.querySelectorAll('.tab')].map(x => x.dataset.id);
      const byId = new Map(state.tabs.map(t => [t.id, t]));
      const next = [];
      for (const tid of order) { const t = byId.get(tid); if (t) next.push(t); }
      for (const t of state.tabs) if (!order.includes(t.id)) next.push(t);
      state.tabs = next;
      const newIndex = order.indexOf(id);
      if (newIndex >= 0) {
        try { browserAPI.tabReorder(id, newIndex); }
        catch (err) { console.error('[niddle] tabReorder threw', err); }
      }
    }
  }

  try { tabEl.setPointerCapture(downEv.pointerId); } catch {}

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// ════════════════════════════════════════════════════════════════
//  EVENTS FROM MAIN
// ════════════════════════════════════════════════════════════════
browserAPI.on('tab:created', (t) => {
  if (!t || !t.id) return;
  if (!state.tabs.some(x => x.id === t.id)) state.tabs.push(t);
  renderTabStrip();
});

browserAPI.on('tab:updated', (t) => {
  if (!t || !t.id) return;
  const i = state.tabs.findIndex(x => x.id === t.id);
  if (i === -1) state.tabs.push(t);
  else state.tabs[i] = { ...state.tabs[i], ...t };
  renderTabStrip();
  if (t.id === state.activeId) updateActiveUI();
});

browserAPI.on('tab:closed', ({ id } = {}) => {
  console.log('[niddle] tab:closed event:', id ? id.slice(0,8) : '?');
  if (!id) return;
  const before = state.tabs.length;
  state.tabs = state.tabs.filter(x => x.id !== id);

  // Main closed a tab we hadn't already removed — repaint
  if (state.tabs.length !== before) {
    if (state.activeId === id) {
      // Main closed the active tab — main will also send tab:activated
      state.activeId = null;
    }
    renderTabStrip();
    updateActiveUI();
  }
});

browserAPI.on('tab:activated', ({ id } = {}) => {
  if (!id) return;
  // Only accept activation for a tab we actually know about
  if (!state.tabs.some(t => t.id === id)) {
    // Unknown id — state is stale, request a fresh list
    browserAPI.tabList().then((data) => {
      if (!data) return;
      state.tabs = Array.isArray(data.tabs) ? data.tabs : [];
      state.activeId = data.activeId || null;
      renderTabStrip();
      updateActiveUI();
    }).catch(() => {});
    return;
  }
  state.activeId = id;
  renderTabStrip();
  updateActiveUI();
  hideFindBar();
  hideSuggestions();
});

browserAPI.on('tab:reordered', ({ order } = {}) => {
  if (!Array.isArray(order)) return;
  const byId = new Map(state.tabs.map(t => [t.id, t]));
  const next = [];
  for (const tid of order) { const t = byId.get(tid); if (t) next.push(t); }
  for (const t of state.tabs) if (!order.includes(t.id)) next.push(t);
  state.tabs = next;
  renderTabStrip();
});

browserAPI.on('focus-url', () => {
  urlInput.focus();
  urlInput.select();
});
browserAPI.on('show-find', () => showFindBar());
browserAPI.on('toggle-bookmark', () => starBtn.click());
browserAPI.on('find:result', ({ activeMatchOrdinal = 0, matches = 0 } = {}) => {
  findCount.textContent = `${activeMatchOrdinal}/${matches}`;
});
browserAPI.on('bookmarks:update', (list) => {
  state.bookmarks = Array.isArray(list) ? list : [];
  renderBookmarkBar();
  updateStar();
});
browserAPI.on('downloads:update', (list) => {
  state.downloads = Array.isArray(list) ? list : [];
});
browserAPI.on('downloads:auto-open', () => {
  const latest = state.downloads[0];
  if (!latest) return;
  dlToastText.textContent = `Downloaded: ${latest.filename}`;
  dlToastOpen.onclick = () => {
    if (latest.savePath) browserAPI.openPath(latest.savePath);
    dlToast.classList.add('hidden');
  };
  dlToast.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => dlToast.classList.add('hidden'), 6000);
});
browserAPI.on('settings:update', (s) => {
  applySettings(s);
  if (s && s.suggestions === false) clearSuggestionCache();
});
browserAPI.on('history:update', () => {});

browserAPI.onNewTab((url) => {
  const safe = safeUrl(url);
  if (!safe) return;
  browserAPI.tabCreate({ url: safe, activate: !state.settings?.backgroundTabs });
});

// ════════════════════════════════════════════════════════════════
//  TOOLBAR ACTIONS
// ════════════════════════════════════════════════════════════════
$('back').onclick    = () => { const t = activeTab(); if (t) browserAPI.tabAction(t.id, 'back'); };
$('forward').onclick = () => { const t = activeTab(); if (t) browserAPI.tabAction(t.id, 'forward'); };
$('reload').onclick  = () => { const t = activeTab(); if (t) browserAPI.tabAction(t.id, 'reload'); };
$('new-tab').onclick = () => browserAPI.tabCreate();
$('devtools').onclick = () => { const t = activeTab(); if (t) browserAPI.tabDevtools(t.id); };

// ════════════════════════════════════════════════════════════════
//  ZOOM
// ════════════════════════════════════════════════════════════════
function updateZoomBadge(level) {
  zoomBadge.textContent = `${Math.round(Math.pow(1.2, level) * 100)}%`;
}
$('zoom-in').onclick    = () => { const t = activeTab(); if (!t || t.zoom >= 8)  return; browserAPI.tabZoom(t.id,  1); };
$('zoom-out').onclick   = () => { const t = activeTab(); if (!t || t.zoom <= -5) return; browserAPI.tabZoom(t.id, -1); };
$('zoom-reset').onclick = () => { const t = activeTab(); if (!t) return;                  browserAPI.tabZoom(t.id,  0); };

// ════════════════════════════════════════════════════════════════
//  FIND BAR
// ════════════════════════════════════════════════════════════════
function showFindBar() {
  findbar.classList.remove('hidden');
  findInput.focus();
  findInput.select();
}
function hideFindBar() {
  findbar.classList.add('hidden');
  const t = activeTab();
  if (t) browserAPI.tabFindStop(t.id, 'clearSelection');
  findCount.textContent = '0/0';
}

let findDebounce = null;
findInput.addEventListener('input', () => {
  clearTimeout(findDebounce);
  const t = activeTab();
  if (!t) return;
  const q = findInput.value;
  if (!q) {
    browserAPI.tabFindStop(t.id, 'clearSelection');
    findCount.textContent = '0/0';
    return;
  }
  findDebounce = setTimeout(() => {
    browserAPI.tabFind(t.id, { text: q, forward: true, findNext: false });
  }, 80);
});
findInput.addEventListener('keydown', (e) => {
  const t = activeTab();
  if (!t) return;
  if (e.key === 'Enter') browserAPI.tabFind(t.id, { text: findInput.value, forward: !e.shiftKey, findNext: true });
  if (e.key === 'Escape') hideFindBar();
});
$('find-next').onclick  = () => { const t = activeTab(); if (t) browserAPI.tabFind(t.id, { text: findInput.value, forward: true,  findNext: true }); };
$('find-prev').onclick  = () => { const t = activeTab(); if (t) browserAPI.tabFind(t.id, { text: findInput.value, forward: false, findNext: true }); };
$('find-close').onclick = hideFindBar;

// ════════════════════════════════════════════════════════════════
//  SUGGESTIONS UI
// ════════════════════════════════════════════════════════════════
let suggestTimer = null;
let suggestItems = [];
let suggestIndex = -1;
let suggestRequestId = 0;

function hideSuggestions() {
  suggestionsEl.classList.add('hidden');
  suggestionsEl.replaceChildren();
  suggestItems = [];
  suggestIndex = -1;
}

function renderSuggestions(items, query) {
  suggestItems = Array.isArray(items) ? items.slice(0, MAX_SUGGEST_ITEMS) : [];
  suggestIndex = -1;
  if (!suggestItems.length) return hideSuggestions();

  const q = query.toLowerCase();
  suggestionsEl.innerHTML = suggestItems.map((s, i) => {
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
      navigate(decodeURIComponent(el.dataset.value));
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
  if (!isStr(query, MAX_SUGGEST_QUERY) || query.length < 2) return;

  const cached = cacheGet(query);
  if (cached) {
    if (myId === suggestRequestId) renderSuggestions(cached, query);
    return;
  }

  for (let i = query.length - 1; i >= 2; i--) {
    const prefix = query.slice(0, i);
    const pre = cacheGet(prefix);
    if (pre) {
      const filtered = pre.filter(s =>
        String(s).toLowerCase().includes(query.toLowerCase())
      );
      if (filtered.length && myId === suggestRequestId) {
        renderSuggestions(filtered, query);
      }
      break;
    }
  }

  try {
    const items = await fetchSuggestionsDirect(query);
    if (myId !== suggestRequestId) return;
    cacheSet(query, items);
    rememberQuery(query);
    renderSuggestions(items, query);
    return;
  } catch {}

  try {
    const items = await browserAPI.searchSuggest(query);
    if (myId !== suggestRequestId) return;
    const arr = Array.isArray(items) ? items.slice(0, MAX_SUGGEST_ITEMS) : [];
    cacheSet(query, arr);
    rememberQuery(query);
    renderSuggestions(arr, query);
  } catch {
    if (myId === suggestRequestId) hideSuggestions();
  }
}

// ════════════════════════════════════════════════════════════════
//  URL INPUT
// ════════════════════════════════════════════════════════════════
urlInput.addEventListener('input', () => {
  if (state.settings?.suggestions === false) return hideSuggestions();
  const v = urlInput.value.trim();
  clearTimeout(suggestTimer);
  if (!v || v.length < 2) return hideSuggestions();
  if (looksLikeUrl(v)) return hideSuggestions();
  suggestTimer = setTimeout(() => fetchSuggestions(v), 100);
});

urlInput.addEventListener('keydown', (e) => {
  const open = !suggestionsEl.classList.contains('hidden');

  if (e.key === 'ArrowDown' && open && suggestItems.length) {
    e.preventDefault();
    setActiveSuggestion((suggestIndex + 1) % suggestItems.length);
    return;
  }
  if (e.key === 'ArrowUp' && open && suggestItems.length) {
    e.preventDefault();
    setActiveSuggestion((suggestIndex - 1 + suggestItems.length) % suggestItems.length);
    return;
  }
  if (e.key === 'Enter') {
    if (suggestIndex >= 0 && suggestItems[suggestIndex]) navigate(suggestItems[suggestIndex]);
    else navigate(urlInput.value);
    hideSuggestions();
    urlInput.blur();
    return;
  }
  if (e.key === 'Escape') {
    hideSuggestions();
    urlInput.blur();
  }
});

urlInput.addEventListener('focus', () => {
  urlInput.select();
  for (const q of recentQueries.slice(0, 2)) cacheGet(q);
});
urlInput.addEventListener('blur', () => setTimeout(hideSuggestions, 120));

// ════════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════════
function navigate(input) {
  const t = activeTab();
  if (!t) return;
  const url = normalizeUrl(input);
  if (!url || isBlockedProtocol(url)) return;
  browserAPI.tabNavigate(t.id, url);
}
function navigateTab(tab, rawUrl) {
  if (!tab) return;
  const url = normalizeUrl(rawUrl);
  if (!url || isBlockedProtocol(url)) return;
  browserAPI.tabNavigate(tab.id, url);
}

// ════════════════════════════════════════════════════════════════
//  ACTIVE UI
// ════════════════════════════════════════════════════════════════
function updateActiveUI() {
  const t = activeTab();

  if (document.activeElement !== urlInput) {
    if (t && !t.isInternal && t.url && !t.url.startsWith('about:')) {
      urlInput.value = t.url;
    } else {
      urlInput.value = '';
    }
  }

  $('back').disabled    = !(t && t.canGoBack);
  $('forward').disabled = !(t && t.canGoForward);
  updateZoomBadge(t?.zoom || 0);
  updateStar();
}

// ════════════════════════════════════════════════════════════════
//  BOOKMARKS
// ════════════════════════════════════════════════════════════════
async function loadBookmarks() {
  try { state.bookmarks = (await browserAPI.bookmarksList()) || []; }
  catch { state.bookmarks = []; }
  renderBookmarkBar();
  updateStar();
}

function renderBookmarkBar() {
  bookmarkBar.innerHTML = state.bookmarks.map(b => `
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
      if (t && t.isInternal && isNewTabUrl(t.url)) navigateTab(t, url);
      else browserAPI.tabCreate({ url, activate: !state.settings?.backgroundTabs });
    });
    el.querySelector('.bm-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = decodeURIComponent(el.dataset.url);
      try { state.bookmarks = (await browserAPI.bookmarksRemove(url)) || []; } catch {}
      renderBookmarkBar();
      updateStar();
    });
  });

  requestAnimationFrame(reportChromeBounds);
}

function updateStar() {
  const t = activeTab();
  if (!t || t.isInternal || !t.url) {
    starBtn.classList.remove('active');
    starBtn.innerHTML = ICONS.starEmpty;
    return;
  }
  const url = safeTabUrl(t);
  const isBookmarked = state.bookmarks.some(b => b.url === url);
  starBtn.classList.toggle('active', isBookmarked);
  starBtn.innerHTML = isBookmarked ? ICONS.starFilled : ICONS.starEmpty;
}

starBtn.onclick = async () => {
  const t = activeTab();
  if (!t || t.isInternal || !t.url) return;
  const url = safeTabUrl(t);
  if (!url) return;
  try {
    if (state.bookmarks.some(b => b.url === url)) {
      state.bookmarks = (await browserAPI.bookmarksRemove(url)) || [];
    } else {
      state.bookmarks = (await browserAPI.bookmarksAdd({
        url,
        title: String(t.title || url).slice(0, 300),
      })) || [];
    }
  } catch {}
  renderBookmarkBar();
  updateStar();
};

// ════════════════════════════════════════════════════════════════
//  INTERNAL PAGE BUTTONS
// ════════════════════════════════════════════════════════════════
$('history-btn').onclick = () => {
  const t = activeTab();
  if (t && t.isInternal) navigateTab(t, HISTORY_URL);
  else browserAPI.tabCreate({ url: HISTORY_URL, record: false });
};
$('downloads-btn').onclick = () => {
  const t = activeTab();
  if (t && t.isInternal) navigateTab(t, DOWNLOADS_URL);
  else browserAPI.tabCreate({ url: DOWNLOADS_URL, record: false });
};
settingsBtn.onclick = () => {
  const t = activeTab();
  if (t && t.isInternal) navigateTab(t, SETTINGS_URL);
  else browserAPI.tabCreate({ url: SETTINGS_URL, record: false });
};

// ════════════════════════════════════════════════════════════════
//  DOWNLOAD TOAST
// ════════════════════════════════════════════════════════════════
dlToastClose.onclick = () => dlToast.classList.add('hidden');

// ════════════════════════════════════════════════════════════════
//  LEGACY postMessage BRIDGE
// ════════════════════════════════════════════════════════════════
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!isObj(d)) return;

  if (d.type === 'nova-navigate' && isStr(d.url, MAX_NAV_URL_LEN)) {
    const safe = safeUrl(d.url);
    if (!safe) return;
    const t = activeTab();
    if (t && t.isInternal && isNewTabUrl(t.url)) navigateTab(t, safe);
    else browserAPI.tabCreate({ url: safe, activate: !state.settings?.backgroundTabs });
    return;
  }
  if (d.type === 'nova-suggest' && isStr(d.query, MAX_SUGGEST_QUERY)) {
    const query = d.query.trim();
    if (query.length < 2) return;
    if (state.settings?.suggestions === false) return;
    browserAPI.searchSuggest(query).then(items => {
      try { e.source?.postMessage({ stage: 'results', query, reqId: d.reqId, items }, '*'); } catch {}
    }).catch(() => {});
    return;
  }
});

// ════════════════════════════════════════════════════════════════
//  DEBUG API
// ════════════════════════════════════════════════════════════════
window.__niddle = {
  state,
  tabs: () => state.tabs,
  active: () => state.activeId,
  close: (id) => closeTabLocal(id || state.activeId),
  activate: (id) => browserAPI.tabActivate(id),
  api: () => window.browserAPI,
  resync: async () => {
    const data = await browserAPI.tabList();
    state.tabs = Array.isArray(data?.tabs) ? data.tabs : [];
    state.activeId = data?.activeId || null;
    renderTabStrip();
    updateActiveUI();
    console.log('[niddle] resynced', state.tabs.length, 'tabs');
  },
};

// ════════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════════
(async () => {
  console.log('[niddle] booting v8');

  try {
    const s = await browserAPI.settingsGet();
    applySettings(s);
  } catch {}

  await loadBookmarks();

  try {
    const data = await browserAPI.tabList();
    console.log('[niddle] initial tab list:', data);
    state.tabs = Array.isArray(data?.tabs) ? data.tabs : [];
    state.activeId = data?.activeId || null;
    renderTabStrip();
    updateActiveUI();
  } catch (err) {
    console.error('[niddle] tabList failed', err);
    state.tabs = [];
    state.activeId = null;
  }

  requestAnimationFrame(() => {
    reportChromeBounds();
    requestAnimationFrame(reportChromeBounds);
  });
})();

// Pause background animations when chrome isn't visible
document.addEventListener('visibilitychange', () => {
  document.body.style.setProperty(
    'animation-play-state',
    document.hidden ? 'paused' : 'running'
  );
});