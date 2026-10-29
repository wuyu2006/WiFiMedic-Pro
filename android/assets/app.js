'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STORAGE = {
  theme: 'wifimedic.android.theme',
  targets: 'wifimedic.android.targets',
  lastDiag: 'wifimedic.android.lastDiag',
};

const DIAG_STAGES = [
  { id: 'network', label: '网络连接', desc: '确认系统网络可用', weight: 20 },
  { id: 'ip', label: 'IP 地址', desc: '检查 IPv4 地址分配', weight: 12 },
  { id: 'gateway', label: '默认网关', desc: 'Ping 本地路由器', weight: 12 },
  { id: 'dns', label: 'DNS 解析', desc: '解析 5 个常见域名', weight: 14 },
  { id: 'ping', label: '厂商节点 Ping', desc: 'Ping 3 个国内节点', weight: 16 },
  { id: 'tcp', label: 'TCP 443 服务', desc: '连接 3 个 HTTPS 端口', weight: 10 },
  { id: 'http', label: 'HTTP 访问', desc: '访问 3 个网站', weight: 10 },
  { id: 'wifi', label: 'Wi-Fi 链路', desc: '读取无线信号与安全信息', weight: 6 },
];

const DEFAULT_TARGETS = [
  { id: 'gateway', name: '默认网关', host: '', dynamic: true, enabled: true, note: '本地路由器' },
  { id: 'aliyun', name: '阿里云 DNS', host: '223.5.5.5', enabled: true, note: '公共 DNS' },
  { id: 'tencent', name: '腾讯 DNS', host: '119.29.29.29', enabled: true, note: '公共 DNS' },
  { id: 'baidu', name: '百度', host: 'www.baidu.com', enabled: true, note: '国内厂商' },
  { id: 'qq', name: '腾讯', host: 'www.qq.com', enabled: true, note: '国内厂商' },
  { id: 'google', name: 'Google', host: '8.8.8.8', enabled: false, note: '国际节点 · 默认关闭' },
];

const TARGET_STATUS = new WeakMap();
let callbackCounter = 0;
const callbacks = new Map();
let mockWifiPermission = true;
let toastTimer = null;

const state = {
  view: 'overview',
  overview: null,
  wifi: null,
  wifiLoading: false,
  diag: { running: false, score: null, stages: [], finishedAt: null },
  conn: { running: false, results: null },
  targets: loadTargets(),
  speed: { running: false },
};

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text == null || text === '' ? '--' : String(text);
}

function setPill(id, text, tone = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `pill${tone ? ' ' + tone : ''}`;
}

function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '--';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAndroidBridge() {
  return Boolean(window.Android && typeof window.Android.overview === 'function');
}

/* ------------------------------------------------------------------ */
/* Native bridge                                                       */
/* ------------------------------------------------------------------ */

window.__androidResolve = (callbackId, payload) => {
  const pending = callbacks.get(callbackId);
  if (!pending) return;
  callbacks.delete(callbackId);
  clearTimeout(pending.timer);
  try {
    pending.resolve(JSON.parse(payload));
  } catch (error) {
    pending.reject(new Error('Android 返回了无法解析的数据'));
  }
};

function nativeCall(method, ...args) {
  if (!isAndroidBridge()) return mockCall(method, ...args);
  return new Promise((resolve, reject) => {
    const callbackId = `wifimedic_${Date.now()}_${++callbackCounter}`;
    const timer = setTimeout(() => {
      callbacks.delete(callbackId);
      reject(new Error('检测超时，请稍后重试'));
    }, 35000);
    callbacks.set(callbackId, { resolve, reject, timer });
    try {
      const fn = window.Android[method];
      if (typeof fn !== 'function') throw new Error(`设备不支持 ${method}`);
      fn.apply(window.Android, [...args, callbackId]);
    } catch (error) {
      callbacks.delete(callbackId);
      clearTimeout(timer);
      reject(error);
    }
  });
}

