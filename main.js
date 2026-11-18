// Anni - a 3D corduroy plush who lives on your desktop.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZES = { small: [210, 245], medium: [270, 315], large: [360, 420] };
const HOTKEY = 'CommandOrControl+Alt+A';

let win = null;
let tray = null;
let ticker = null;
let quitting = false;
let twin = null, twinSize = [0, 0], twinLast = '';
let settings = { size: 'medium', walk: true, sound: true, follow: false, autostart: false, visible: true };

/* ---------- settings ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'anni-settings.json');
function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch (_) { /* first run */ }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (_) {}
}

/* ---------- single instance: launching again just wakes Anni ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showAnni());
}

/* ---------- window ---------- */
function createWindow() {
  const [w, h] = SIZES[settings.size] || SIZES.medium;
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: w, height: h,
    x: wa.x + wa.width - w - 60,
    y: wa.y + wa.height - h,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (settings.visible) win.showInactive(); });
  win.on('closed', () => { win = null; });

  ticker = setInterval(() => {
    if (!win || !win.isVisible()) return;
    const b = win.getBounds();
    const p = screen.getCursorScreenPoint();
    const work = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea;
    win.webContents.send('tick', { cx: p.x - b.x, cy: p.y - b.y, sx: p.x, sy: p.y, work });
  }, 33);
}

function setVisible(v) {
  settings.visible = v; saveSettings();
  if (!win) return;
  if (v) { win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver'); } else { win.hide(); closeTwin(); send('action', 'endfight'); }
  buildTrayMenu();
}
function showAnni() { setVisible(true); win && win.webContents.send('action', 'hi'); }
const toggleAnni = () => setVisible(!(win && win.isVisible()));
const send = (channel, data) => win && win.webContents.send(channel, data);

function setSize(name) {
  settings.size = name; saveSettings();
  if (!win) return;
  const [w, h] = SIZES[name];
  const b = win.getBounds();
  win.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: b.y + b.height - h, width: w, height: h });
  send('bounds', win.getBounds());
  buildTrayMenu();
}

/* ---------- menus ---------- */
function actionItems() {
  return [
    { label: 'Say hi', click: () => send('action', 'hi') },
    { label: 'Hop', click: () => send('action', 'hop') },
    { label: 'Spin', click: () => send('action', 'spin') },
    { label: 'Dance', click: () => send('action', 'dance') },
    { label: 'Sit down', click: () => send('action', 'sit') },
    { label: 'Stand up', click: () => send('action', 'stand') },
    { label: 'Sing a song', click: () => send('action', 'sing') },
    { label: 'Do a backflip', click: () => send('action', 'flip') },
    { label: 'Say something', click: () => send('action', 'talk') },
    { label: 'Come to my mouse', click: () => send('action', 'come') },
    { label: 'Pixel twin fight! (or stop it)', click: () => send('action', 'twin') },
    { label: 'Take a nap', click: () => send('action', 'sleep') },
  ];
}
function buildTemplate() {
  const visible = !!(win && win.isVisible());
  return [
    { label: visible ? 'Put Anni away' : 'Wake Anni up', click: toggleAnni },
    { type: 'separator' },
    ...(visible ? actionItems().concat([{ type: 'separator' }]) : []),
    { label: 'Wander around', type: 'checkbox', checked: settings.walk, click: (i) => { settings.walk = i.checked; saveSettings(); send('settings', { walk: settings.walk }); } },
    { label: 'Follow my mouse', type: 'checkbox', checked: settings.follow, click: (i) => { settings.follow = i.checked; saveSettings(); send('settings', { follow: settings.follow }); } },
    { label: 'Squeaks and sounds', type: 'checkbox', checked: settings.sound, click: (i) => { settings.sound = i.checked; saveSettings(); send('settings', { sound: settings.sound }); } },
    {
      label: 'Size',
      submenu: ['small', 'medium', 'large'].map((n) => ({ label: n[0].toUpperCase() + n.slice(1), type: 'radio', checked: settings.size === n, click: () => setSize(n) })),
    },
    { label: 'Start Anni when I log in', type: 'checkbox', checked: settings.autostart, click: (i) => { setAutostart(i.checked); } },
    { type: 'separator' },
    { label: 'Quit Anni', click: () => { quitting = true; app.quit(); } },
  ];
}
function buildTrayMenu() { if (tray) tray.setContextMenu(Menu.buildFromTemplate(buildTemplate())); }

function setAutostart(on) {
  settings.autostart = on; saveSettings();
  try {
    app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
  } catch (_) {}
  buildTrayMenu();
}

function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  if (process.platform === 'darwin') img = img.resize({ width: 18, height: 18 });
  tray = new Tray(img);
  tray.setToolTip('Anni (click to wake / put away)');
  tray.on('click', toggleAnni);
  buildTrayMenu();
}

/* ---------- IPC from Anni's window ---------- */
ipcMain.handle('init', () => ({ settings: { walk: settings.walk, sound: settings.sound, follow: settings.follow, size: settings.size }, bounds: win.getBounds(), platform: process.platform }));
ipcMain.on('win:setPos', (_e, x, y) => {
  if (!win) return;
  const [w, h] = SIZES[settings.size];
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });   // setBounds (not setPosition) avoids DPI size drift
});
ipcMain.on('win:ignore', (_e, ignore) => {
  if (win && process.platform !== 'linux') win.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('win:contextMenu', () => {
  if (win) Menu.buildFromTemplate(buildTemplate()).popup({ window: win });
});

/* ---------- pixel twin: a puppet window that Anni's renderer directs ---------- */
function closeTwin() { if (twin) { twin.destroy(); twin = null; } }
ipcMain.on('twin:open', (_e, b) => {
  closeTwin();
  twinSize = [Math.round(b.w), Math.round(b.h)]; twinLast = '';
  twin = new BrowserWindow({
    x: Math.round(b.x), y: Math.round(b.y), width: twinSize[0], height: twinSize[1],
    transparent: true, frame: false, resizable: false, hasShadow: false, focusable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  twin.setAlwaysOnTop(true, 'screen-saver');
  twin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  twin.loadFile(path.join(__dirname, 'renderer', 'twin.html'));
  twin.once('ready-to-show', () => twin && twin.showInactive());
  twin.on('closed', () => { twin = null; });
});
ipcMain.on('twin:update', (_e, st) => {
  if (!twin) return;
  const key = Math.round(st.x) + ',' + Math.round(st.y);
  if (key !== twinLast) { twinLast = key; twin.setBounds({ x: Math.round(st.x), y: Math.round(st.y), width: twinSize[0], height: twinSize[1] }); }
  twin.webContents.send('twin:state', st);
});
ipcMain.on('twin:close', closeTwin);
ipcMain.on('twin:click', () => send('twin:clicked'));

/* ---------- lifecycle ---------- */
app.whenReady().then(() => {
  loadSettings();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createWindow();
  createTray();
  try { globalShortcut.register(HOTKEY, toggleAnni); } catch (_) {}
});
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('before-quit', () => { quitting = true; clearInterval(ticker); });
app.on('will-quit', () => globalShortcut.unregisterAll());
