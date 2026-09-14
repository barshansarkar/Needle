// Load the Ghostery adblocker preload FIRST.
// It must run in the same isolated world as contextBridge so it can
// hook DOM mutations and inject cosmetic filters.
try { require('@ghostery/adblocker-electron-preload'); }
catch (e) { /* package not installed — adblocking cosmetic filters disabled */ }

// ... the rest of your existing preload-webview.js below, unchanged ...

const { contextBridge, ipcRenderer } = require('electron');


const isStr = (v, max = 4096) => typeof v === 'string' && v.length <= max;
const isObj = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const isInt = (v) => Number.isInteger(v);

const safeInvoke = (channel, payload, validator) => {
  if (validator && !validator(payload)) return Promise.resolve(null);
  try { return ipcRenderer.invoke(channel, payload); }
  catch { return Promise.resolve(null); }
};

const ALLOWED_LISTEN = new Set(['downloads:update','settings:update','history:update']);

contextBridge.exposeInMainWorld('novaAPI', {
  // Navigation from internal pages
  navigate: (url) => safeInvoke('guest:navigate', url, (v) => isStr(v, 8192)),

  // Suggestions (clean IPC — no more console.log hacks)
  suggest: (query) => safeInvoke('guest:suggest', query, (v) => isStr(v, 256)),

  // Open internal page
  openInternal: (name) => {
    const OK = ['history','downloads','settings','newtab'];
    if (!OK.includes(name)) return;
    ipcRenderer.send('guest:open-internal', name);
  },

  // History
  historyList:   ()   => ipcRenderer.invoke('history:list'),
  historyClear:  ()   => ipcRenderer.invoke('history:clear'),
  historyDelete: (id) => safeInvoke('history:delete', id, isInt),

  // Settings
  settingsGet:   ()      => ipcRenderer.invoke('settings:get'),
  settingsSet:   (patch) => safeInvoke('settings:set', patch, isObj),
  settingsReset: ()      => ipcRenderer.invoke('settings:reset'),

  // Shell
  openPath: (p) => safeInvoke('shell:openPath', p, (v) => isStr(v)),
  showItem: (p) => safeInvoke('shell:showItem', p, (v) => isStr(v)),

  // Listeners
  on: (channel, cb) => {
    if (!ALLOWED_LISTEN.has(channel)) return () => {};
    if (typeof cb !== 'function') return () => {};
    const wrapped = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});