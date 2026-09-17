import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog, globalShortcut } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { configSchema, freshConfig, patchedConfig, readableError, systemLabel } from '../src/config.ts';
import type { Config, Result } from '../src/config.ts';

const testMode = process.env.JOVIAN_TEST === '1';
const root = app.getAppPath();
const dataDir = process.env.JOVIAN_DATA_DIR || path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : root, 'user-data');
mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(dataDir, 'chromium'));
app.setAppUserModelId('local.jovian.desk');
const configFile = path.join(dataDir, 'config.json');
let config = freshConfig();
let loadWarning = '';
let hadConfiguredWindowSize = false;
if (existsSync(configFile)) {
  try {
    const text = readFileSync(configFile, 'utf8'), raw = JSON.parse(text);
    hadConfiguredWindowSize = Number.isSafeInteger(raw?.view?.windowWidth) && Number.isSafeInteger(raw?.view?.windowHeight);
    config = configSchema.parse(raw);
    if (raw.version === 1) {
      writeFileSync(path.join(dataDir, `config-v1-backup-${Date.now()}.json`), text, 'utf8');
    }
    if (JSON.stringify(raw) !== JSON.stringify(config)) persist(config);
  }
  catch (error) {
    loadWarning = `配置无法读取，已启用默认值。原文件已备份。\n${readableError(error)}`;
    try { writeFileSync(path.join(dataDir, `config-backup-${Date.now()}.json`), readFileSync(configFile)); } catch { /* Show the read error. */ }
  }
}
let widget: BrowserWindow;
let settings: BrowserWindow;
let tray: Tray | undefined;
let quitting = false;
let pointerDrag = false;
let ignoring = false;
let ignoreMode: 'none' | 'forward' | 'block' = 'none';
let requestedIgnore = false;
let moveOrigin: { x: number; y: number; cursorX: number; cursorY: number } | null = null;
let poll: ReturnType<typeof setInterval>;
let filled = false;
let filledDisplayId: number | undefined;
let normalBounds: Electron.Rectangle;
let layoutTimer: ReturnType<typeof setTimeout>;
let taskbarHidden = !config.view.showHUD;
let desktopLayer = false;
let loweringToDesktop = false;
let desktopLayerError = '';
let loginItemIntent = config.view.launchAtLogin;
const layoutFile = path.join(dataDir, 'window-state.json');

