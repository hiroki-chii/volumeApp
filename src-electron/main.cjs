const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen } = require('electron');

// Windowsアップデート後のクラッシュ（GPUやサンドボックスの競合）対策
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

const path = require('path');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';
const loudness = require('loudness');
const { uIOhook } = require('uiohook-napi');

// Simple persistent store to avoid ESM/CommonJS issues with electron-store
class SimpleStore {
  constructor() {
    this.path = path.join(app.getPath('userData'), 'settings.json');
    this.data = this.load();
  }
  load() {
    try {
      if (fs.existsSync(this.path)) {
        return JSON.parse(fs.readFileSync(this.path));
      }
    } catch (e) { console.error(e); }
    return { step: 2 };
  }
  save() {
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.data));
    } catch (e) { console.error(e); }
  }
  get(key, def) { return this.data[key] !== undefined ? this.data[key] : def; }
  set(key, val) { this.data[key] = val; this.save(); }
}

let store;
let win;
let tray;
let hideTimer;
let isSettingsMode = false;
let isHovering = false;

function isMouseOverTaskbar() {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const b = display.bounds;
  const w = display.workArea;

  // カーソルがディスプレイの範囲内にあるか確認
  const isInBounds = (
    point.x >= b.x && point.x < b.x + b.width &&
    point.y >= b.y && point.y < b.y + b.height
  );
  if (!isInBounds) return false;

  // ワークエリア（タスクバーを除いた領域）の外側にいるか確認（＝タスクバー上）
  const isInWorkArea = (
    point.x >= w.x && point.x < w.x + w.width &&
    point.y >= w.y && point.y < w.y + w.height
  );

  return !isInWorkArea;
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  win = new BrowserWindow({
    width: 320,
    height: 120,
    x: width - 340,
    y: height - 140,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    resizable: false,
    maximizable: false,
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.on('blur', () => {
    if (isSettingsMode) {
      win.hide();
      isSettingsMode = false;
      win.webContents.send('force-osd');
    }
  });
}

function showOSD() {
  if (!win) return;

  // 設定モードのまま音量操作された場合、強制的にOSDモードに切り替える（状態の不整合を防ぐ）
  if (isSettingsMode) {
    isSettingsMode = false;
    adjustWindowSize(320, 120);
    win.webContents.send('force-osd');
  }

  // マウスのあるディスプレイにOSDを移動
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const { x, y, width, height } = display.workArea;
  
  const winWidth = 320;
  const winHeight = 120;
  
  const bounds = {
    width: winWidth,
    height: winHeight,
    x: x + width - winWidth - 20,
    y: y + height - winHeight - 20
  };
  
  win.setBounds(bounds);

  // 常に最前面に維持し、他のウィンドウの背後に隠れるのを防ぐ
  win.setAlwaysOnTop(true, 'screen-saver');

  // isVisibleの真偽値に関わらず、毎回showInactiveを呼んで表示状態を確実にする
  win.showInactive();
  
  // 高DPIモニターでの初回表示時の欠け対策、および表示確定のための再setBounds
  win.setBounds(bounds);

  // 透明ウィンドウの描画が更新されないChromiumのバグを回避するため、強制的に再描画を要求
  if (win.webContents) {
    win.webContents.invalidate();
  }

  resetHideTimer();
}

function resetHideTimer() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (isHovering || isSettingsMode) return;
    win.hide();
  }, 2000);
}

function adjustWindowSize(width, height) {
  if (!win) return;
  
  // 現在のウィンドウがある（またはマウスがある）ディスプレイを取得
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const { x: sx, y: sy, width: sw, height: sh } = display.workArea;
  
  const newX = sx + sw - width - 20;
  const newY = sy + sh - height - 20;
  
  win.setBounds({
    width: width,
    height: height,
    x: newX,
    y: newY
  });
  isSettingsMode = height > 200;
}

async function getVolume() {
  try {
    return await loudness.getVolume();
  } catch (e) {
    return 0;
  }
}

async function setVolume(vol) {
  try {
    await loudness.setVolume(vol);
    return true;
  } catch (e) {
    return false;
  }
}

app.whenReady().then(async () => {
  store = new SimpleStore();
  createWindow();

  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: 'Settings', 
        click: () => { 
          adjustWindowSize(320, 500);
          win.webContents.send('open-settings');
          win.show(); 
        } 
      },
      { type: 'separator' },
      { label: 'Exit', click: () => app.quit() }
    ]);
    tray.setToolTip('Volume App');
    tray.setContextMenu(contextMenu);
  } catch (e) {
    console.error('Tray failed:', e);
  }

  // Keyboard shortcuts disabled by user request
  console.log('Keyboard shortcuts disabled. Use mouse over taskbar.');

  // Mouse
  uIOhook.on('wheel', async (e) => {
    if (isMouseOverTaskbar()) {
      let current = await getVolume();
      const step = store.get('step', 2);
      let next;
      if (e.rotation < 0) {
        next = Math.min(100, Math.round(current / step) * step + step);
      } else {
        next = Math.max(0, Math.round(current / step) * step - step);
      }
      await setVolume(next);
      await loudness.setMuted(false);
      win.webContents.send('volume-updated', next);
      win.webContents.send('mute-updated', false);
      showOSD();
    }
  });

  uIOhook.on('mousedown', async (e) => {
    if (e.button === 3 && isMouseOverTaskbar()) {
      const isMuted = await loudness.getMuted();
      await loudness.setMuted(!isMuted);
      win.webContents.send('mute-updated', !isMuted);
      showOSD();
    }
  });

  uIOhook.start();
});

ipcMain.handle('get-volume', async () => await getVolume());
ipcMain.handle('set-volume', async (e, v) => await setVolume(v));
ipcMain.handle('get-mute', async () => await loudness.getMuted());
ipcMain.handle('set-mute', async (e, m) => await loudness.setMuted(m));
ipcMain.handle('get-settings', () => store.data);
ipcMain.handle('set-setting', (e, key, value) => {
  store.set(key, value);
  return store.data;
});

ipcMain.on('set-hover', (e, hover) => {
  isHovering = hover;
  if (!isHovering && !isSettingsMode && win && win.isVisible()) {
    resetHideTimer();
  }
});

ipcMain.on('resize-window', (e, width, height) => {
  adjustWindowSize(width, height);
  if (height <= 120) {
    win.hide();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