function directNative(method, ...args) {
  if (!isAndroidBridge()) return false;
  try {
    const fn = window.Android[method];
    if (typeof fn === 'function') {
      fn.apply(window.Android, args);
      return true;
    }
  } catch (error) {
    showToast('系统调用失败');
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Browser preview data                                                */
/* ------------------------------------------------------------------ */

const MOCK_WIFI = {
  ok: true,
  permission: true,
  enabled: true,
  ssid: 'CMCC-5G',
  bssid: 'A4:5E:60:11:8C:21',
  rssi: -58,
  signal: 84,
  frequency: 5180,
  band: '5 GHz',
  linkSpeed: 866,
  security: 'WPA3',
  ip: '192.168.1.23',
};

async function mockCall(method, ...args) {
  await delay(method === 'speedTest' ? 850 : 180);
  switch (method) {
    case 'overview':
      return {
        ok: true,
        online: true,
        type: 'Wi-Fi',
        interfaceName: 'wlan0',
        ipv4: MOCK_WIFI.ip,
        gateway: '192.168.1.1',
        dns: ['192.168.1.1', '223.5.5.5'],
        downKbps: 866000,
        operator: '中国移动',
        wifiEnabled: true,
        wifiPermission: mockWifiPermission,
        device: 'Pixel 8',
        android: 'Android 14',
        timestamp: Date.now(),
        wifi: mockWifiPermission ? { ...MOCK_WIFI } : { ok: false, permission: false, error: '需要授予附近设备 / 位置权限才能读取 Wi-Fi 名称。' },
      };
    case 'wifiInfo':
      return mockWifiPermission
        ? { ...MOCK_WIFI }
        : { ok: false, permission: false, error: '需要授予附近设备 / 位置权限才能读取 Wi-Fi 名称。' };
    case 'ping': {
      const host = String(args[0] || '');
      if (/google|8\.8\.8\.8/i.test(host)) {
        return { ok: false, host, avg: null, loss: 100, duration: 2100, error: '目标不可达' };
      }
      const avg = host === '192.168.1.1' ? 4.2 : 18 + Math.round(Math.random() * 24);
      return { ok: true, host, avg, loss: 0, duration: 1600, sent: 3, received: 3 };
    }
    case 'dnsTest':
      return {
        ok: true,
        success: 5,
        total: 5,
        avg: 26.4,
        results: ['baidu.com', 'qq.com', 'aliyun.com', 'taobao.com', 'google.com'].map((domain) => ({ domain, ok: true, ms: 18 + Math.round(Math.random() * 25), addresses: 2 })),
      };
    case 'tcpTest':
      return {
        ok: true,
        success: 3,
        total: 3,
        avg: 41.8,
        results: [
          { name: '百度', host: 'www.baidu.com', ok: true, ms: 31.2 },
          { name: '腾讯', host: 'www.qq.com', ok: true, ms: 46.7 },
          { name: '阿里云', host: 'www.aliyun.com', ok: true, ms: 47.5 },
        ],
      };
    case 'httpTest':
      return {
        ok: true,
        success: 3,
        total: 3,
        avg: 184,
        results: [
          { name: '百度', host: 'https://www.baidu.com/', ok: true, code: 200, ms: 142 },
          { name: '腾讯', host: 'https://www.qq.com/', ok: true, code: 200, ms: 196 },
          { name: '阿里云', host: 'https://www.aliyun.com/', ok: true, code: 200, ms: 214 },
        ],
      };
    case 'speedTest':
      return { ok: true, mbps: 86.4, bytes: 2490000, ms: 230, source: 'Cloudflare' };
    case 'scanWifi':
      if (!mockWifiPermission) return { ok: false, permission: false, error: '需要授予附近设备 / 位置权限才能扫描周边网络。', networks: [] };
      return {
        ok: true,
        permission: true,
        networks: [
          { ssid: 'CMCC-5G', bssid: 'A4:5E:60:11:8C:21', signal: 84, frequency: 5180, band: '5 GHz', security: 'WPA3', current: true },
          { ssid: 'Office-WiFi', bssid: '44:1C:A8:7D:02:90', signal: 63, frequency: 2437, band: '2.4 GHz', security: 'WPA2', current: false },
          { ssid: 'Guest-Network', bssid: '44:1C:A8:7D:02:91', signal: 42, frequency: 2437, band: '2.4 GHz', security: '开放网络', current: false },
          { ssid: 'TP-LINK_5G', bssid: 'B0:4E:26:11:92:0A', signal: 31, frequency: 5745, band: '5 GHz', security: 'WPA2', current: false },
        ],
      };
    default:
      throw new Error(`预览模式不支持 ${method}`);
  }
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  const meta = document.getElementById('metaTheme');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#131614' : '#F1EFE8');
  try { localStorage.setItem(STORAGE.theme, next); } catch (error) { /* ignore */ }
  directNative('setDarkMode', next === 'dark');
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE.theme); } catch (error) { /* ignore */ }
  const params = new URLSearchParams(window.location.search);
  const previewTheme = params.get('theme');
  if (previewTheme === 'light' || previewTheme === 'dark') {
    applyTheme(previewTheme);
    return;
  }
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (systemDark ? 'dark' : 'light'));
}

/* ------------------------------------------------------------------ */
/* View switching                                                      */
/* ------------------------------------------------------------------ */

