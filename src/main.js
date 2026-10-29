'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const {
  getSnapshot,
  scanWifiNetworks,
  getWifiInterfaces,
  getWifiProfiles,
  getWifiProfileDetail,
  verifyWifiPassword,
  connectWifiProfile,
  getWifiCapabilities,
  getPublicIp,
  getRecentNetworkEvents,
  restartWlanService,
} = require('./backend/network');
const { pingBatch, oneClickConnectivity, dnsTest, tcpTest, httpTest, measureStability, mtuTest, traceRoute, summarizePingResults, pingHost } = require('./backend/ping');
const { runFullDiagnostic, STAGE_DEFS } = require('./backend/diagnostics');
const { speedTest } = require('./backend/speed');
const { runRepair, setPreferredInterface, resetPreferredInterface } = require('./backend/repairs');
const { getSettings, updateSettings, getHistory, getHistoryItem, clearHistory, saveHistory, getDataDir } = require('./backend/store');
const { generateHtmlReport, generateTextSummary, formatDate } = require('./backend/report');
const { isAdmin, ps, runCommand } = require('./backend/win');
const { PING_TARGETS, REPAIR_ACTIONS, APP_NAME, VERSION } = require('./backend/constants');

app.setName(APP_NAME);
app.setAppUserModelId('com.wifimedic.pro');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

let mainWindow = null;
let snapshotCache = null;
let snapshotCacheAt = 0;
let snapshotPromise = null;
let diagRunning = false;
let speedRunning = false;
let adminCache = { value: false, at: 0 };
let monitor = { running: false, timer: null, webContents: null, gateway: null, sourceIp: null, interval: 1200, tick: 0 };

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAdminCached(force = false) {
  if (!force && Date.now() - adminCache.at < 6000) return adminCache.value;
  const value = await isAdmin();
  adminCache = { value, at: Date.now() };
  return value;
}

async function getSnapshotCached(force = false) {
  if (!force && snapshotCache && Date.now() - snapshotCacheAt < 3000) return snapshotCache;
  if (snapshotPromise) return snapshotPromise;
  snapshotPromise = getSnapshot()
    .then((snapshot) => {
      snapshotCache = snapshot;
      snapshotCacheAt = Date.now();
      return snapshot;
    })
    .finally(() => {
      snapshotPromise = null;
    });
  return snapshotPromise;
}

function invalidateSnapshot() {
  snapshotCache = null;
  snapshotCacheAt = 0;
}

function safeError(error) {
  return String((error && error.message) || error || '未知错误');
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return await handler(event, payload);
    } catch (error) {
      return { ok: false, error: safeError(error) };
    }
  });
}

const UI_SCALES = [1, 1.2, 1.35];

function normalizeUiScale(value) {
  const scale = Number(value);
  return UI_SCALES.includes(scale) ? scale : 1.2;
}

function applyWindowUiScale(win, value) {
  if (!win || win.isDestroyed()) return 1.2;
  const scale = normalizeUiScale(value);
  try {
    win.webContents.setZoomFactor(scale);
  } catch {
    // Keep the current zoom when the webContents is not ready yet.
  }
  return scale;
}

function stopMonitor() {
  monitor.running = false;
  if (monitor.timer) clearTimeout(monitor.timer);
  monitor.timer = null;
  monitor.webContents = null;
}

async function monitorTick() {
  if (!monitor.running) return;
  const target = monitor;
  const started = Date.now();
  const gatewayPromise = target.gateway
    ? pingHost(target.gateway, { count: 1, timeout: 900, sourceIp: target.sourceIp })
    : Promise.resolve(null);
  const internetPromise = pingHost('223.5.5.5', { count: 1, timeout: 900, sourceIp: target.sourceIp });
  const [gateway, internet] = await Promise.all([gatewayPromise, internetPromise]);
  if (!monitor.running || monitor !== target) return;
  let wifi = null;
  target.tick += 1;
  if (target.tick % 5 === 0) {
    try {
      const state = await getWifiInterfaces();
      if (state.current) {
        wifi = {
          ssid: state.current.ssid,
          signal: state.current.signal,
          channel: state.current.channel,
          band: state.current.band,
          rxRate: state.current.rxRate,
          txRate: state.current.txRate,
        };
      }
    } catch {
      wifi = null;
    }
  }
  if (target.webContents && !target.webContents.isDestroyed()) {
    target.webContents.send('monitor:sample', {
      t: Date.now(),
      elapsed: Date.now() - started,
      gateway: gateway
        ? { success: gateway.success, latency: gateway.avg, loss: gateway.lossPct }
        : null,
      internet: { success: internet.success, latency: internet.avg, loss: internet.lossPct },
      wifi,
    });
  }
  if (monitor.running && monitor === target) {
    monitor.timer = setTimeout(monitorTick, monitor.interval);
  }
}