function fitBounds(bounds: Electron.Rectangle, area: Electron.Rectangle) {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return { width, height,
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
  };
}
function saveLayout() {
  if (!widget || widget.isDestroyed() || !normalBounds) return;
  if (!filled) normalBounds = widget.getBounds();
  if (!filled && (config.view.windowWidth !== normalBounds.width || config.view.windowHeight !== normalBounds.height)) {
    let next = patchedConfig(config, 'view.windowWidth', normalBounds.width);
    next = patchedConfig(next, 'view.windowHeight', normalBounds.height);
    commit(next);
  }
  try {
    writeFileSync(`${layoutFile}.tmp`, JSON.stringify({ bounds: normalBounds, filled, displayId: filledDisplayId }), 'utf8');
    renameSync(`${layoutFile}.tmp`, layoutFile);
  } catch (error) { console.error('Unable to save window position:', error); }
}
function scheduleLayoutSave() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(saveLayout, 250);
}
function sendWindowState() {
  for (const win of [widget, settings]) if (win && !win.isDestroyed()) win.webContents.send('window:state-changed', { filled, controlsHidden: !config.view.showHUD });
  updateTray();
}
function setFillScreen(next: boolean) {
  if (filled === next) return { filled };
  pointerDrag = false; moveOrigin = null;
  if (next) {
    normalBounds = widget.getBounds();
    const display = screen.getDisplayMatching(normalBounds);
    filledDisplayId = display.id; filled = true;
    // Size the transparent, frameless window directly; native maximize adds platform constraints.
    widget.setBounds(display.bounds, false);
  } else {
    filled = false; filledDisplayId = undefined;
    const area = screen.getDisplayMatching(normalBounds).workArea;
    widget.setBounds(fitBounds(normalBounds, area), false);
  }
  if (settings.isVisible()) placeSettings();
  updateIgnore(); sendWindowState(); saveLayout();
  return { filled };
}
function placeSettings() {
  const area = screen.getDisplayMatching(widget.getBounds()).workArea;
  const width = Math.min(430, area.width - 16);
  const height = Math.min(790, area.height - 16);
  settings.setMinimumSize(Math.min(320, width), Math.min(240, height));
  const bounds = widget.getBounds();
  const beside = !filled && bounds.x + bounds.width + width + 12 <= area.x + area.width;
  settings.setBounds(fitBounds({
    x: beside ? bounds.x + bounds.width + 12 : Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2), width, height,
  }, area), false);
}
function restoreLayout() {
  try {
    const saved = JSON.parse(readFileSync(layoutFile, 'utf8'));
    const b = saved.bounds;
    if (!b || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(b[key])) || b.width < 240 || b.height < 180 || b.width > 20000 || b.height > 20000) return;
    const requested = hadConfiguredWindowSize ? { ...b, width: config.view.windowWidth, height: config.view.windowHeight } : b;
    normalBounds = fitBounds(requested, screen.getDisplayMatching(b).workArea);
    if (!hadConfiguredWindowSize) {
      let next = patchedConfig(config, 'view.windowWidth', normalBounds.width);
      next = patchedConfig(next, 'view.windowHeight', normalBounds.height);
      config = next; persist(config); hadConfiguredWindowSize = true;
    }
    widget.setBounds(normalBounds, false);
    if (saved.filled === true) {
      const display = screen.getAllDisplays().find(d => d.id === saved.displayId) || screen.getDisplayMatching(normalBounds);
      filled = true; filledDisplayId = display.id;
      widget.setBounds(display.bounds, false);
    }
    placeSettings();
  } catch { /* First launch, or a saved display layout is no longer readable. */ }
}
function adaptToDisplays() {
  if (filled) {
    const display = screen.getAllDisplays().find(d => d.id === filledDisplayId) || screen.getDisplayMatching(widget.getBounds());
    filledDisplayId = display.id;
    widget.setBounds(display.bounds, false);
  } else widget.setBounds(fitBounds(widget.getBounds(), screen.getDisplayMatching(widget.getBounds()).workArea), false);
  if (settings.isVisible()) placeSettings();
  saveLayout();
}