function switchView(view) {
  if (!view) return;
  state.view = view;
  $$('.view').forEach((section) => section.classList.toggle('is-active', section.id === `view-${view}`));
  $$('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === view));
  window.scrollTo(0, 0);
  if (view === 'overview') loadOverview();
  if (view === 'wifi') loadWifi();
}

function bindNavigation() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
  $('#quickDiagBtn')?.addEventListener('click', () => {
    switchView('diagnostics');
    setTimeout(() => runDiagnostics(), 120);
  });
  $('#openWifiOverview')?.addEventListener('click', openWifiSettings);
  $('#openWifiPassword')?.addEventListener('click', openWifiSettings);
  $('#openWifiSettingsBtn')?.addEventListener('click', openWifiSettings);
  $('#refreshWifiBtn')?.addEventListener('click', () => loadWifi(true));
  $('#requestWifiBtn')?.addEventListener('click', requestWifiPermission);
  $('#scanWifiBtn')?.addEventListener('click', scanWifi);
  $('#runDiagBtn')?.addEventListener('click', runDiagnostics);
  $('#runSpeedBtn')?.addEventListener('click', runSpeedTest);
  $('#runConnBtn')?.addEventListener('click', runConnectivity);
  $('#resetTargetsBtn')?.addEventListener('click', resetTargets);
  $('#themeBtn')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('.switch-btn');
    if (toggle) {
      const row = toggle.closest('[data-target]');
      if (!row) return;
      const target = state.targets.find((item) => item.id === row.dataset.target);
      if (!target) return;
      target.enabled = !target.enabled;
      saveTargets();
      renderTargets();
      renderConnIdle();
    }
  });
}

function openWifiSettings() {
  if (!directNative('openWifiSettings')) showToast('请在系统设置中打开 Wi-Fi');
}

function requestWifiPermission() {
  if (directNative('requestWifiPermission')) return;
  mockWifiPermission = true;
  $('#wifiPermissionCard').hidden = true;
  showToast('已获得 Wi-Fi 读取权限');
  loadOverview();
  loadWifi(true);
}

window.onAndroidPermission = (granted) => {
  $('#wifiPermissionCard').hidden = Boolean(granted);
  showToast(granted ? '已获得 Wi-Fi 读取权限' : '未获得权限，只能查看基础网络信息');
  loadOverview();
  if (granted) loadWifi(true);
};

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

async function loadOverview() {
  try {
    const data = await nativeCall('overview');
    if (!data || data.ok === false) throw new Error((data && data.error) || '读取网络信息失败');
    state.overview = data;
    renderOverview(data);
    renderTargets();
    if (state.conn.results) renderConnResults(state.conn.results);
    else renderConnIdle();
  } catch (error) {
    setText('ovStatus', '读取失败');
    setText('ovSub', error.message || '请检查网络权限');
    setPill('ovType', '错误', 'bad');
    const dot = $('#statusDot');
    if (dot) dot.className = 'status-dot bad';
  }
}