function registerIpc() {
  handle('app:meta', async () => {
    const admin = await getAdminCached();
    return {
      ok: true,
      appName: APP_NAME,
      version: app.getVersion() || VERSION,
      admin,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
      dataDir: getDataDir(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      pingTargets: PING_TARGETS,
      repairActions: REPAIR_ACTIONS,
      stageDefs: STAGE_DEFS,
    };
  });

  handle('app:window', async (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!win) return { ok: false };
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
    else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
    else return { ok: false, error: '未知窗口操作' };
    return { ok: true, maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
  });

  handle('app:set-ui-scale', async (event, value) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const uiScale = applyWindowUiScale(win, value);
    return { ok: true, uiScale };
  });

  handle('net:snapshot', async (event, payload = {}) => {
    const snapshot = await getSnapshotCached(Boolean(payload.force));
    return { ok: true, snapshot };
  });

  handle('wifi:scan', async () => {
    const result = await scanWifiNetworks();
    return result;
  });

  handle('wifi:profiles', async () => getWifiProfiles());

  handle('wifi:profile-detail', async (event, payload = {}) => {
    return getWifiProfileDetail(payload.name, {
      includeKey: Boolean(payload.includeKey),
    });
  });

  handle('wifi:password', async (event, payload = {}) => {
    const result = await getWifiProfileDetail(payload.name, { includeKey: true });
    if (!result.ok) return result;
    return {
      ok: true,
      profile: {
        name: result.profile.name,
        authentication: result.profile.authentication,
        cipher: result.profile.cipher,
        keyPresent: result.profile.keyPresent,
        keyContent: result.profile.keyContent,
        keyError: result.profile.keyError || null,
      },
    };
  });

  handle('wifi:verify-password', async (event, payload = {}) => {
    return verifyWifiPassword(payload.name, payload.password);
  });

  handle('wifi:connect', async (event, payload = {}) => {
    return connectWifiProfile(payload.name);
  });

  handle('wifi:capabilities', async () => getWifiCapabilities());

  handle('wifi:restart', async () => {
    const admin = await getAdminCached(true);
    if (!admin) return { ok: false, needsAdmin: true, error: '重启 WLAN 服务需要管理员权限。' };
    const result = await restartWlanService();
    invalidateSnapshot();
    return result;
  });

  handle('net:ping', async (event, payload = {}) => {
    const targets = Array.isArray(payload.targets) && payload.targets.length
      ? payload.targets.slice(0, 60).map((t) => ({
          id: t.id || t.host,
          name: t.name || t.host,
          vendor: t.vendor || '',
          host: String(t.host || ''),
          group: t.group || 'custom',
          required: t.required !== false,
          note: t.note || '',
        }))
      : PING_TARGETS;
    const results = await pingBatch(
      targets,
      {
        count: payload.count || 4,
        timeout: payload.timeout || 1200,
        concurrency: payload.concurrency || 5,
        sourceIp: payload.sourceIp,
      },
      (result) => {
        if (!event.sender.isDestroyed()) event.sender.send('ping:result', { context: payload.context || 'ping', result });
      },
    );
    return { ok: true, results, summary: summarizePingResults(results) };
  });

  handle('net:connectivity', async (event, payload = {}) => {
    const snapshot = await getSnapshotCached();
    const targets = Array.isArray(payload.targets) ? payload.targets.slice(0, 60) : null;
    return oneClickConnectivity(snapshot, {
      targets: targets && targets.length ? targets : undefined,
      count: payload.count || 4,
      timeout: payload.timeout || 1200,
      concurrency: payload.concurrency || 5,
      sourceIp: payload.sourceIp,
      onResult: (result) => {
        if (!event.sender.isDestroyed()) event.sender.send('ping:result', { context: 'connectivity', result });
      },
    });
  });

  handle('net:dns-test', async (event, payload = {}) => dnsTest(payload));
  handle('net:tcp-test', async (event, payload = {}) => tcpTest(payload));
  handle('net:http-test', async (event, payload = {}) => httpTest(payload));

  handle('net:stability', async (event, payload = {}) => {
    const snapshot = await getSnapshotCached();
    const adapter = snapshot.active.adapter;
    return measureStability({
      gateway: payload.gateway || (adapter && adapter.gateway[0]) || null,
      host: payload.host || '223.5.5.5',
      count: payload.count || 10,
      sourceIp: payload.sourceIp || (adapter && adapter.primaryIp ? adapter.primaryIp.address : null),
    });
  });

  handle('net:mtu', async (event, payload = {}) => {
    const snapshot = await getSnapshotCached();
    const adapter = snapshot.active.adapter;
    return mtuTest({
      host: payload.host || (adapter && adapter.gateway[0]) || '223.5.5.5',
      sourceIp: payload.sourceIp || (adapter && adapter.primaryIp ? adapter.primaryIp.address : null),
    });
  });

  handle('net:trace', async (event, payload = {}) => {
    return traceRoute({
      host: payload.host || '223.5.5.5',
      maxHops: payload.maxHops || 12,
      timeout: payload.timeout || 500,
    });
  });

  handle('net:public-ip', async () => getPublicIp());
  handle('net:events', async () => getRecentNetworkEvents());

  handle('diag:run', async (event, payload = {}) => {
    if (diagRunning) return { ok: false, error: '已有一次全面体检正在进行，请稍候。' };
    diagRunning = true;
    try {
      const snapshot = await getSnapshotCached(Boolean(payload.forceSnapshot));
      const report = await runFullDiagnostic({
        snapshot,
        ifIndex: payload.ifIndex,
        version: app.getVersion() || VERSION,
        onProgress: (data) => {
          if (!event.sender.isDestroyed()) event.sender.send('diag:event', data);
        },
      });
      const settings = getSettings();
      if (report.ok && settings.autoSaveHistory) {
        const entry = saveHistory(report);
        if (entry && !event.sender.isDestroyed()) {
          event.sender.send('history:updated', { id: entry.id, createdAt: entry.createdAt });
        }
      }
      return report;
    } finally {
      diagRunning = false;
    }
  });

  handle('monitor:start', async (event, payload = {}) => {
    stopMonitor();
    const snapshot = await getSnapshotCached();
    const adapter = snapshot.active.adapter;
    monitor = {
      running: true,
      timer: null,
      webContents: event.sender,
      gateway: (adapter && adapter.gateway[0]) || null,
      sourceIp: payload.sourceIp || (adapter && adapter.primaryIp ? adapter.primaryIp.address : null),
      interval: Math.max(800, Math.min(Number(payload.interval) || 1200, 10000)),
      tick: 0,
    };
    monitorTick();
    return {
      ok: true,
      gateway: monitor.gateway,
      adapter: adapter ? { name: adapter.name, type: adapter.type } : null,
      interval: monitor.interval,
    };
  });

  handle('monitor:stop', async () => {
    stopMonitor();
    return { ok: true };
  });

  handle('speed:test', async (event, payload = {}) => {
    if (speedRunning) return { ok: false, error: '测速正在进行中，请稍候。' };
    speedRunning = true;
    try {
      const snapshot = await getSnapshotCached();
      const adapter = snapshot.active.adapter;
      const settings = getSettings();
      return await speedTest(
        {
          localAddress: payload.localAddress || (adapter && adapter.primaryIp ? adapter.primaryIp.address : undefined),
          durationMs: payload.durationMs || 9000,
          includeUpload: payload.includeUpload != null ? payload.includeUpload : settings.includeUploadInSpeedTest,
        },
        (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send('speed:progress', progress);
        },
      );
    } finally {
      speedRunning = false;
    }
  });

  handle('repair:run', async (event, payload = {}) => {
    const snapshot = await getSnapshotCached();
    let adapterName = payload.adapterName || null;
    if (!adapterName && payload.ifIndex != null) {
      const adapter = snapshot.adapters.find((a) => a.interfaceIndex === Number(payload.ifIndex));
      adapterName = adapter ? adapter.name : null;
    }
    if (!adapterName && snapshot.active.adapter) adapterName = snapshot.active.adapter.name;
    const result = await runRepair(payload.action, {
      ifIndex: payload.ifIndex != null ? payload.ifIndex : snapshot.active.adapter ? snapshot.active.adapter.interfaceIndex : null,
      adapterName,
      dataDir: getDataDir(),
    });
    invalidateSnapshot();
    return result;
  });

  handle('repair:set-priority', async (event, payload = {}) => {
    if (payload.ifIndex == null) return { ok: false, error: '缺少网卡索引' };
    const snapshot = await getSnapshotCached();
    const result = await setPreferredInterface(payload.ifIndex, {
      dataDir: getDataDir(),
      interfaces: snapshot.adapters,
    });
    invalidateSnapshot();
    return result;
  });

  handle('repair:reset-priority', async () => {
    const result = await resetPreferredInterface({ dataDir: getDataDir() });
    invalidateSnapshot();
    return result;
  });

  handle('history:list', async () => {
    const history = getHistory();
    return {
      ok: true,
      history: history.map(({ report, ...rest }) => ({ ...rest, hasReport: Boolean(report) })),
    };
  });

  handle('history:get', async (event, id) => {
    const entry = getHistoryItem(id);
    if (!entry) return { ok: false, error: '报告不存在或已被清理' };
    return { ok: true, entry };
  });

  handle('history:clear', async () => ({ ok: clearHistory() }));

  handle('report:export', async (event, payload = {}) => {
    const report = payload.report;
    if (!report || typeof report !== 'object') return { ok: false, error: '没有可导出的报告' };
    const format = ['html', 'json', 'txt'].includes(payload.format) ? payload.format : 'html';
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `WiFiMedic-Report-${stamp}.${format}`;
    const result = await dialog.showSaveDialog(win, {
      title: '导出网络体检报告',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters:
        format === 'html'
          ? [{ name: 'HTML 报告', extensions: ['html'] }]
          : format === 'json'
            ? [{ name: 'JSON 数据', extensions: ['json'] }]
            : [{ name: '文本报告', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    let content;
    if (format === 'html') content = generateHtmlReport(report);
    else if (format === 'json') content = JSON.stringify(report, null, 2);
    else content = generateTextSummary(report);
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath, format };
  });

  handle('settings:get', async () => ({ ok: true, settings: getSettings() }));
  handle('settings:update', async (event, payload = {}) => ({ ok: true, settings: updateSettings(payload) }));

  handle('app:open-external', async (event, url) => {
    const value = String(url || '');
    if (!/^(https?:|ms-settings:)/i.test(value)) return { ok: false, error: '不支持的链接协议' };
    await shell.openExternal(value);
    return { ok: true };
  });

  handle('app:open-settings', async (event, page) => {
    const mapping = {
      network: 'ms-settings:network-status',
      wifi: 'ms-settings:network-wifi',
      adapter: 'ms-settings:network-advancedsettings',
      proxy: 'ms-settings:network-proxy',
      dns: 'ms-settings:network-status',
      vpn: 'ms-settings:network-vpn',
      mobile: 'ms-settings:network-mobilehotspot',
    };
    const target = mapping[page] || 'ms-settings:network-status';
    await shell.openExternal(target);
    return { ok: true, target };
  });

  handle('app:open-data-dir', async () => {
    const dir = getDataDir();
    await shell.openPath(dir);
    return { ok: true, path: dir };
  });

  handle('app:show-item', async (event, filePath) => {
    const value = String(filePath || '');
    if (!value || !fs.existsSync(value)) return { ok: false, error: '文件不存在' };
    shell.showItemInFolder(value);
    return { ok: true };
  });

  handle('app:copy', async (event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  handle('app:relaunch-admin', async () => {
    if (await getAdminCached(true)) return { ok: true, alreadyAdmin: true };
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const args = app.isPackaged ? [] : [app.getAppPath()];
    const elevateBin = process.resourcesPath ? path.join(process.resourcesPath, 'elevate.exe') : '';
    // The elevated instance must be able to acquire the single-instance lock
    // while this non-elevated instance is still winding down.
    app.releaseSingleInstanceLock();
    let result;
    if (elevateBin && fs.existsSync(elevateBin)) {
      // electron-builder bundles Elevate.exe. It uses ShellExecuteEx with the
      // runas verb and avoids the quoting/encoding pitfalls of a PowerShell
      // Start-Process command for paths containing Chinese characters.
      result = await runCommand(elevateBin, [exe, ...args], { timeout: 120000 });
    } else {
      const argList = args.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(',');
      const script = `Start-Process -FilePath '${String(exe).replace(/'/g, "''")}' -ArgumentList @(${argList}) -Verb RunAs -ErrorAction Stop`;
      result = await ps(script, { timeout: 120000 });
    }
    if (result.ok) {
      setTimeout(() => app.quit(), 900);
      return { ok: true };
    }
    app.requestSingleInstanceLock();
    const detail = String(result.stderr || result.error || '').trim();
    if (/cancel|取消|拒绝|denied|operation was canceled|1223/i.test(detail) || result.code === 1223) {
      return { ok: false, error: '已取消管理员授权。需要时可以再次点击“管理员重启”。' };
    }
    return {
      ok: false,
      error: '未能启动管理员进程。若没有出现 UAC 授权弹窗，请关闭应用后右键 EXE，选择“以管理员身份运行”。',
    };
  });
}

function createWindow() {
  const icon = path.join(__dirname, '..', 'build', 'icon.ico');
  const windowOptions = {
    width: 1480,
    height: 930,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    frame: false,
    backgroundColor: '#05080f',
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  };
  if (fs.existsSync(icon)) windowOptions.icon = icon;
  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.setMenuBarVisibility(false);
  applyWindowUiScale(mainWindow, getSettings().uiScale);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const sendState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:state', {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    });
  };
  mainWindow.on('maximize', sendState);
  mainWindow.on('unmaximize', sendState);
  mainWindow.on('enter-full-screen', sendState);
  mainWindow.on('leave-full-screen', sendState);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendState();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(pathToFileURL(path.join(__dirname, 'renderer')).toString())) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    stopMonitor();
    mainWindow = null;
  });

  const captureArg = process.argv.find((a) => a.startsWith('--capture='));
  if (captureArg) {
    const target = captureArg.slice('--capture='.length);
    const viewArg = process.argv.find((a) => a.startsWith('--capture-view='));
    const themeArg = process.argv.find((a) => a.startsWith('--capture-theme='));
    const delayArg = process.argv.find((a) => a.startsWith('--capture-delay='));
    const views = (viewArg ? viewArg.slice('--capture-view='.length) : 'dashboard')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const theme = themeArg ? themeArg.slice('--capture-theme='.length) : '';
    const delay = delayArg ? Math.max(500, Number(delayArg.slice('--capture-delay='.length)) || 6000) : 6000;
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        if (theme) {
          await mainWindow.webContents.executeJavaScript(
            `document.documentElement.dataset.theme = ${JSON.stringify(theme === 'light' ? 'light' : 'dark')}; true;`
          );
        }
        await sleep(delay);
        for (const view of views) {
          await mainWindow.webContents.executeJavaScript(
            `(function(){ const item = document.querySelector('.nav-item[data-view=${JSON.stringify(view)}]'); if (item) item.click(); return Boolean(item); })()`
          );
          await sleep(1200);
          const probe = await mainWindow.webContents.executeJavaScript(
            `(function(){ const active = document.querySelector('.view.active'); const nav = document.querySelector('.nav-item.active'); return { view: active ? active.id : null, nav: nav ? nav.dataset.view : null, title: document.querySelector('#crumbCurrent') ? document.querySelector('#crumbCurrent').textContent : null }; })()`
          );
          console.log(`Capture probe (${view}): ${JSON.stringify(probe)}`);
          const image = await mainWindow.webContents.capturePage();
          const suffix = views.length > 1 || view !== 'dashboard' ? `-${view}` : '';
          const themed = theme ? `-${theme}` : '';
          const file = target.replace(/\.png$/i, `${suffix}${themed}.png`);
          fs.writeFileSync(file, image.toPNG());
          console.log(`Screenshot saved: ${file}`);
        }
      } catch (error) {
        console.error(error);
      }
      app.quit();
    });
  }
}

if (gotLock) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    stopMonitor();
    app.quit();
  });

  app.on('before-quit', () => {
    stopMonitor();
  });
}
