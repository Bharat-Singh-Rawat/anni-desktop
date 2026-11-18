const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('anniAPI', {
  init: () => ipcRenderer.invoke('init'),
  onTick: (cb) => on('tick', cb),
  onBounds: (cb) => on('bounds', cb),
  onAction: (cb) => on('action', cb),
  onSettings: (cb) => on('settings', cb),
  setPos: (x, y) => ipcRenderer.send('win:setPos', x, y),
  setIgnore: (ignore) => ipcRenderer.send('win:ignore', ignore),
  contextMenu: () => ipcRenderer.send('win:contextMenu'),
  // pixel twin (Anni's side directs, the twin window just draws)
  twinOpen: (b) => ipcRenderer.send('twin:open', b),
  twinUpdate: (st) => ipcRenderer.send('twin:update', st),
  twinClose: () => ipcRenderer.send('twin:close'),
  onTwinClick: (cb) => on('twin:clicked', cb),
  onTwinState: (cb) => on('twin:state', cb),
  twinClicked: () => ipcRenderer.send('twin:click'),
});