function renderOverview(data) {
  const wifi = data.wifi || {};
  const online = Boolean(data.online);
  const isWifi = data.type === 'Wi-Fi';
  const dot = $('#statusDot');
  if (dot) dot.className = `status-dot ${online ? 'good' : 'bad'}`;
  setText('ovStatus', online ? (isWifi ? 'Wi-Fi 已连接' : `${data.type || '网络'} 已连接`) : '网络未连接');
  setText('ovSub', online ? `${data.type || '网络'} · ${data.operator || '运营商未知'}` : '请检查 Wi-Fi、移动数据或系统网络设置');
  setPill('ovType', data.type || '未连接', online ? 'good' : 'bad');

  const link = Number(data.downKbps || 0);
  const linkText = link > 0 ? `${(link / 1000).toFixed(0)} Mbps` : (wifi.linkSpeed ? `${wifi.linkSpeed} Mbps` : '--');
  setText('ovLink', linkText);
  setText('ovSignal', isWifi && wifi.signal != null ? `${wifi.signal}%` : '--');
  setText('ovOnline', online ? '在线' : '离线');
  setText('ovSsid', isWifi && wifi.ssid ? wifi.ssid : (isWifi ? '未连接 Wi-Fi' : '未使用'));
  setText('ovBand', isWifi ? (wifi.band || '无线连接') : '当前为非无线通道');
  setText('ovIp', data.ipv4 || '--');
  setText('ovIface', data.interfaceName || '--');
  setText('ovGateway', data.gateway || '--');
  const dns = Array.isArray(data.dns) && data.dns.length ? data.dns.slice(0, 2).join(' · ') : '--';
  setText('ovDns', dns);
  setPill('ovPlatform', data.android || 'Android');

  const details = [
    ['设备', data.device || '--'],
    ['系统', data.android || '--'],
    ['网络类型', data.type || '--'],
    ['接口', data.interfaceName || '--'],
    ['运营商', data.operator || '--'],
    ['Wi-Fi 频段', isWifi ? (wifi.band || '--') : '--'],
    ['Wi-Fi 安全', isWifi ? (wifi.security || '--') : '--'],
    ['DNS 服务器', Array.isArray(data.dns) && data.dns.length ? data.dns.join(' · ') : '--'],
  ];
  const list = $('#ovDetails');
  if (list) {
    list.innerHTML = details.map(([label, value]) => `<div><span>${esc(label)}</span><b title="${esc(value)}">${esc(value)}</b></div>`).join('');
  }
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

function renderDiagRows(results = []) {
  const lookup = new Map(results.map((item) => [item.id, item]));
  const list = $('#diagList');
  if (!list) return;
  list.innerHTML = DIAG_STAGES.map((stage, index) => {
    const result = lookup.get(stage.id);
    const status = result ? result.status : 'idle';
    const detail = result ? result.detail : stage.desc;
    const labels = { idle: '待检查', running: '检查中', pass: '通过', warn: '注意', fail: '失败', skip: '跳过' };
    return `<div class="check-row ${esc(status)}" data-stage="${esc(stage.id)}">
      <span class="check-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="check-copy"><b>${esc(stage.label)}</b><small title="${esc(detail)}">${esc(detail)}</small></span>
      <span class="check-state">${labels[status] || '待检查'}</span>
    </div>`;
  }).join('');
}

function setStage(stageId, status, detail) {
  const stage = state.diag.stages.find((item) => item.id === stageId);
  if (stage) {
    stage.status = status;
    stage.detail = detail;
  } else {
    state.diag.stages.push({ id: stageId, status, detail });
  }
  const row = $(`[data-stage="${stageId}"]`);
  if (!row) return;
  row.className = `check-row ${status}`;
  const copy = $('.check-copy small', row);
  if (copy) copy.textContent = detail || '';
  const stateLabel = $('.check-state', row);
  const labels = { running: '检查中', pass: '通过', warn: '注意', fail: '失败', skip: '跳过' };
  if (stateLabel) stateLabel.textContent = labels[status] || '待检查';
  const index = $('.check-index', row);
  if (index) index.textContent = status === 'pass' ? '✓' : status === 'fail' ? '×' : String(DIAG_STAGES.findIndex((item) => item.id === stageId) + 1).padStart(2, '0');
}

function setScore(score, tone) {
  const ring = $('#scoreRing');
  if (ring) {
    ring.style.setProperty('--score', String(Math.max(0, Math.min(100, score == null ? 0 : score))));
    ring.style.setProperty('--ring-color', tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)');
  }
  setText('scoreValue', score == null ? '--' : String(score));
}

function toneForScore(score) {
  if (score == null) return '';
  if (score >= 90) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

function verdictForScore(score) {
  if (score >= 90) return '优秀';
  if (score >= 75) return '良好';
  if (score >= 60) return '一般';
  return '需处理';
}

async function runDiagnostics() {
  if (state.diag.running) return;
  state.diag.running = true;
  state.diag.stages = [];
  setScore(null);
  setPill('diagState', '检查中', '');
  setText('diagTitle', '正在执行网络体检');
  setText('diagSummary', '正在逐项检查连接、地址、DNS 与服务可达性…');
  setText('diagTime', '请稍候');
  const button = $('#runDiagBtn');
  if (button) { button.disabled = true; button.innerHTML = '<svg><use href="#i-refresh"></use></svg>体检进行中…'; }
  renderDiagRows();
  $$('.check-row').forEach((row) => { row.classList.add('idle'); });

  try {
    let overview = null;
    setStage('network', 'running', '正在读取当前网络状态…');
    try {
      overview = await nativeCall('overview');
    } catch (error) {
      overview = null;
    }
    if (overview && overview.online) {
      setStage('network', 'pass', `${overview.type || '网络'} · ${overview.operator || '已联网'}`);
    } else {
      setStage('network', 'fail', overview ? '系统没有可用网络' : '无法读取网络状态');
    }

    setStage('ip', 'running', '正在检查 IPv4 地址…');
    if (overview && overview.ipv4 && overview.ipv4 !== '—') {
      setStage('ip', 'pass', `${overview.ipv4} · ${overview.interfaceName || '接口未知'}`);
    } else {
      setStage('ip', 'fail', '未获取到 IPv4 地址');
    }

    setStage('gateway', 'running', '正在 Ping 默认网关…');
    if (overview && overview.gateway && overview.gateway !== '—') {
      const ping = await nativeCall('ping', overview.gateway, 3);
      if (ping.ok) setStage('gateway', 'pass', `${overview.gateway} · 平均 ${ping.avg} ms`);
      else setStage('gateway', 'fail', `${overview.gateway} 无响应`);
    } else {
      setStage('gateway', 'warn', '未获取到默认网关');
    }

    setStage('dns', 'running', '正在解析常见域名…');
    const dns = await nativeCall('dnsTest');
    if (dns.success >= 5) setStage('dns', 'pass', `${dns.success}/${dns.total} 解析成功 · 平均 ${dns.avg} ms`);
    else if (dns.success >= 3) setStage('dns', 'warn', `${dns.success}/${dns.total} 解析成功`);
    else setStage('dns', 'fail', `仅 ${dns.success}/${dns.total} 个域名解析成功`);

    setStage('ping', 'running', '正在测试国内厂商节点…');
    const pingTargets = [
      { name: '百度', host: 'www.baidu.com' },
      { name: '腾讯', host: 'www.qq.com' },
      { name: '阿里云', host: 'www.aliyun.com' },
    ];
    const pingResults = await Promise.all(pingTargets.map(async (target) => {
      try { return { ...target, result: await nativeCall('ping', target.host, 3) }; }
      catch (error) { return { ...target, result: { ok: false, avg: null } }; }
    }));
    const pingPassed = pingResults.filter((item) => item.result.ok);
    const pingAvg = pingPassed.length ? Math.round(pingPassed.reduce((sum, item) => sum + Number(item.result.avg || 0), 0) / pingPassed.length) : null;
    if (pingPassed.length === pingTargets.length) setStage('ping', 'pass', `3/3 可达 · 平均 ${pingAvg} ms`);
    else if (pingPassed.length >= 2) setStage('ping', 'warn', `${pingPassed.length}/3 可达 · 平均 ${pingAvg} ms`);
    else setStage('ping', 'fail', `仅 ${pingPassed.length}/3 个节点可达`);

    setStage('tcp', 'running', '正在连接 TCP 443…');
    const tcp = await nativeCall('tcpTest');
    if (tcp.success >= tcp.total) setStage('tcp', 'pass', `${tcp.success}/${tcp.total} 可连接 · 平均 ${tcp.avg} ms`);
    else if (tcp.success > 0) setStage('tcp', 'warn', `${tcp.success}/${tcp.total} 可连接`);
    else setStage('tcp', 'fail', 'HTTPS 端口连接失败');

    setStage('http', 'running', '正在访问 HTTP 服务…');
    const http = await nativeCall('httpTest');
    if (http.success >= http.total) setStage('http', 'pass', `${http.success}/${http.total} 访问成功`);
    else if (http.success > 0) setStage('http', 'warn', `${http.success}/${http.total} 访问成功`);
    else setStage('http', 'fail', 'HTTP / HTTPS 访问失败');

    setStage('wifi', 'running', '正在读取 Wi-Fi 链路…');
    try {
      const wifi = await nativeCall('wifiInfo');
      if (wifi.ok) setStage('wifi', 'pass', `${wifi.ssid} · ${wifi.band} · 信号 ${wifi.signal}%`);
      else if (!wifi.permission) setStage('wifi', 'warn', '未授权读取 Wi-Fi 名称');
      else setStage('wifi', 'warn', wifi.error || '当前没有 Wi-Fi 连接');
    } catch (error) {
      setStage('wifi', 'warn', 'Wi-Fi 信息不可用');
    }

    let score = 100;
    for (const stage of DIAG_STAGES) {
      const result = state.diag.stages.find((item) => item.id === stage.id);
      if (!result) continue;
      if (result.status === 'fail') score -= stage.weight;
      else if (result.status === 'warn') score -= Math.round(stage.weight * 0.45);
      else if (result.status === 'skip') score -= Math.round(stage.weight * 0.5);
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const tone = toneForScore(score);
    const verdict = verdictForScore(score);
    const passCount = state.diag.stages.filter((item) => item.status === 'pass').length;
    const warnCount = state.diag.stages.filter((item) => item.status === 'warn').length;
    const failCount = state.diag.stages.filter((item) => item.status === 'fail').length;
    state.diag.score = score;
    state.diag.finishedAt = Date.now();
    setScore(score, tone);
    setPill('diagState', `${verdict} · ${score} 分`, tone);
    setText('diagTitle', failCount ? '发现需要关注的网络问题' : '网络体检完成');
    setText('diagSummary', `${passCount} 项通过 · ${warnCount} 项提醒 · ${failCount} 项失败`);
    setText('diagTime', `完成于 ${formatTime(state.diag.finishedAt)}`);
    try {
      localStorage.setItem(STORAGE.lastDiag, JSON.stringify({
        score,
        verdict,
        finishedAt: state.diag.finishedAt,
        stages: state.diag.stages,
      }));
    } catch (error) { /* ignore */ }
    showToast(`体检完成 · ${verdict} · ${score} 分`);
  } catch (error) {
    setPill('diagState', '体检失败', 'bad');
    setText('diagTitle', '体检未能完成');
    setText('diagSummary', error.message || '请稍后重试');
    setText('diagTime', '未生成结果');
    showToast('体检未完成，请重试');
  } finally {
    state.diag.running = false;
    if (button) { button.disabled = false; button.innerHTML = '<svg><use href="#i-stethoscope"></use></svg>重新全面体检'; }
  }
}

function loadLastDiagnostics() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE.lastDiag) || 'null');
    if (!saved || saved.score == null) return;
    state.diag.score = saved.score;
    state.diag.stages = Array.isArray(saved.stages) ? saved.stages : [];
    state.diag.finishedAt = saved.finishedAt;
    const tone = toneForScore(saved.score);
    setScore(saved.score, tone);
    setPill('diagState', `上次 ${saved.verdict || verdictForScore(saved.score)}`, tone);
    setText('diagTitle', '上次体检结果');
    setText('diagSummary', `${state.diag.stages.filter((item) => item.status === 'pass').length} 项通过 · ${state.diag.stages.filter((item) => item.status === 'warn').length} 项提醒`);
    setText('diagTime', `完成于 ${formatTime(saved.finishedAt)}`);
    renderDiagRows(state.diag.stages);
  } catch (error) { /* ignore */ }
}

