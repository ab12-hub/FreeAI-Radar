'use strict';
// main.js —— Electron 主进程入口
// 桌面客户端与 Web 端共用同一套界面：窗口加载本机 Web 服务
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage } = require('electron');
const { EventEmitter } = require('events');
const { Store } = require('./store');
const { createAggregator } = require('./aggregator');
const { createServer } = require('./server');

const APP_NAME = 'FreeAI Radar';
const isWebMode = process.argv.includes('--web');   // 无窗口服务模式
const isDev = process.argv.includes('--dev') || !app.isPackaged;

let win = null;
let tray = null;
let quitting = false;
let ctx = null;

// 简易日志（同时写文件，便于排查打包后问题）
const logFile = () => path.join(app.getPath('userData'), 'freeai-radar.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  if (!isWebMode || isDev) console.log(line);
  try { fs.appendFileSync(logFile(), line + '\n'); } catch (e) { /* ignore */ }
}

function dataDir() { return path.join(app.getPath('userData'), 'data'); }

async function findFreePort(start) {
  const net = require('net');
  for (let p = start; p < start + 20; p++) {
    const ok = await new Promise(resolve => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => s.close(() => resolve(true)));
      s.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  return start;
}

function applyAutoLaunch(enabled) {
  try { app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath }); } catch (e) { log('自启设置失败: ' + e.message); }
}

function showMainWindow() {
  if (isWebMode) return;
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  const port = ctx.port;
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  win.loadURL(`http://127.0.0.1:${port}/`);
  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    if (!quitting && ctx.store.getSettings().closeToTray && !isDev) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  if (isWebMode || tray) return;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(img.isEmpty() ? iconPath : img);
  const menu = Menu.buildFromTemplate([
    { label: '显示主界面', click: showMainWindow },
    { label: '立即刷新', click: () => ctx.aggregator.runOnce('tray').catch(() => {}) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(menu);
  tray.on('double-click', showMainWindow);
}

function notifyDesktop(evt) {
  if (isWebMode || !ctx.store.getSettings().notifications) return;
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: evt.title, body: (evt.detail || '').slice(0, 200) || APP_NAME, silent: false });
  n.on('click', () => { showMainWindow(); if (evt.url) shell.openExternal(evt.url); });
  n.show();
}

async function boot() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }

  const store = new Store(dataDir());
  store.load();
  const bus = new EventEmitter();
  ctx = { store, bus, log, port: null, aggregator: null };

  ctx.aggregator = createAggregator(ctx);
  ctx.aggregator.seedIfNeeded();

  // 启动 Web 服务（端口冲突自动顺延）
  const wantPort = Number(store.getSettings().webPort) || 7766;
  const host = store.getSettings().lanAccess ? '0.0.0.0' : '127.0.0.1';
  const port = await findFreePort(wantPort);
  ctx.port = port;
  await createServer(ctx).start(port, host);
  log(`${APP_NAME} Web 端已启动: http://127.0.0.1:${port}/ (${host})`);
  if (port !== wantPort) {
    store.addEvent({ type: 'system', level: 'warn', title: `⚠️ 端口 ${wantPort} 被占用，Web 端改用 ${port}`, url: '' });
  }

  // 设置变更的应用侧处理（自启、托盘行为）
  ctx.applySettings = (before, after) => {
    if (before.autoLaunch !== after.autoLaunch) applyAutoLaunch(after.autoLaunch);
  };
  applyAutoLaunch(store.getSettings().autoLaunch);

  // 首次刷新延迟数秒，让界面先渲染出来
  setTimeout(() => ctx.aggregator.runOnce('startup').catch(e => log('首轮抓取失败: ' + e.message)), 4000);
  ctx.aggregator.schedule();

  bus.on('event', notifyDesktop);

  if (!isWebMode) {
    showMainWindow();
    createTray();
    app.on('second-instance', showMainWindow);
  }

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (isWebMode || !store.getSettings().closeToTray) app.quit(); });
}

app.whenReady().then(boot).catch(err => {
  log('启动失败: ' + (err && err.stack || err));
});
