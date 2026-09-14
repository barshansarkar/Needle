const { contextBridge, ipcRenderer } = require('electron');

const isPrivate = process.argv.includes('--nova-private=1');

const ALLOWED_LISTEN = new Set([
  'tab:created', 'tab:closed', 'tab:updated', 'tab:activated', 'tab:reordered',
  'focus-url', 'show-find', 'toggle-bookmark',
  'find:result',
  'open-new-tab',
  'bookmarks:update', 'downloads:update', 'downloads:auto-open',
  'settings:update', 'history:update',
]);

const isStr = (v, max = 8192) => typeof v === 'string' && v.length <= max;
const isObj = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const isUrl = (v) => { if (!isStr(v, 8192)) return false; try { new URL(v); return true; } catch { return false; } };
const isHttpUrl = (v) => isStr(v, 8192) && /^https?:\/\//i.test(v);
const isInt = (v) => Number.isInteger(v);

const safeInvoke = (channel, payload, validator) => {
  if (validator && !validator(payload)) return Promise.resolve(null);
  try { return ipcRenderer.invoke(channel, payload); }
  catch { return Promise.resolve(null); }
};

contextBridge.exposeInMainWorld('browserAPI', {
  isPrivate,

  minimize:      () => ipcRenderer.send('window:minimize'),
  maximize:      () => ipcRenderer.send('window:maximize'),
  close:         () => ipcRenderer.send('window:close'),
  openIncognito: () => ipcRenderer.send('window:new-incognito'),

  setChromeBounds: (b) => {
    if (!isObj(b)) return;
    ipcRenderer.send('chrome:bounds', { height: Number(b.height) || 0 });
  },

  sendShortcut: (data) => {
    if (!isObj(data)) return;
    ipcRenderer.send('shortcut', {
      ctrl: !!data.ctrl, shift: !!data.shift, alt: !!data.alt,
      key: isStr(data.key, 32) ? data.key : '',
    });
  },

  tabCreate:   (opts) => safeInvoke('tab:create', isObj(opts) ? opts : {}),
  tabList:     ()     => ipcRenderer.invoke('tab:list'),
  tabClose:    (id)   => isStr(id, 64) && ipcRenderer.send('tab:close', id),
  tabActivate: (id)   => isStr(id, 64) && ipcRenderer.send('tab:activate', id),
  tabNavigate: (id, url) => {
    if (!isStr(id, 64) || !isStr(url, 8192)) return;
    ipcRenderer.send('tab:navigate', { id, url });
  },
  tabReorder: (id, index) => {
    if (!isStr(id, 64) || !isInt(index)) return;
    ipcRenderer.send('tab:reorder', { id, index });
  },
  tabAction:   (id, action) => {
    const OK = ['back','forward','reload','reloadHard','stop'];
    if (!isStr(id, 64) || !OK.includes(action)) return;
    ipcRenderer.send('tab:action', { id, action });
  },
  tabZoom:     (id, delta) => {
    if (!isStr(id, 64)) return;
    ipcRenderer.send('tab:zoom', { id, delta: Number(delta) || 0 });
  },
  tabFind:     (id, opts) => {
    if (!isStr(id, 64) || !isObj(opts)) return;
    ipcRenderer.send('tab:find', {
      id,
      text: isStr(opts.text, 200) ? opts.text : '',
      forward: opts.forward !== false,
      findNext: !!opts.findNext,
    });
  },
  tabFindStop: (id, action) => {
    if (!isStr(id, 64)) return;
    ipcRenderer.send('tab:find-stop', { id, action: action === 'keepSelection' ? 'keepSelection' : 'clearSelection' });
  },
  tabDevtools: (id) => isStr(id, 64) && ipcRenderer.send('tab:devtools', { id }),

  webviewPreloadPath: () => ipcRenderer.invoke('app:webviewPreloadPath'),

  searchSuggest: (q) => safeInvoke('search:suggest', q, (v) => isStr(v, 256)),

  onNewTab: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('open-new-tab', (_e, url) => { if (isHttpUrl(url)) cb(url); });
  },
  on: (channel, cb) => {
    if (!ALLOWED_LISTEN.has(channel)) return () => {};
    if (typeof cb !== 'function') return () => {};
    const wrapped = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  bookmarksList:   ()   => ipcRenderer.invoke('bookmarks:list'),
  bookmarksAdd:    (bm) => safeInvoke('bookmarks:add', bm, (v) =>
                        isObj(v) && isHttpUrl(v.url) &&
                        (v.title === undefined || isStr(v.title, 512))),
  bookmarksRemove: (url) => safeInvoke('bookmarks:remove', url, isHttpUrl),

  historyList:   ()   => ipcRenderer.invoke('history:list'),
  historyAdd:    (h)  => safeInvoke('history:add', h, (v) =>
                        isObj(v) && isHttpUrl(v.url) &&
                        (v.title === undefined || isStr(v.title, 512))),
  historyClear:  ()   => ipcRenderer.invoke('history:clear'),
  historyDelete: (id) => safeInvoke('history:delete', id, isInt),

  sessionSave:  (d) => safeInvoke('session:save', d, isObj),
  sessionLoad:  ()  => ipcRenderer.invoke('session:load'),
  sessionClear: ()  => ipcRenderer.invoke('session:clear'),

  settingsGet:   ()      => ipcRenderer.invoke('settings:get'),
  settingsSet:   (patch) => safeInvoke('settings:set', patch, isObj),
  settingsReset: ()      => ipcRenderer.invoke('settings:reset'),

  clearData: (kind) => {
    const KINDS = ['history','cookies','cache','downloads'];
    if (!KINDS.includes(kind)) return Promise.resolve(false);
    return ipcRenderer.invoke('browser:clear-data', kind);
  },

  openPath: (p) => safeInvoke('shell:openPath', p, (v) => isStr(v, 4096)),
  showItem: (p) => safeInvoke('shell:showItem', p, (v) => isStr(v, 4096)),
  
});