async function runSpeedTest() {
  if (state.speed.running) return;
  state.speed.running = true;
  const button = $('#runSpeedBtn');
  if (button) { button.disabled = true; button.innerHTML = '<svg><use href="#i-refresh"></use></svg>测速中…'; }
  setPill('speedState', '测速中', '');
  setText('speedMbps', '--');
  setText('speedSource', '正在下载测试数据，请保持网络连接…');
  try {
    const result = await nativeCall('speedTest');
    if (result.ok) {
      setText('speedMbps', String(result.mbps));
      setPill('speedState', '完成', 'good');
      setText('speedSource', `${result.source || '测速节点'} · 下载 ${(result.bytes / 1000000).toFixed(1)} MB · 用时 ${result.ms} ms`);
      showToast(`下载速度约 ${result.mbps} Mbps`);
    } else {
      setPill('speedState', '失败', 'bad');
      setText('speedSource', result.error || '测速节点不可用');
      showToast('测速失败，请稍后重试');
    }
  } catch (error) {
    setPill('speedState', '失败', 'bad');
    setText('speedSource', error.message || '测速失败');
  } finally {
    state.speed.running = false;
    if (button) { button.disabled = false; button.innerHTML = '<svg><use href="#i-speed"></use></svg>重新测速'; }
  }
}

