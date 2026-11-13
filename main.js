const { app, BrowserWindow, protocol, net, session, Menu, shell, dialog, ipcMain, Tray, nativeImage, globalShortcut } = require('electron');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url'), { Readable } = require('stream');
const native = require('./native');
const ROOT = path.join(__dirname, 'app'), PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;
// Portable build: library, settings and cache live next to the .exe so everything travels with it.
if (PORTABLE) app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'DjApe1-data'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'djfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }]);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const tr = (el, en) => app.getLocale().startsWith('el') ? el : en;
const SETTINGS = path.join(app.getPath('userData'), 'settings.json');
let settings = { closeToTray: false };
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))); } catch (e) { }
const saveSettings = () => { try { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(settings)); } catch (e) { } };
const store = new native.LibraryStore(path.join(app.getPath('userData'), 'library'));

let win = null, tray = null, quitting = false, flushed = false, state = { playing: false, title: '', artist: '' };
const startHidden = process.argv.includes('--hidden');
const send = (ch, ...a) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); } catch (e) { } };
const argFiles = argv => argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith('-') && fs.existsSync(a) && (native.AUDIO_RE.test(a) || fs.statSync(a).isDirectory()));
let pendingOpen = argFiles(process.argv);

function resizeCover(buf) { const img = nativeImage.createFromBuffer(buf), s = img.getSize(); if (!s.width) throw new Error('bad image'); return 'data:image/jpeg;base64,' + img.resize({ width: Math.min(160, s.width) }).toJPEG(75).toString('base64'); }
const asset = n => nativeImage.createFromPath(path.join(__dirname, 'assets', n + '.png'));

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 600, backgroundColor: '#141413', title: 'Dj Ape1', autoHideMenuBar: true, show: !startHidden,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') } });
  win.loadURL('app://local/index.html');
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // The mini player is a small always-on-top window opened by the app itself (window.open with the name "djmini").
    if (frameName === 'djmini') return { action: 'allow', overrideBrowserWindowOptions: { width: 380, height: 190, minWidth: 300, minHeight: 130, alwaysOnTop: true, autoHideMenuBar: true, title: 'Dj Ape1', backgroundColor: '#141413', webPreferences: { contextIsolation: true, sandbox: true } } };
    shell.openExternal(url); return { action: 'deny' };
  });
  win.webContents.on('will-prevent-unload', e => { const el = app.getLocale().startsWith('el');
    if (dialog.showMessageBoxSync(win, { type: 'question', buttons: el ? ['Έξοδος', 'Άκυρο'] : ['Quit', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Dj Ape1', message: el ? 'Υπάρχουν μη αποθηκευμένες αλλαγές. Να γίνει έξοδος;' : 'There are unsaved changes. Quit anyway?' }) === 0) e.preventDefault(); });
  win.once('ready-to-show', updateThumbar);
  win.on('enter-full-screen', () => send('win:fs', true)); win.on('leave-full-screen', () => send('win:fs', false));
  // Closing: optionally hide to the tray; otherwise let the renderer save the library to disk first.
  win.on('close', e => {
    if (!quitting && settings.closeToTray) { e.preventDefault(); win.hide(); return; }
    if (!flushed) { e.preventDefault(); send('app:flush'); setTimeout(() => { flushed = true; quitting = true; if (win) win.close(); }, 4000); }
  });
  win.on('closed', () => { win = null; BrowserWindow.getAllWindows().forEach(w => { try { w.destroy(); } catch (e) { } }); });
}
const showWin = () => { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } };

// ---- tray, taskbar buttons, global media keys ----
function trayMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: state.title ? (state.artist ? state.artist + ' — ' : '') + state.title : 'Dj Ape1', enabled: false }, { type: 'separator' },
    { label: state.playing ? tr('⏸ Παύση', '⏸ Pause') : tr('▶ Αναπαραγωγή', '▶ Play'), click: () => send('cmd', 'toggle') },
    { label: tr('⏮ Προηγούμενο', '⏮ Previous'), click: () => send('cmd', 'prev') }, { label: tr('⏭ Επόμενο', '⏭ Next'), click: () => send('cmd', 'next') }, { type: 'separator' },
    { label: tr('Εμφάνιση', 'Show window'), click: showWin }, { label: tr('Μικρό παράθυρο', 'Mini player'), click: () => send('cmd', 'mini') },
    { label: tr('Κλείσιμο στο tray', 'Close to tray'), type: 'checkbox', checked: !!settings.closeToTray, click: m => { settings.closeToTray = m.checked; saveSettings(); } },
    { label: tr('Έναρξη με τα Windows', 'Start with Windows'), type: 'checkbox', checked: login, enabled: !PORTABLE, click: m => app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }) }, { type: 'separator' },
    { label: tr('Έξοδος', 'Quit'), click: () => { quitting = true; app.quit(); } }]);
}
function updateTray() { if (!tray) return; tray.setToolTip((state.title ? (state.artist ? state.artist + ' — ' : '') + state.title : 'Dj Ape1')); tray.setContextMenu(trayMenu()); }
function updateThumbar() {
  if (!win || win.isDestroyed() || process.platform !== 'win32') return;
  try { win.setThumbarButtons([{ tooltip: tr('Προηγούμενο', 'Previous'), icon: asset('prev'), click: () => send('cmd', 'prev') },
    { tooltip: state.playing ? tr('Παύση', 'Pause') : tr('Αναπαραγωγή', 'Play'), icon: asset(state.playing ? 'pause' : 'play'), click: () => send('cmd', 'toggle') },
    { tooltip: tr('Επόμενο', 'Next'), icon: asset('next'), click: () => send('cmd', 'next') }]); } catch (e) { }
}
// ---- watch remembered folders for new files ----
const watchers = new Map(); let wtm;
const bump = () => { clearTimeout(wtm); wtm = setTimeout(() => send('native:changed'), 4000); };
function setWatch(paths) {
  const want = new Set(paths || []);
  for (const [p, w] of watchers) if (!want.has(p)) { try { w.close(); } catch (e) { } watchers.delete(p); }
  for (const p of want) if (!watchers.has(p)) { try { const w = fs.watch(p, { recursive: true }, (ev, name) => { if (!name || native.AUDIO_RE.test(name) || !path.extname(name)) bump(); }); w.on('error', () => { }); watchers.set(p, w); } catch (e) { } }
}

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const f = path.join(ROOT, decodeURIComponent(new URL(req.url).pathname));
    if (!f.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(f).toString());
  });
  // djfile://local/<encoded absolute path> streams a local audio file with Range support (seeking).
  protocol.handle('djfile', async req => {
    try {
      const p = decodeURIComponent(new URL(req.url).pathname.slice(1));
      if (!native.AUDIO_RE.test(p)) return new Response('forbidden', { status: 403 });
      const r = await native.fileInfo(p, req.headers.get('range'));
      if (r.status === 416) return new Response(null, { status: 416, headers: r.headers });
      return new Response(Readable.toWeb(fs.createReadStream(p, { start: r.start, end: r.end })), { status: r.status, headers: r.headers });
    } catch (e) { return new Response('not found', { status: 404 }); }
  });
  const ok = ['fileSystem', 'media', 'clipboard-sanitized-write', 'fullscreen'];   // 'fullscreen' is required for requestFullscreen() (app + player full screen)
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ok.includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ok.includes(perm));
  Menu.setApplicationMenu(null);

  ipcMain.handle('nat:readdir', (e, p) => native.readdir(p));
  ipcMain.handle('nat:stat', (e, ps) => native.stat(ps));
  ipcMain.handle('nat:tags', (e, p) => native.readTags(p, resizeCover));
  ipcMain.handle('nat:pick', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('nat:watch', (e, ps) => { setWatch(ps); return true; });
  ipcMain.handle('lib:info', () => store.info());
  ipcMain.handle('lib:load', () => store.load());
  ipcMain.handle('lib:save', (e, j) => store.save(j));
  ipcMain.handle('lib:backups', () => store.backups());
  ipcMain.handle('lib:backup', (e, n) => store.readBackup(n));
  ipcMain.handle('lib:openDir', () => shell.openPath(store.dir));
  ipcMain.handle('win:fs', () => { if (win) win.setFullScreen(!win.isFullScreen()); return true; });
  ipcMain.handle('app:getOpen', () => { const p = pendingOpen; pendingOpen = []; return p; });
  ipcMain.on('app:state', (e, s) => { state = Object.assign(state, s); updateTray(); updateThumbar(); });
  ipcMain.on('app:flushDone', () => { flushed = true; quitting = true; if (win) win.close(); });
  ipcMain.handle('prefs:get', () => ({ closeToTray: !!settings.closeToTray, login: app.getLoginItemSettings().openAtLogin, portable: PORTABLE }));
  ipcMain.handle('prefs:set', (e, p) => { if (p && 'closeToTray' in p) { settings.closeToTray = !!p.closeToTray; saveSettings(); } if (p && 'login' in p && !PORTABLE) app.setLoginItemSettings({ openAtLogin: !!p.login, args: ['--hidden'] }); updateTray(); return true; });

  createWindow();
  try { tray = new Tray(asset('tray')); tray.on('click', showWin); tray.on('double-click', showWin); updateTray(); } catch (e) { }
  for (const [key, cmd] of [['MediaPlayPause', 'toggle'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev'], ['MediaStop', 'stop']]) { try { globalShortcut.register(key, () => send('cmd', cmd)); } catch (e) { } }
  app.on('activate', showWin);
});
app.on('second-instance', (e, argv) => { showWin(); const f = argFiles(argv); if (f.length) send('app:open', f); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) { } });
app.on('window-all-closed', () => { if (quitting || !settings.closeToTray) app.quit(); });
