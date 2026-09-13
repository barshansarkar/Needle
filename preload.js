const { contextBridge, ipcRenderer } = require('electron');

const isPrivate = process.argv.includes('--nova-private=1');

const ALLOWED_LISTEN = [
  'ctx:back', 'ctx:forward', 'ctx:reload',
  'ctx:inspect', 'ctx:open-link-new-tab', 'ctx:search-text',
  'bookmarks:update', 'downloads:update', 'downloads:auto-open',
  'settings:update', 'history:update',
  'open-new-tab'
];

contextBridge.exposeInMainWorld('browserAPI', {
  isPrivate,

  // window
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),
  openIncognito: () => ipcRenderer.send('window:new-incognito'),

  // webview preload path
  webviewPreloadPath: () => ipcRenderer.invoke('app:webviewPreloadPath'),

  // search suggestions
  searchSuggest: (q) => ipcRenderer.invoke('search:suggest', q),

  // context menu
  showContextMenu: (params) => ipcRenderer.send('webview:context-menu', params),

  // listeners
  onNewTab: (cb) => ipcRenderer.on('open-new-tab', (_e, url) => cb(url)),
  on: (channel, cb) => {
    if (ALLOWED_LISTEN.includes(channel)) {
      ipcRenderer.on(channel, (_e, ...args) => cb(...args));
    }
  },

  // bookmarks
  bookmarksList:   ()    => ipcRenderer.invoke('bookmarks:list'),
  bookmarksAdd:    (bm)  => ipcRenderer.invoke('bookmarks:add', bm),
  bookmarksRemove: (url) => ipcRenderer.invoke('bookmarks:remove', url),

  // history
  historyList:   ()   => ipcRenderer.invoke('history:list'),
  historyAdd:    (h)  => ipcRenderer.invoke('history:add', h),
  historyClear:  ()   => ipcRenderer.invoke('history:clear'),
  historyDelete: (id) => ipcRenderer.invoke('history:delete', id),

  // session
  sessionSave:  (d) => ipcRenderer.invoke('session:save', d),
  sessionLoad:  ()  => ipcRenderer.invoke('session:load'),
  sessionClear: ()  => ipcRenderer.invoke('session:clear'),

  // settings
  settingsGet:   ()      => ipcRenderer.invoke('settings:get'),
  settingsSet:   (patch) => ipcRenderer.invoke('settings:set', patch),
  settingsReset: ()      => ipcRenderer.invoke('settings:reset'),

  // clear browsing data
  clearData: (kind) => ipcRenderer.invoke('browser:clear-data', kind),

  // shell
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p)
});