/* ------------------------------------------------------------------ */
/* Connectivity                                                        */
/* ------------------------------------------------------------------ */

function loadTargets() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE.targets) || 'null');
    if (Array.isArray(saved)) {
      return DEFAULT_TARGETS.map((target) => {
        const match = saved.find((item) => item && item.id === target.id);
        return { ...target, enabled: match && typeof match.enabled === 'boolean' ? match.enabled : target.enabled };
      });
    }
  } catch (error) { /* ignore */ }
  return DEFAULT_TARGETS.map((target) => ({ ...target }));
}

function saveTargets() {
  try {
    localStorage.setItem(STORAGE.targets, JSON.stringify(state.targets.map(({ id, enabled }) => ({ id, enabled }))));
  } catch (error) { /* ignore */ }
}

function targetWithGateway() {
  const gateway = state.overview && state.overview.gateway && state.overview.gateway !== '—' ? state.overview.gateway : '';
  return state.targets.map((target) => target.dynamic ? { ...target, host: gateway } : target);
}

function enabledTargets() {
  return targetWithGateway().filter((target) => target.enabled && target.host);
}

function setConnIcon(name) {
  const icon = $('#connIcon');
  if (icon) icon.innerHTML = `<svg><use href="#i-${name}"></use></svg>`;
}