function persist(next: Config) {
  const temporary = `${configFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
  renameSync(temporary, configFile);
}
function applyLaunchAtLogin() {
  loginItemIntent = config.view.launchAtLogin;
  if (process.platform === 'win32' && app.isPackaged && !testMode) {
    app.setLoginItemSettings({ openAtLogin: loginItemIntent, path: process.execPath });
  }
}
function applyConfiguredWindowSize() {
  if (!widget || widget.isDestroyed()) return;
  const reference = normalBounds || widget.getBounds();
  const area = screen.getDisplayMatching(reference).workArea;
  normalBounds = fitBounds({ ...reference, width: config.view.windowWidth, height: config.view.windowHeight }, area);
  if (!filled) widget.setBounds(normalBounds, false);
  if (settings?.isVisible()) placeSettings();
  saveLayout();
}
function broadcast(sizeChanged = false) {
  for (const win of [widget, settings]) if (win && !win.isDestroyed()) win.webContents.send('config:changed', config);
  applyLaunchAtLogin();
  if (sizeChanged) applyConfiguredWindowSize();
  applyWindowPresentation();
  updateIgnore(); updateTray();
}
function commit(next: Config): Result {
  const sizeChanged = next.view.windowWidth !== config.view.windowWidth || next.view.windowHeight !== config.view.windowHeight;
  try { persist(next); config = next; broadcast(sizeChanged); return { ok: true, config }; }
  catch (error) { return { ok: false, error: `保存失败：${readableError(error)}` }; }
}
function updateIgnore() {
  const hiddenTop = !config.view.showHUD && config.view.hiddenLayer === 'top';
  if (hiddenTop) {
    if (ignoreMode !== 'block' && widget && !widget.isDestroyed()) widget.setIgnoreMouseEvents(true);
    ignoring = true; ignoreMode = 'block'; return;
  }
  const shouldIgnore = config.view.clickThrough && requestedIgnore && !pointerDrag && !moveOrigin;
  const nextMode = shouldIgnore ? 'forward' : 'none';
  if (nextMode !== ignoreMode && widget && !widget.isDestroyed()) {
    widget.setIgnoreMouseEvents(shouldIgnore, { forward: true }); ignoring = shouldIgnore; ignoreMode = nextMode;
  }
}
function finishMove() {
  const wasMoving = !!moveOrigin;
  moveOrigin = null; pointerDrag = false;
  if (wasMoving && !filled) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    // A window dragged from a large screen must keep its bottom dock reachable on a small one.
    widget.setBounds(fitBounds(widget.getBounds(), area), false);
    if (settings.isVisible()) placeSettings();
    saveLayout();
  }
  updateIgnore();
}
function moveWidgetToDesktopLayer() {
  if (process.platform !== 'win32' || desktopLayer || loweringToDesktop) return;
  const bytes = widget.getNativeWindowHandle();
  const handle = bytes.length >= 8 ? bytes.readBigUInt64LE() : BigInt(bytes.readUInt32LE());
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class JovianWindow { [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags); }'; $handle = [IntPtr]::new([Int64]${handle}); if(-not [JovianWindow]::SetWindowPos($handle, [IntPtr]::new(1), 0, 0, 0, 0, 0x13)){Write-Error ([Runtime.InteropServices.Marshal]::GetLastWin32Error()); exit 1}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  loweringToDesktop = true; desktopLayerError = '';
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true }, (error, _stdout, stderr) => {
    loweringToDesktop = false; desktopLayer = !error; desktopLayerError = error ? `${error.message}\n${stderr}`.trim() : '';
    if (error) console.error('Unable to lower the desktop window:', error);
  });
}
function applyWindowPresentation(activate = false) {
  if (!widget || widget.isDestroyed()) return;
  const controlsVisible = config.view.showHUD;
  const hiddenTop = !controlsVisible && config.view.hiddenLayer === 'top';
  taskbarHidden = !controlsVisible; widget.setSkipTaskbar(taskbarHidden); widget.setFocusable(controlsVisible);
  widget.setOpacity(controlsVisible ? 1 : config.view.hiddenOpacity);
  widget.setAlwaysOnTop(controlsVisible ? config.view.alwaysOnTop : hiddenTop);
  settings?.setAlwaysOnTop(controlsVisible && config.view.alwaysOnTop);
  if (controlsVisible) {
    desktopLayer = false; desktopLayerError = '';
    if (activate) { widget.show(); widget.focus(); }
  } else {
    settings?.hide();
    if (!widget.isVisible()) widget.showInactive();
    if (hiddenTop) { desktopLayer = false; desktopLayerError = ''; }
    else moveWidgetToDesktopLayer();
  }
  updateIgnore();
  sendWindowState();
}
function setControlsVisible(visible: boolean, layer?: Config['view']['hiddenLayer']) {
  let result: Result = { ok: true, config };
  let next = config;
  if (layer && next.view.hiddenLayer !== layer) next = patchedConfig(next, 'view.hiddenLayer', layer);
  if (next.view.showHUD !== visible) next = patchedConfig(next, 'view.showHUD', visible);
  if (next !== config) result = commit(next);
  if (result.ok) applyWindowPresentation(visible);
  return result;
}
function setHiddenLayer(layer: Config['view']['hiddenLayer']) { return commit(patchedConfig(config, 'view.hiddenLayer', layer)); }
function switchSystem(id: string) {
  try { return commit(patchedConfig(config, '$navigate', id)); }
  catch (error) { return { ok: false, error: readableError(error) } as Result; }
}
function showSettings() { setControlsVisible(true); placeSettings(); if (settings.isMinimized()) settings.restore(); settings.show(); settings.focus(); }
function showWidget() { setControlsVisible(true); }
function traySystems() {
  return [{ id: 'solar', label: '太阳系总览' }, ...config.planets.map(system => ({ id: system.id, label: systemLabel(system) }))];
}
function updateTray() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '还原操作 UI', enabled: !config.view.showHUD, click: showWidget },
    { label: '观测设置', click: showSettings },
    { label: '切换星系', submenu: traySystems().map(item => ({
      label: item.label, type: 'radio' as const, checked: config.navigation.systemId === item.id, click: () => switchSystem(item.id),
    })) },
    { label: '隐藏后的显示层级', submenu: [
      { label: '置顶展示 · 鼠标穿透', type: 'radio' as const, checked: config.view.hiddenLayer === 'top', click: () => setHiddenLayer('top') },
      { label: '置于桌面底层', type: 'radio' as const, checked: config.view.hiddenLayer === 'bottom', click: () => setHiddenLayer('bottom') },
    ] },
    { label: '铺满当前屏幕', type: 'checkbox', checked: filled, click: () => setFillScreen(!filled) },
    { type: 'separator' },
    { label: '暂停时间', type: 'checkbox', checked: config.simulation.paused, click: () => commit(patchedConfig(config, 'simulation.paused', !config.simulation.paused)) },
    { label: '窗口置顶', type: 'checkbox', enabled: config.view.showHUD, checked: config.view.showHUD && config.view.alwaysOnTop, click: () => commit(patchedConfig(config, 'view.alwaysOnTop', !config.view.alwaysOnTop)) },
    { label: '重置视角与位置', click: () => { placeWindows(); widget.webContents.send('view:command', 'reset-view'); commit(patchedConfig(config, 'view.zoom', 1)); } },
    { type: 'separator' },
    { label: '退出 Jovian Desk', click: () => app.quit() },
  ]));
}
function placeWindows() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(config.view.windowWidth, area.width - 24), height = Math.min(config.view.windowHeight, area.height - 24);
  filled = false; filledDisplayId = undefined;
  normalBounds = { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
  widget.setBounds(normalBounds, false);
  placeSettings(); sendWindowState();
}
function trusted(sender: Electron.WebContents) { return sender === widget?.webContents || sender === settings?.webContents; }
function handle(channel: string, callback: (...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => { if (!trusted(event.sender)) throw new Error('Unknown sender'); return callback(...args); });
}
function on(channel: string, callback: (...args: any[]) => void, widgetOnly = false) {
  ipcMain.on(channel, (event, ...args) => {
    if (!trusted(event.sender) || (widgetOnly && event.sender !== widget.webContents)) return;
    callback(...args);
  });
}

function registerIPC() {
  handle('config:get', () => config);
  handle('window:state', () => ({ filled, controlsHidden: !config.view.showHUD }));
  handle('window:fill-toggle', () => setFillScreen(!filled));
  handle('window:fill-exit', () => setFillScreen(false));
  handle('window:controls-hide', layer => setControlsVisible(false, layer));
  handle('window:controls-restore', () => setControlsVisible(true));
  handle('config:patch', (key, value) => { try { return commit(patchedConfig(config, key, value)); } catch (e) { return { ok: false, error: readableError(e) }; } });
  handle('config:reset', () => { const result = commit(freshConfig()); widget.webContents.send('view:command', 'reset-view'); return result; });
  handle('config:export', async () => {
    const result = await dialog.showSaveDialog(settings, { title: '导出观测配置', defaultPath: path.join(dataDir, 'jovian-config.json'), filters: [{ name: 'JSON 配置', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try { writeFileSync(result.filePath, JSON.stringify(config, null, 2), 'utf8'); return { ok: true }; }
    catch (error) { return { ok: false, error: readableError(error) }; }
  });
  handle('config:import', async () => {
    const result = await dialog.showOpenDialog(settings, { title: '导入观测配置', properties: ['openFile'], filters: [{ name: 'JSON 配置', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      if (statSync(result.filePaths[0]).size > 2000000) throw new Error('配置文件不能超过 2 MB');
      return commit(configSchema.parse(JSON.parse(readFileSync(result.filePaths[0], 'utf8').replace(/^\uFEFF/, ''))));
    } catch (error) { return { ok: false, error: readableError(error) }; }
  });
  on('window:settings', showSettings);
  on('window:settings-close', () => settings.hide());
  on('window:settings-minimize', () => settings.minimize());
  on('window:quit', () => app.quit());
  on('window:ignore', (ignore: unknown) => { if (typeof ignore === 'boolean') { requestedIgnore = ignore; updateIgnore(); } }, true);
  on('window:drag', (dragging: unknown) => { pointerDrag = dragging === true; updateIgnore(); }, true);
  on('window:move-start', () => {
    if (filled) return;
    const [x, y] = widget.getPosition(); const cursor = screen.getCursorScreenPoint();
    moveOrigin = { x, y, cursorX: cursor.x, cursorY: cursor.y }; updateIgnore();
  }, true);
  on('window:move-end', finishMove, true);
  on('view:reset', () => { widget.webContents.send('view:command', 'reset-view'); commit(patchedConfig(config, 'view.zoom', 1)); });
  on('view:ready', () => { if (!testMode) { widget.showInactive(); applyWindowPresentation(); } }, true);
}

if (!testMode && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (widget) showWidget(); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    applyLaunchAtLogin();
    const icon = path.join(root, 'dist', 'icon.png');
    const preload = path.join(root, 'electron-dist', 'preload.cjs');
    widget = new BrowserWindow({ title: 'Jovian Desk · 桌面星系', width: config.view.windowWidth, height: config.view.windowHeight,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      minWidth: 320, minHeight: 240, resizable: true, maximizable: false, show: false, skipTaskbar: !config.view.showHUD, alwaysOnTop: config.view.showHUD && config.view.alwaysOnTop,
      icon, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    settings = new BrowserWindow({ title: 'Jovian Desk · 观测设置', width: 430, height: 790,
      minWidth: 320, minHeight: 240, frame: false, backgroundColor: '#111817', show: false,
      alwaysOnTop: config.view.showHUD && config.view.alwaysOnTop, icon,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !testMode },
    });
    placeWindows(); restoreLayout(); registerIPC();
    if (testMode) (globalThis as any).__jovianTest = {
      restoreControls: () => setControlsVisible(true), switchSystem,
      setHiddenLayer,
      loginItemIntent: () => loginItemIntent,
      desktopMode: () => ({ layer: config.view.hiddenLayer, opacity: widget.getOpacity(), inputMode: ignoreMode }),
      traySystems: () => traySystems(), presentation: () => ({ controlsHidden: !config.view.showHUD, taskbarHidden, desktopLayer, desktopLayerError, alwaysOnTop: widget.isAlwaysOnTop(), focusable: widget.isFocusable() }),
    };
    for (const win of [widget, settings]) {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => event.preventDefault());
    }
    settings.on('close', event => { if (!quitting) { event.preventDefault(); settings.hide(); } });
    widget.on('close', () => { if (!quitting) app.quit(); });
    widget.on('blur', finishMove);
    widget.on('move', scheduleLayoutSave); widget.on('resize', scheduleLayoutSave);
    screen.on('display-metrics-changed', adaptToDisplays);
    screen.on('display-removed', adaptToDisplays);
    poll = setInterval(() => {
      if (widget.isDestroyed()) return;
      const cursor = screen.getCursorScreenPoint();
      if (moveOrigin) {
        const area = screen.getDisplayNearestPoint(cursor).workArea;
        const bounds = widget.getBounds();
        const x = Math.max(area.x - bounds.width + 100, Math.min(area.x + area.width - 100, moveOrigin.x + cursor.x - moveOrigin.cursorX));
        const y = Math.max(area.y, Math.min(area.y + area.height - 80, moveOrigin.y + cursor.y - moveOrigin.cursorY));
        widget.setPosition(Math.round(x), Math.round(y));
      }
      const bounds = widget.getBounds();
      widget.webContents.send('pointer:position', { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
    }, 32);
    if (!testMode) {
      tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 24, height: 24 }));
      tray.setToolTip('Jovian Desk · 右键还原操作 UI 或切换星系'); tray.on('double-click', showWidget); updateTray();
      globalShortcut.register('CommandOrControl+Alt+J', showSettings);
    }
    const dev = process.env.JOVIAN_DEV_URL;
    if (dev && /^http:\/\/127\.0\.0\.1:\d+$/.test(dev)) {
      await Promise.all([widget.loadURL(dev), settings.loadURL(`${dev}/settings.html`)]);
    } else await Promise.all([widget.loadFile(path.join(root, 'dist', 'index.html')), settings.loadFile(path.join(root, 'dist', 'settings.html'))]);
    if (loadWarning && !testMode) dialog.showMessageBox(settings, { type: 'warning', title: '配置读取提示', message: loadWarning });
  }).catch(error => { console.error(error); app.quit(); });
}
app.on('before-quit', () => { quitting = true; clearInterval(poll); clearTimeout(layoutTimer); saveLayout(); globalShortcut.unregisterAll(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());
