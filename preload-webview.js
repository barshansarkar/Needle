const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novaAPI', {
  // history
  historyList:   ()   => ipcRenderer.invoke('history:list'),
  historyClear:  ()   => ipcRenderer.invoke('history:clear'),
  historyDelete: (id) => ipcRenderer.invoke('history:delete', id),

  // settings
  settingsGet:   ()      => ipcRenderer.invoke('settings:get'),
  settingsSet:   (patch) => ipcRenderer.invoke('settings:set', patch),
  settingsReset: ()      => ipcRenderer.invoke('settings:reset'),

  // shell
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),

  // listeners
  on: (channel, cb) => {
    if (channel === 'downloads:update' || channel === 'settings:update') {
      ipcRenderer.on(channel, (_e, payload) => cb(payload));
    }
  }
});