function renderConnIdle() {
  const targets = state.targets;
  setText('connEnabled', String(targets.filter((target) => target.enabled && (!target.dynamic || (state.overview && state.overview.gateway && state.overview.gateway !== '—'))).length));
  setText('connReachable', '--');
  setText('connAvg', '--');
  setPill('connState', '等待测试', '');
  setText('connTitle', '准备连通性测试');
  setText('connSummary', '选择需要测试的目标，然后开始。');
  setConnIcon('globe');
  const banner = $('#connBanner');
  if (banner) banner.className = 'conn-banner';
}

function renderTargets() {
  const targets = targetWithGateway();
  const results = new Map((state.conn.results || []).map((item) => [item.id, item]));
  const list = $('#targetList');
  if (!list) return;
  list.innerHTML = targets.map((target) => {
    const result = results.get(target.id);
    let latency = '--';
    let latencyTone = '';
    if (result) {
      if (result.ok) {
        latency = `${result.avg} ms`;
        latencyTone = result.avg < 60 ? 'good' : result.avg < 150 ? 'warn' : 'bad';
      } else {
        latency = '不可达';
        latencyTone = 'bad';
      }
    } else if (target.enabled && !target.host && target.dynamic) {
      latency = '未获取';
    }
    return `<div class="target-row ${target.enabled ? 'is-on' : ''}" data-target="${esc(target.id)}">
      <span class="target-copy"><b>${esc(target.name)}</b><small>${esc(target.host || '默认网关未获取')} · ${esc(target.note || '')}</small></span>
      <span class="target-latency ${latencyTone}">${latency}</span>
      <button class="switch-btn" type="button" role="switch" aria-checked="${target.enabled ? 'true' : 'false'}" aria-label="${esc(target.name)}"></button>
    </div>`;
  }).join('');
}

function renderConnResults(results) {
  const targets = targetWithGateway();
  const reachable = results.filter((item) => item.ok).length;
  const enabled = enabledTargets().length;
  const allPass = enabled > 0 && reachable === enabled;
  const failed = results.filter((item) => !item.ok).map((item) => item.name);
  const avgValues = results.filter((item) => item.ok && item.avg != null).map((item) => Number(item.avg));
  const avg = avgValues.length ? Math.round(avgValues.reduce((sum, value) => sum + value, 0) / avgValues.length) : null;
  setText('connEnabled', String(enabled));
  setText('connReachable', String(reachable));
  setText('connAvg', avg == null ? '--' : `${avg} ms`);
  setPill('connState', allPass ? '通过' : '部分不可达', allPass ? 'good' : 'bad');
  setText('connTitle', allPass ? '全部目标可达' : '存在不可达目标');
  setText('connSummary', allPass ? '所有已启用节点均有响应，当前链路连通性良好。' : `${failed.join('、')} 没有响应，请检查网络或关闭可选目标后重试。`);
  setConnIcon(allPass ? 'check' : 'alert');
  const banner = $('#connBanner');
  if (banner) banner.className = `conn-banner ${allPass ? 'good' : 'fail'}`;
  renderTargets();
}

async function runConnectivity() {
  if (state.conn.running) return;
  const targets = enabledTargets();
  if (!targets.length) { showToast('请至少启用一个测试目标'); return; }
  state.conn.running = true;
  const button = $('#runConnBtn');
  if (button) { button.disabled = true; button.innerHTML = '<svg><use href="#i-refresh"></use></svg>测试中…'; }
  setPill('connState', '测试中', '');
  setText('connTitle', '正在并行 Ping 目标');
  setText('connSummary', '正在等待各节点响应，通常需要几秒钟。');
  setConnIcon('activity');
  const banner = $('#connBanner');
  if (banner) banner.className = 'conn-banner';
  try {
    const results = await Promise.all(targets.map(async (target) => {
      try {
        const result = await nativeCall('ping', target.host, 3);
        return { ...target, ok: Boolean(result.ok), avg: result.avg, loss: result.loss, error: result.error };
      } catch (error) {
        return { ...target, ok: false, avg: null, loss: 100, error: error.message };
      }
    }));
    state.conn.results = results;
    renderConnResults(results);
    const pass = results.filter((item) => item.ok).length;
    showToast(pass === results.length ? '连通性检查通过' : `${results.length - pass} 个目标不可达`);
  } catch (error) {
    setPill('connState', '测试失败', 'bad');
    setText('connTitle', '连通性测试未能完成');
    setText('connSummary', error.message || '请稍后重试');
    setConnIcon('alert');
  } finally {
    state.conn.running = false;
    if (button) { button.disabled = false; button.innerHTML = '<svg><use href="#i-zap"></use></svg>重新连通测试'; }
  }
}

function resetTargets() {
  state.targets = DEFAULT_TARGETS.map((target) => ({ ...target }));
  saveTargets();
  state.conn.results = null;
  renderTargets();
  renderConnIdle();
  showToast('已恢复默认测试目标');
}

/* ------------------------------------------------------------------ */
/* Wi-Fi                                                               */
/* ------------------------------------------------------------------ */

async function loadWifi(showFeedback = false) {
  if (state.wifiLoading) return;
  state.wifiLoading = true;
  if (showFeedback) showToast('正在刷新 Wi-Fi 信息…');
  try {
    const data = await nativeCall('wifiInfo');
    state.wifi = data;
    renderWifi(data);
  } catch (error) {
    renderWifi({ ok: false, error: error.message || '无法读取 Wi-Fi 信息', permission: true });
  } finally {
    state.wifiLoading = false;
  }
}

function renderWifi(data) {
  const permissionCard = $('#wifiPermissionCard');
  const needsPermission = data && data.permission === false;
  if (permissionCard) permissionCard.hidden = !needsPermission;
  if (data && data.ok) {
    setPill('wifiState', '已连接', 'good');
    setText('wifiSsid', data.ssid || '--');
    setText('wifiMeta', `${data.band || '无线'} · ${data.security || '安全类型未知'}`);
    setText('wifiSignal', data.signal != null ? `${data.signal}%` : '--');
    setText('wifiBand', data.band || '--');
    setText('wifiLink', data.linkSpeed ? `${data.linkSpeed} Mbps` : '--');
    setText('wifiSecurity', data.security || '--');
    setText('wifiBssid', data.bssid || '--');
    return;
  }
  setPill('wifiState', needsPermission ? '未授权' : '未连接', 'warn');
  setText('wifiSsid', needsPermission ? '需要权限' : '未连接 Wi-Fi');
  setText('wifiMeta', (data && data.error) || '请连接到 Wi-Fi 后重试');
  setText('wifiSignal', '--');
  setText('wifiBand', '--');
  setText('wifiLink', '--');
  setText('wifiSecurity', '--');
  setText('wifiBssid', '--');
}

async function scanWifi() {
  const button = $('#scanWifiBtn');
  if (button) { button.disabled = true; button.textContent = '扫描中…'; }
  try {
    const result = await nativeCall('scanWifi');
    if (result.ok && Array.isArray(result.networks)) {
      renderScanList(result.networks);
      showToast(`发现 ${result.networks.length} 个周边网络`);
    } else {
      renderScanList([], result.error || '未能读取周边网络');
      if (result.permission === false) {
        const card = $('#wifiPermissionCard');
        if (card) card.hidden = false;
      }
    }
  } catch (error) {
    renderScanList([], error.message || '扫描失败');
  } finally {
    if (button) { button.disabled = false; button.innerHTML = '<svg><use href="#i-refresh"></use></svg>扫描'; }
  }
}

function renderScanList(networks, message) {
  const list = $('#scanList');
  if (!list) return;
  if (!networks.length) {
    list.innerHTML = `<p class="empty-text">${esc(message || '没有发现周边网络。')}</p>`;
    return;
  }
  list.innerHTML = networks.map((network) => `
    <div class="scan-row ${network.current ? 'current' : ''}">
      <span class="scan-icon"><svg><use href="#i-${network.current ? 'wifi' : 'signal'}"></use></svg></span>
      <span class="scan-copy"><b>${esc(network.ssid)}</b><small>${esc(network.band || '')} · ${esc(network.security || '开放网络')}</small></span>
      <span class="pill ${network.signal >= 70 ? 'good' : network.signal >= 40 ? 'warn' : 'bad'}">${network.signal == null ? '--' : `${network.signal}%`}</span>
    </div>`).join('');
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function initMockPreviewNotice() {
  if (isAndroidBridge()) return;
  const badge = document.getElementById('ovPlatform');
  if (badge) badge.textContent = '预览模式';
}

async function boot() {
  initTheme();
  bindNavigation();
  renderDiagRows();
  loadLastDiagnostics();
  renderTargets();
  renderConnIdle();
  initMockPreviewNotice();
  await loadOverview();
  const params = new URLSearchParams(window.location.search);
  const initialView = params.get('view');
  if (initialView && ['overview', 'diagnostics', 'connectivity', 'wifi', 'about'].includes(initialView) && initialView !== 'overview') {
    switchView(initialView);
  } else if (state.view === 'wifi') {
    loadWifi();
  }
}

document.addEventListener('DOMContentLoaded', boot);
