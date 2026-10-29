'use strict';

(() => {
  /* =========================================================
     WiFiMedic Pro — renderer application
     ========================================================= */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const RING_CIRCUMFERENCE = 2 * Math.PI * 68;
  const MAX_SAMPLES = 60;

  const VIEW_LABELS = {
    dashboard: '健康总览',
    diagnostic: '全面体检',
    channels: '网络通道',
    wifi: 'Wi-Fi 管理',
    connectivity: '连通性测试',
    stability: '速度与稳定',
    repair: '修复工具',
    reports: '报告中心',
  };

  const GROUP_LABELS = {
    gateway: '本地链路',
    dns: '公共 DNS',
    domestic: '国内厂商',
    global: '国际服务',
    custom: '自定义节点',
  };

  const GROUP_ORDER = ['gateway', 'dns', 'domestic', 'global', 'custom'];

  const TONE_COLORS = {
    excellent: '#2f7d6b',
    good: '#4a7fa5',
    fair: '#a97732',
    poor: '#b45151',
    critical: '#a13f3f',
  };

  const FALLBACK_STAGES = [
    { id: 'system', label: '系统环境与代理', icon: 'system' },
    { id: 'channel', label: '上网通道与路由', icon: 'route' },
    { id: 'link', label: '网卡 / 无线链路', icon: 'adapter' },
    { id: 'ip', label: 'IP 地址与 DHCP', icon: 'ip' },
    { id: 'gateway', label: '网关可达性', icon: 'gateway' },
    { id: 'dns', label: 'DNS 解析', icon: 'dns' },
    { id: 'icmp', label: '厂商节点 Ping', icon: 'ping' },
    { id: 'tcp', label: 'TCP 443 服务', icon: 'tcp' },
    { id: 'web', label: 'HTTP / HTTPS 访问', icon: 'globe' },
    { id: 'stability', label: '延迟与丢包稳定性', icon: 'activity' },
    { id: 'mtu', label: 'MTU 分片探测', icon: 'packet' },
    { id: 'wifi', label: 'Wi-Fi 射频分析', icon: 'wifi' },
    { id: 'events', label: '网络事件日志', icon: 'log' },
    { id: 'route', label: '路由路径追踪', icon: 'trace' },
  ];

  const FALLBACK_TARGETS = [
    { id: 'aliyun-dns', name: '阿里云公共 DNS', vendor: '阿里云', host: '223.5.5.5', group: 'dns', required: true, note: '国内解析节点' },
    { id: 'tencent-dns', name: '腾讯云公共 DNS', vendor: '腾讯云', host: '119.29.29.29', group: 'dns', required: true, note: 'DNSPod 节点' },
    { id: 'baidu', name: '百度', vendor: '百度', host: '183.2.172.177', group: 'domestic', required: true, note: '百度搜索节点' },
    { id: 'alibaba', name: '阿里云', vendor: '阿里巴巴', host: '183.60.205.33', group: 'domestic', required: true, note: '阿里云官网节点' },
    { id: 'tencent', name: '腾讯', vendor: '腾讯', host: '183.60.118.213', group: 'domestic', required: true, note: '腾讯官网节点' },
    { id: 'jd', name: '京东', vendor: '京东', host: '119.147.159.135', group: 'domestic', required: true, note: '京东商城节点' },
    { id: 'bilibili', name: '哔哩哔哩', vendor: '哔哩哔哩', host: '14.17.92.72', group: 'domestic', required: true, note: 'B 站华南节点' },
    { id: 'apple', name: '苹果', vendor: 'Apple', host: '14.215.172.32', group: 'domestic', required: true, note: 'Apple 中国节点' },
    { id: 'microsoft', name: '微软', vendor: 'Microsoft', host: '184.85.72.208', group: 'global', required: false, note: 'Microsoft 全球节点（可选国际线路）' },
    { id: 'cloudflare-dns', name: 'Cloudflare DNS', vendor: 'Cloudflare', host: '1.1.1.1', group: 'dns', required: false, note: '全球任播 DNS（可选国际线路）' },
    { id: 'github', name: 'GitHub', vendor: 'GitHub', host: '20.205.243.166', group: 'global', required: false, note: '国际线路（可能受网络环境影响）' },
    { id: 'google-dns', name: 'Google DNS', vendor: 'Google', host: '8.8.8.8', group: 'global', required: false, note: '国际线路（可能被阻断）' },
    { id: 'google', name: 'Google', vendor: 'Google', host: '142.250.190.14', group: 'global', required: false, note: '国际线路（可能被阻断）' },
    { id: 'cloudflare-web', name: 'Cloudflare', vendor: 'Cloudflare', host: '104.16.124.96', group: 'global', required: false, note: '国际 CDN 节点' },
  ];

  const DEFAULT_DISABLED_TARGETS = ['microsoft', 'cloudflare-dns', 'github', 'google-dns', 'google', 'cloudflare-web'];
  const UI_SCALES = [1, 1.2, 1.35];

  const ICON_ALIASES = {
    ping: 'packet',
    tcp: 'server',
    reset: 'refresh',
    wifi: 'wifi',
    'wifi-search': 'wifi-search',
    route: 'route',
    adapter: 'adapter',
  };

  const state = {
    meta: null,
    settings: null,
    snapshot: null,
    admin: false,
    currentView: 'dashboard',
    selectedIfIndex: null,
    lastReport: null,
    diagRunning: false,
    diagStartedAt: 0,
    diagTimer: null,
    diagStageDone: new Set(),
    connectivity: null,
    connectivityResults: [],
    connectivityRunning: false,
    connectivityStartedAt: 0,
    wifiScan: null,
    wifiQuery: '',
    selectedBand: '2.4G',
    wifiProfiles: [],
    wifiProfilesLoaded: false,
    wifiProfilesLoading: false,
    wifiProfilesError: null,
    wifiProfileDetails: {},
    wifiSelectedProfile: null,
    wifiPasswordRevealed: false,
    wifiCapabilities: null,
    wifiCapabilitiesError: null,
    monitorRunning: false,
    monitorSamples: [],
    speedRunning: false,
    history: [],
    selectedReport: null,
    selectedReportId: null,
    targets: [],
    disabledTargets: new Set(DEFAULT_DISABLED_TARGETS),
    repairLogs: [],
    modalActions: [],
    chartResizeBound: false,
    lastLineCheck: null,
  };

  /* ---------------------------------------------------------
     Formatting / escaping
     --------------------------------------------------------- */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function num(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function fmtMs(value, dash = '--') {
    if (value == null || !Number.isFinite(Number(value))) return dash;
    const n = Number(value);
    if (n > 0 && n < 1) return '<1';
    return String(Math.round(n));
  }

  function fmtPct(value, dash = '--') {
    if (value == null || !Number.isFinite(Number(value))) return dash;
    return `${Math.round(Number(value))}%`;
  }

  function fmtMbps(value, dash = '--') {
    if (value == null || !Number.isFinite(Number(value))) return dash;
    const n = Number(value);
    return n >= 100 ? n.toFixed(0) : n.toFixed(1);
  }

  function fmtDuration(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return '--';
    const n = Number(ms);
    if (n < 1000) return `${Math.round(n)} ms`;
    if (n < 60000) return `${(n / 1000).toFixed(1)} 秒`;
    const minutes = Math.floor(n / 60000);
    const seconds = Math.round((n % 60000) / 1000);
    return `${minutes} 分 ${seconds} 秒`;
  }

  function fmtDate(iso) {
    if (!iso) return '--';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function fmtTime(iso) {
    const date = iso ? new Date(iso) : new Date();
    if (Number.isNaN(date.getTime())) return '--:--:--';
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function fmtDateShort(iso) {
    if (!iso) return '--';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function fmtBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '--';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = n;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function scoreTone(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return 'fair';
    if (n >= 90) return 'excellent';
    if (n >= 75) return 'good';
    if (n >= 60) return 'fair';
    if (n >= 40) return 'poor';
    return 'critical';
  }

  function scoreLabel(score) {
    return { excellent: '优秀', good: '良好', fair: '一般', poor: '较差', critical: '严重' }[scoreTone(score)] || '待检测';
  }

  function severityTone(severity) {
    return severity === 'critical' ? 'critical' : severity === 'warning' ? 'warn' : 'info';
  }

  function severityLabel(severity) {
    return { critical: '严重', warning: '警告', info: '提示' }[severity] || '提示';
  }

  function statusLabel(status) {
    return { pass: '通过', warn: '注意', fail: '异常', info: '信息', skip: '跳过', running: '检查中' }[status] || status || '--';
  }

  function localizeReportText(value) {
    return String(value == null ? '' : value)
      .replace(/\bDisconnected\b/g, '未连接')
      .replace(/\bConnected\b/g, '已连接')
      .replace(/\bUp\b/g, '已启用')
      .replace(/\bStopped\b/g, '已停止')
      .replace(/\bRunning\b/g, '运行中')
      .replace(/\bManual\b/g, '手动')
      .replace(/\bAutomatic\b/g, '自动')
      .replace(/\bDHCP\b/g, '自动获取');
  }

  function windowsStateLabel(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '--';
    const key = raw.toLowerCase();
    const known = {
      up: '已启用',
      connected: '已连接',
      disconnected: '未连接',
      down: '未连接',
      stopped: '已停止',
      running: '运行中',
      manual: '手动',
      automatic: '自动',
      'automatic (delayed start)': '自动（延迟启动）',
      disabled: '已禁用',
      unknown: '未知',
    };
    if (known[key]) return known[key];
    if (/^up\b/i.test(raw)) return '已启用';
    if (/^connected/i.test(raw)) return '已连接';
    if (/^disconnected/i.test(raw)) return '未连接';
    if (/^stopped/i.test(raw)) return '已停止';
    if (/^running/i.test(raw)) return '运行中';
    if (/^manual/i.test(raw)) return '手动';
    return raw;
  }

  function iconName(name) {
    const value = String(name || 'info').replace(/[^a-z0-9-]/gi, '');
    return ICON_ALIASES[value] || value || 'info';
  }

  function icon(name, className = '') {
    return `<svg${className ? ` class="${esc(className)}"` : ''}><use href="#i-${esc(iconName(name))}"></use></svg>`;
  }

  function setIcon(element, name) {
    if (!element) return;
    const use = element.querySelector('use');
    if (use) use.setAttribute('href', `#i-${iconName(name)}`);
  }

  function debounce(fn, wait = 180) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  /* ---------------------------------------------------------
     Toast / modal / loading
     --------------------------------------------------------- */
  function toast(title, message = '', type = 'info', timeout = 3600) {
    const container = $('#toastContainer');
    if (!container) return;
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    const iconMap = { success: 'check', error: 'alert', warn: 'alert', info: 'info' };
    item.innerHTML = `
      <div class="toast-icon">${icon(iconMap[type] || 'info')}</div>
      <div class="toast-copy"><b>${esc(title)}</b>${message ? `<p>${esc(message)}</p>` : ''}</div>`;
    container.appendChild(item);
    const remove = () => {
      item.classList.add('leaving');
      setTimeout(() => item.remove(), 280);
    };
    item.addEventListener('click', remove);
    setTimeout(remove, Math.max(1800, timeout));
  }

  function showLoading(text = '正在处理…') {
    const overlay = $('#loadingOverlay');
    const label = $('#loadingText');
    if (label) label.textContent = text;
    if (overlay) overlay.hidden = false;
  }

  function hideLoading() {
    const overlay = $('#loadingOverlay');
    if (overlay) overlay.hidden = true;
  }

  function openModal({ kicker = '确认操作', title = '确认操作', body = '', actions = [] }) {
    const backdrop = $('#modalBackdrop');
    if (!backdrop) return;
    $('#modalKicker').textContent = kicker;
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    const actionBox = $('#modalActions');
    actionBox.innerHTML = '';
    state.modalActions = actions.length ? actions : [{ label: '关闭', style: 'ghost' }];
    state.modalActions.forEach((action, index) => {
      const button = document.createElement('button');
      button.className = `btn ${action.style || 'ghost'}`;
      button.textContent = action.label || '确定';
      button.dataset.modalAction = String(index);
      actionBox.appendChild(button);
    });
    backdrop.hidden = false;
    setTimeout(() => {
      const first = actionBox.querySelector('button');
      if (first) first.focus();
    }, 40);
  }

  function closeModal() {
    const backdrop = $('#modalBackdrop');
    if (backdrop) backdrop.hidden = true;
    state.modalActions = [];
  }

  function confirmDialog({ kicker = '确认操作', title, body, confirmLabel = '确认执行', danger = false, onConfirm }) {
    openModal({
      kicker,
      title,
      body,
      actions: [
        { label: '取消', style: 'ghost' },
        {
          label: confirmLabel,
          style: danger ? 'danger' : 'primary',
          onClick: () => {
            closeModal();
            if (typeof onConfirm === 'function') onConfirm();
          },
        },
      ],
    });
  }

  function showIssueList(issues, title = '全部发现项') {
    const list = Array.isArray(issues) ? issues : [];
    const body = list.length
      ? `<div class="issue-list" style="max-height:420px">${list.map(renderIssue).join('')}</div>`
      : '<p>当前没有需要处理的问题。</p>';
    openModal({ kicker: '检查发现', title, body, actions: [{ label: '关闭', style: 'ghost' }] });
  }

  function renderIssue(issue) {
    const tone = severityTone(issue.severity);
    return `
      <div class="issue-item ${tone}">
        <span class="issue-sev"></span>
        <div class="issue-copy">
          <b>${esc(issue.title || '网络问题')}</b>
          <p>${esc(issue.detail || '')}</p>
          ${issue.fix ? `<div class="issue-fix">建议：${esc(issue.fix)}</div>` : ''}
        </div>
      </div>`;
  }

  /* ---------------------------------------------------------
     Theme / settings
     --------------------------------------------------------- */
  function applyTheme(theme, persist = false) {
    const value = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = value;
    const themeBtn = $('#themeBtn');
    if (themeBtn) setIcon(themeBtn, value === 'dark' ? 'sun' : 'moon');
    const toggle = $('#themeToggle');
    if (toggle) toggle.checked = value === 'light';
    if (state.settings) state.settings.theme = value;
    if (persist) saveSettings({ theme: value });
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next, true);
  }

  function normalizeUiScale(value) {
    const scale = Number(value);
    return UI_SCALES.includes(scale) ? scale : 1.2;
  }

  function renderUiScaleControl(value) {
    const scale = normalizeUiScale(value);
    $$('#uiScaleControl [data-ui-scale]').forEach((button) => {
      const active = Number(button.dataset.uiScale) === scale;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  async function applyUiScale(value, persist = false) {
    const scale = normalizeUiScale(value);
    if (state.settings) state.settings.uiScale = scale;
    renderUiScaleControl(scale);
    if (window.wifi && typeof window.wifi.setUiScale === 'function') {
      try {
        await window.wifi.setUiScale(scale);
      } catch {
        // Keep the current scale if the main process cannot apply it.
      }
    }
    if (persist) await saveSettings({ uiScale: scale });
  }

  async function saveSettings(patch) {
    if (!window.wifi || typeof window.wifi.updateSettings !== 'function') return;
    try {
      const result = await window.wifi.updateSettings(patch);
      if (result && result.ok && result.settings) {
        state.settings = result.settings;
      } else if (state.settings) {
        state.settings = { ...state.settings, ...patch };
      }
    } catch (error) {
      if (state.settings) state.settings = { ...state.settings, ...patch };
    }
  }

  /* ---------------------------------------------------------
     Navigation
     --------------------------------------------------------- */
  function switchView(view, options = {}) {
    const name = VIEW_LABELS[view] ? view : 'dashboard';
    state.currentView = name;
    document.body.dataset.view = name;
    $$('.nav-item[data-view]').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === name);
    });
    $$('.view').forEach((section) => {
      section.classList.toggle('active', section.id === `view-${name}`);
    });
    const crumb = $('#crumbCurrent');
    if (crumb) crumb.textContent = VIEW_LABELS[name];
    const content = $('#content');
    if (content && options.scroll !== false) content.scrollTop = 0;
    if (name === 'reports') loadHistory();
    if (name === 'wifi') {
      renderWifi();
      if (!state.wifiProfilesLoaded) loadWifiProfiles(false);
    }
    if (name === 'channels') renderChannels();
    if (name === 'stability') renderCharts();
    if (name === 'connectivity') renderConnectivityTargets();
    saveSettings({ lastView: name });
  }

  function openPreferences() {
    switchView('reports', { scroll: false });
    const reveal = () => {
      const content = $('#content');
      const card = $('.settings-card');
      if (!content || !card) return;
      const top = card.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop - 18;
      content.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      card.classList.add('is-highlighted');
      window.setTimeout(() => card.classList.remove('is-highlighted'), 2200);
    };
    requestAnimationFrame(() => requestAnimationFrame(reveal));
    window.setTimeout(reveal, 450);
  }

  /* ---------------------------------------------------------
     Health helpers
     --------------------------------------------------------- */
  function estimateHealth(snapshot) {
    if (!snapshot) return { score: null, issues: [], label: '等待检测', summary: '正在读取网络配置…' };
    const issues = Array.isArray(snapshot.issues) ? snapshot.issues : [];
    let score = 100;
    for (const issue of issues) {
      if (issue.severity === 'critical') score -= 18;
      else if (issue.severity === 'warning') score -= 7;
      else score -= 2;
    }
    if (!snapshot.active || !snapshot.active.adapter) score = Math.min(score, 45);
    score = clamp(Math.round(score), 20, 100);
    const label = scoreLabel(score);
    return {
      score,
      issues,
      label,
      summary: issues.length
        ? `当前配置发现 ${issues.length} 个待关注项。运行全面体检可获得逐层诊断与修复建议。`
        : '当前网络配置未发现明显异常。运行全面体检可进一步验证 DNS、厂商节点与稳定性。',
    };
  }

  function currentIssues() {
    if (state.lastReport && Array.isArray(state.lastReport.issues)) return state.lastReport.issues;
    if (state.snapshot && Array.isArray(state.snapshot.issues)) return state.snapshot.issues;
    return [];
  }

  function updateScoreRing(score, options = {}) {
    const value = score == null ? null : clamp(Math.round(Number(score)), 0, 100);
    const arc = $('#scoreArc');
    const heroScore = $('#heroScore');
    const heroGrade = $('#heroGrade');
    const heroSummary = $('#heroSummary');
    const pill = $('#scorePill');
    const tagIssues = $('#tagIssues');
    const tagChecked = $('#tagChecked');
    if (value == null) {
      if (arc) arc.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
      if (heroScore) heroScore.textContent = '--';
      if (heroGrade) heroGrade.textContent = options.label || '等待检测';
      if (heroSummary) heroSummary.textContent = options.summary || '';
      if (pill) {
        pill.textContent = options.pill || '待检测';
        pill.className = 'mini-pill';
      }
      if (tagIssues) tagIssues.textContent = `${options.issueCount == null ? 0 : options.issueCount} 个风险`;
      if (tagChecked) tagChecked.textContent = options.checkedText || '尚未体检';
      return;
    }
    const tone = scoreTone(value);
    const color = TONE_COLORS[tone];
    if (arc) {
      arc.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - value / 100));
      arc.style.stroke = color;
    }
    if (heroScore) {
      heroScore.textContent = String(value);
      heroScore.style.color = color;
    }
    if (heroGrade) heroGrade.textContent = options.label || scoreLabel(value);
    if (heroSummary) heroSummary.textContent = options.summary || '';
    if (pill) {
      pill.textContent = options.pill || scoreLabel(value);
      pill.className = `mini-pill ${tone === 'excellent' ? 'good' : tone === 'good' ? 'live' : tone === 'fair' ? 'warn' : 'bad'}`;
    }
    if (tagIssues) tagIssues.textContent = `${options.issueCount == null ? 0 : options.issueCount} 个风险`;
    if (tagChecked) tagChecked.textContent = options.checkedText || '尚未体检';
  }

  function adapterLabel(adapter) {
    if (!adapter) return '未知网卡';
    return adapter.kindLabel || { wifi: '无线', ethernet: '有线', virtual: '虚拟 / VPN', bluetooth: '蓝牙' }[adapter.type] || '其他';
  }

  function activeAdapter() {
    return state.snapshot && state.snapshot.active ? state.snapshot.active.adapter : null;
  }

  function primaryIp(adapter) {
    return adapter && adapter.primaryIp ? adapter.primaryIp.address : '';
  }

  function gatewayOf(adapter) {
    return adapter && Array.isArray(adapter.gateway) && adapter.gateway.length ? adapter.gateway[0] : '';
  }

  function dnsOf(adapter) {
    return adapter && Array.isArray(adapter.dns) ? adapter.dns.filter(Boolean) : [];
  }

  /* ---------------------------------------------------------
     Data loading
     --------------------------------------------------------- */
  async function loadMeta() {
    if (!window.wifi || typeof window.wifi.meta !== 'function') {
      state.meta = { pingTargets: FALLBACK_TARGETS, stageDefs: FALLBACK_STAGES, repairActions: {}, admin: false };
      return;
    }
    try {
      const meta = await window.wifi.meta();
      state.meta = meta && meta.ok ? meta : { pingTargets: FALLBACK_TARGETS, stageDefs: FALLBACK_STAGES, repairActions: {} };
    } catch (error) {
      state.meta = { pingTargets: FALLBACK_TARGETS, stageDefs: FALLBACK_STAGES, repairActions: {} };
      toast('无法读取应用元数据', String(error.message || error), 'warn');
    }
    state.admin = Boolean(state.meta.admin);
    state.targets = Array.isArray(state.meta.pingTargets) && state.meta.pingTargets.length
      ? state.meta.pingTargets.slice()
      : FALLBACK_TARGETS.slice();
  }

  async function loadSettings() {
    if (!window.wifi || typeof window.wifi.settings !== 'function') {
      state.settings = { theme: 'light', disabledTargetIds: DEFAULT_DISABLED_TARGETS, customTargets: [], uiScale: 1.2 };
      return;
    }
    try {
      const result = await window.wifi.settings();
      state.settings = result && result.ok ? result.settings : {};
    } catch (error) {
      state.settings = {};
    }
    state.settings = state.settings || {};
    state.selectedIfIndex = state.settings.selectedIfIndex != null ? Number(state.settings.selectedIfIndex) : null;
    const disabled = Array.isArray(state.settings.disabledTargetIds) ? state.settings.disabledTargetIds : DEFAULT_DISABLED_TARGETS;
    state.disabledTargets = new Set(disabled.map(String));
    const custom = Array.isArray(state.settings.customTargets) ? state.settings.customTargets : [];
    for (const target of custom) {
      if (!target || !target.host) continue;
      state.targets.push({
        id: String(target.id || `custom_${target.host}`),
        name: String(target.name || target.host),
        vendor: '自定义',
        host: String(target.host),
        group: 'custom',
        required: true,
        note: '用户自定义节点',
        custom: true,
      });
    }
    applyTheme(state.settings.theme || 'light', false);
    await applyUiScale(state.settings.uiScale, false);
    const autoSave = $('#autoSaveToggle');
    if (autoSave) autoSave.checked = state.settings.autoSaveHistory !== false;
    const upload = $('#uploadToggle');
    if (upload) upload.checked = Boolean(state.settings.includeUploadInSpeedTest);
    const upload2 = $('#includeUploadToggle');
    if (upload2) upload2.checked = Boolean(state.settings.includeUploadInSpeedTest);
  }

  async function loadSnapshot(force = false) {
    if (!window.wifi || typeof window.wifi.snapshot !== 'function') return null;
    try {
      const result = await window.wifi.snapshot({ force: Boolean(force) });
      if (result && result.ok && result.snapshot) {
        state.snapshot = result.snapshot;
        state.admin = Boolean(state.snapshot.admin || state.admin);
        return state.snapshot;
      }
      if (result && result.error) toast('读取网络配置失败', result.error, 'error');
    } catch (error) {
      toast('读取网络配置失败', String(error.message || error), 'error');
    }
    return null;
  }

  async function refreshSnapshot(force = true, silent = false) {
    const snapshot = await loadSnapshot(force);
    if (!snapshot) return;
    renderAll();
    if (!silent) toast('网络状态已刷新', `快照时间 ${fmtTime(snapshot.capturedAt)}`, 'success', 2200);
  }

  /* ---------------------------------------------------------
     Charts
     --------------------------------------------------------- */
  function setupCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function drawLineChart(canvas, series, options = {}) {
    const prepared = setupCanvas(canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    const padLeft = 34;
    const padRight = 8;
    const padTop = 12;
    const padBottom = 20;
    const plotW = Math.max(1, width - padLeft - padRight);
    const plotH = Math.max(1, height - padTop - padBottom);
    const validValues = [];
    for (const item of series) {
      for (const point of item.data || []) {
        if (point && Number.isFinite(Number(point.y))) validValues.push(Number(point.y));
      }
    }
    let maxY = options.maxY || (validValues.length ? Math.max(...validValues) : 100);
    maxY = Math.max(20, Math.ceil(maxY / 20) * 20);
    if (options.maxY && maxY > options.maxY) maxY = options.maxY;
    const midY = maxY / 2;

    ctx.font = '10px "Cascadia Code", Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i += 1) {
      const y = padTop + (plotH / 4) * i;
      const value = Math.round(maxY - (maxY / 4) * i);
      ctx.strokeStyle = 'rgba(120, 128, 122, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y + 0.5);
      ctx.lineTo(width - padRight, y + 0.5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120, 128, 122, 0.95)';
      ctx.fillText(String(value), padLeft - 7, y);
    }

    const count = Math.max(2, options.count || (series[0] && series[0].data ? series[0].data.length : 0));
    const xFor = (index) => padLeft + (plotW * index) / Math.max(1, count - 1);
    const yFor = (value) => padTop + plotH - (clamp(Number(value), 0, maxY) / maxY) * plotH;

    for (const item of series) {
      const points = (item.data || []).map((point, index) => {
        if (!point || !Number.isFinite(Number(point.y))) return null;
        return { x: xFor(index), y: yFor(point.y) };
      });
      if (!points.some(Boolean)) continue;
      const color = item.color || '#6f9487';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      let started = false;
      points.forEach((point) => {
        if (!point) {
          started = false;
          return;
        }
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
      const last = [...points].reverse().find(Boolean);
      if (last) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(last.x, last.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (options.emptyText && !validValues.length) {
      ctx.fillStyle = 'rgba(120, 128, 122, 0.85)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '11px "Segoe UI", "Microsoft YaHei UI", sans-serif';
      ctx.fillText(options.emptyText, padLeft + plotW / 2, padTop + plotH / 2);
    }
    if (options.footerText) {
      ctx.fillStyle = 'rgba(120, 128, 122, 0.75)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.font = '9px "Segoe UI", "Microsoft YaHei UI", sans-serif';
      ctx.fillText(options.footerText, padLeft, height - 2);
    }
  }

  function monitorSeries() {
    const samples = state.monitorSamples;
    return [
      {
        label: '互联网',
        color: '#6f9487',
        data: samples.map((sample) => ({
          y: sample.internet && sample.internet.success ? sample.internet.latency : null,
        })),
      },
      {
        label: '网关',
        color: '#8d8a9e',
        data: samples.map((sample) => ({
          y: sample.gateway && sample.gateway.success ? sample.gateway.latency : null,
        })),
      },
    ];
  }

  function renderCharts() {
    const count = Math.max(2, state.monitorSamples.length);
    const series = monitorSeries();
    const live = $('#liveChart');
    const liveEmpty = $('#liveChartEmpty');
    drawLineChart(live, series, { count, emptyText: '正在采集实时延迟数据…' });
    if (liveEmpty) liveEmpty.classList.toggle('hidden', state.monitorSamples.length > 0);
    const stability = $('#stabilityChart');
    const stabilityEmpty = $('#stabilityChartEmpty');
    drawLineChart(stability, series, {
      count,
      emptyText: '正在采集实时质量数据…',
      footerText: state.monitorSamples.length ? `最近 ${state.monitorSamples.length} 次采样` : '',
    });
    if (stabilityEmpty) stabilityEmpty.classList.toggle('hidden', state.monitorSamples.length > 0);
    const last = state.monitorSamples[state.monitorSamples.length - 1];
    const lastUpdate = $('#chartLastUpdate');
    if (lastUpdate) lastUpdate.textContent = last ? `最后采样 ${fmtTime(last.t)}` : '--';
    const samples = $('#qualitySamples');
    if (samples) samples.textContent = `${state.monitorSamples.length} 个样本`;
  }

  /* ---------------------------------------------------------
     Meta / admin / system renderers
     --------------------------------------------------------- */
  function renderAdmin() {
    const admin = Boolean(state.admin);
    const chip = $('#adminChip');
    if (chip) {
      chip.classList.toggle('is-admin', admin);
      const label = chip.querySelector('span');
      if (label) label.textContent = admin ? '管理员权限' : '普通权限';
      chip.title = admin ? '当前以管理员权限运行' : '当前为普通权限，部分修复操作不可用';
    }
    const banner = $('#adminBanner');
    if (banner) banner.classList.toggle('is-admin', admin);
    const title = $('#adminBannerTitle');
    if (title) title.textContent = admin ? '管理员权限模式' : '普通权限模式';
    const text = $('#adminBannerText');
    if (text) {
      text.textContent = admin
        ? '已获得管理员权限，可以修改网卡、DNS、Winsock 等系统网络配置。'
        : '安全操作可直接执行；修改网卡、DNS、Winsock 等操作需要管理员权限。';
    }
    const badges = $('#adminBannerBadges');
    if (badges) {
      badges.innerHTML = admin
        ? '<span class="tag"><svg><use href="#i-shield"></use></svg>完整修复能力</span><span class="tag"><svg><use href="#i-check"></use></svg>已授权</span>'
        : '<span class="tag"><svg><use href="#i-lock"></use></svg>受限模式</span><span class="tag">可安全刷新 DNS / 代理</span>';
    }
    const relaunch = $('#relaunchAdminBtn');
    if (relaunch) {
      relaunch.style.display = admin ? 'none' : '';
    }
    const relaunchMain = $('#relaunchAdminMainBtn');
    if (relaunchMain) {
      relaunchMain.disabled = admin;
      relaunchMain.innerHTML = admin ? `${icon('check')}已是管理员` : `${icon('shield')}管理员重启`;
    }
    const portable = $('#portableLabel');
    if (portable) {
      const meta = state.meta || {};
      portable.textContent = meta.portable ? 'Portable EXE' : meta.packaged ? 'Windows 安装版' : 'Windows 开发版';
    }
    const dataPath = $('#dataPath');
    if (dataPath) dataPath.textContent = (state.meta && state.meta.dataDir) || '--';
    const runtime = $('#aboutRuntime');
    if (runtime) {
      const meta = state.meta || {};
      runtime.textContent = `Electron ${meta.electron || '--'} · Chromium ${meta.chrome || '--'} · Node ${meta.node || '--'}`;
    }
  }

  function renderSystemInfo() {
    const box = $('#systemInfo');
    if (!box) return;
    const snapshot = state.snapshot;
    if (!snapshot) {
      box.innerHTML = '<div class="empty-state small"><p>正在读取系统信息…</p></div>';
      return;
    }
    const system = snapshot.system || {};
    const adapter = activeAdapter();
    const memory = system.memoryBytes ? `${(Number(system.memoryBytes) / 1024 / 1024 / 1024).toFixed(1)} GB` : '--';
    const items = [
      ['主机名', system.hostname || '--'],
      ['操作系统', `${system.caption || ''} ${system.build ? `Build ${system.build}` : ''}`.trim() || '--'],
      ['处理器', system.cpu || '--'],
      ['内存', memory],
      ['当前通道', adapter ? `${adapterLabel(adapter)} · ${adapter.name}` : '无可用通道'],
      ['IPv4 地址', primaryIp(adapter) || '--'],
      ['默认网关', gatewayOf(adapter) || '--'],
      ['DNS', dnsOf(adapter).join(' / ') || '--'],
      ['WLAN 服务', snapshot.wlanService ? `${windowsStateLabel(snapshot.wlanService.status)} · ${windowsStateLabel(snapshot.wlanService.startType)}` : '未检测到'],
      ['Hosts 条目', system.hostsEntries == null ? '--' : `${system.hostsEntries} 条`],
      ['上次启动', system.lastBoot || '--'],
      ['应用版本', `WiFiMedic Pro ${(state.meta && state.meta.version) || '1.0.0'}`],
    ];
    box.innerHTML = items
      .map(([label, value]) => `<div><span>${esc(label)}</span><b title="${esc(value)}">${esc(value)}</b></div>`)
      .join('');
  }

  function renderStageList() {
    const list = $('#stageList');
    if (!list) return;
    const defs = (state.meta && Array.isArray(state.meta.stageDefs) && state.meta.stageDefs.length)
      ? state.meta.stageDefs
      : FALLBACK_STAGES;
    list.innerHTML = defs
      .map(
        (stage, index) => `
        <div class="stage-item" data-stage="${esc(stage.id)}">
          <div class="stage-index">${String(index + 1).padStart(2, '0')}</div>
          ${icon(stage.icon, 'stage-icon')}
          <div class="stage-copy"><b>${esc(stage.label)}</b><small>等待检查</small></div>
          <div class="stage-status">${icon('clock')}</div>
        </div>`,
      )
      .join('');
    const pill = $('#stageCountPill');
    if (pill) pill.textContent = `0 / ${defs.length}`;
  }

  function setStageState(id, status, summary) {
    const item = $(`.stage-item[data-stage="${String(id).replace(/"/g, '\\"')}"]`);
    if (!item) return;
    item.className = `stage-item ${status || 'running'}`;
    const copy = item.querySelector('.stage-copy small');
    if (copy) copy.textContent = localizeReportText(summary) || (status === 'running' ? '正在检查…' : '');
    const statusBox = item.querySelector('.stage-status');
    if (statusBox) {
      if (status === 'running') statusBox.innerHTML = '';
      else if (status === 'pass') statusBox.innerHTML = icon('check');
      else if (status === 'warn') statusBox.innerHTML = icon('alert');
      else if (status === 'fail') statusBox.innerHTML = icon('x');
      else if (status === 'skip') statusBox.innerHTML = icon('chevron');
      else statusBox.innerHTML = icon('info');
    }
  }

  function resetStageList() {
    $$('.stage-item').forEach((item) => {
      item.className = 'stage-item';
      const copy = item.querySelector('.stage-copy small');
      if (copy) copy.textContent = '等待检查';
      const statusBox = item.querySelector('.stage-status');
      if (statusBox) statusBox.innerHTML = icon('clock');
    });
    state.diagStageDone = new Set();
    const pill = $('#stageCountPill');
    if (pill) {
      const total = $$('.stage-item').length || 14;
      pill.textContent = `0 / ${total}`;
    }
  }

  /* ---------------------------------------------------------
     Repair cards
     --------------------------------------------------------- */
  const RISK_LABELS = { safe: '安全', caution: '谨慎', danger: '高危' };

  function repairActions() {
    const source = state.meta && state.meta.repairActions ? state.meta.repairActions : {};
    return Object.values(source).filter((action) => action && action.id);
  }

  function renderRepairCards() {
    const actions = repairActions();
    const groups = { safe: [], caution: [], danger: [] };
    for (const action of actions) {
      const risk = groups[action.risk] ? action.risk : 'caution';
      groups[risk].push(action);
    }
    const renderGroup = (boxId, list) => {
      const box = $(boxId);
      if (!box) return;
      if (!list.length) {
        box.innerHTML = '<div class="empty-state small"><p>没有可用的操作。</p></div>';
        return;
      }
      box.innerHTML = list
        .map((action) => {
          const adminNeeded = Boolean(action.admin);
          const restricted = adminNeeded && !state.admin;
          return `
            <div class="repair-card ${esc(action.risk || 'caution')}">
              <div class="repair-head">
                <div class="repair-icon">${icon(action.icon || 'wrench')}</div>
                <div class="repair-title"><b>${esc(action.name)}</b><small>${restricted ? '需要管理员权限' : adminNeeded ? '将修改系统网络设置' : '当前权限可直接执行'}</small></div>
                <span class="risk-badge ${esc(action.risk || 'caution')}">${esc(RISK_LABELS[action.risk] || '谨慎')}</span>
              </div>
              <p>${esc(action.description || '')}</p>
              <div class="repair-foot">
                <span class="repair-cmd" title="${esc(action.command || '')}">${esc(action.command || '')}</span>
                <button class="repair-btn${restricted ? ' requires-admin' : ''}" type="button" data-repair-run="${esc(action.id)}">${icon(restricted ? 'shield' : 'play')}${restricted ? '管理员执行' : '立即执行'}</button>
              </div>
            </div>`;
        })
        .join('');
    };
    renderGroup('#safeRepairs', groups.safe);
    renderGroup('#advancedRepairs', groups.caution);
    renderGroup('#dangerRepairs', groups.danger);
  }

  /* ---------------------------------------------------------
     Targets
     --------------------------------------------------------- */
  function targetEnabled(target) {
    return !state.disabledTargets.has(String(target.id));
  }

  function enabledTargets() {
    return state.targets.filter(targetEnabled);
  }

  function renderConnectivityTargets() {
    const groupsBox = $('#targetGroups');
    if (!groupsBox) return;
    const grouped = new Map();
    for (const target of state.targets) {
      const group = GROUP_LABELS[target.group] ? target.group : 'custom';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(target);
    }
    const ordered = [...GROUP_ORDER.filter((group) => grouped.has(group)), ...grouped.keys()].filter(
      (group, index, array) => array.indexOf(group) === index,
    );
    groupsBox.innerHTML = ordered
      .map((group) => {
        const items = grouped.get(group);
        return `
          <div class="target-group">
            <div class="target-group-head">${esc(GROUP_LABELS[group] || group)}<span style="margin-left:auto;font-weight:400">${items.length} 个</span></div>
            <div class="target-grid">
              ${items
                .map((target) => {
                  const checked = targetEnabled(target);
                  const isCustom = Boolean(target.custom) || target.group === 'custom';
                  return `
                    <div class="target-item${checked ? ' checked' : ' disabled'}${isCustom ? ' custom' : ''}" data-target-id="${esc(target.id)}" role="button" tabindex="0">
                      <div class="target-check${checked ? ' checked' : ''}">${icon('check')}</div>
                      <div class="target-main"><b>${esc(target.name)}</b><small>${esc(target.vendor || target.note || '')}</small></div>
                      <div class="target-ip">${esc(target.host)}</div>
                      ${target.required === false ? '<span class="target-tag">可选</span>' : '<span class="target-tag required">必测</span>'}
                      ${isCustom ? `<button class="target-delete" data-target-delete="${esc(target.id)}" title="删除自定义节点">${icon('trash')}</button>` : ''}
                    </div>`;
                })
                .join('')}
            </div>
          </div>`;
      })
      .join('');
    const gatewayIp = gatewayOf(activeAdapter());
    const gatewayEl = $('#gatewayTargetIp');
    if (gatewayEl) gatewayEl.textContent = gatewayIp || '无网关';
    const gatewayBox = $('#gatewayTarget');
    if (gatewayBox) gatewayBox.classList.toggle('disabled', !gatewayIp);
    const enabled = enabledTargets().length;
    const enabledEl = $('#connEnabled');
    if (enabledEl) enabledEl.textContent = String(enabled + (gatewayIp ? 1 : 0));
    const totalEl = $('#connStatTotal');
    if (totalEl && !state.connectivity) totalEl.textContent = String(enabled + (gatewayIp ? 1 : 0));
    if (!state.connectivity) {
      const reach = $('#connStatReachable');
      const avg = $('#connStatAvg');
      const loss = $('#connStatLoss');
      const duration = $('#connStatDuration');
      if (reach) reach.textContent = '--';
      if (avg) avg.textContent = '--';
      if (loss) loss.textContent = '--';
      if (duration) duration.textContent = '--';
      const reachable = $('#connReachable');
      if (reachable) reachable.textContent = '--';
      const connAvg = $('#connAvg');
      if (connAvg) connAvg.textContent = '--';
    }
  }

  function toggleTarget(id) {
    const target = state.targets.find((item) => String(item.id) === String(id));
    if (!target) return;
    if (state.disabledTargets.has(String(id))) state.disabledTargets.delete(String(id));
    else state.disabledTargets.add(String(id));
    saveSettings({ disabledTargetIds: [...state.disabledTargets] });
    renderConnectivityTargets();
  }

  function addCustomTarget() {
    openModal({
      kicker: '自定义节点',
      title: '添加自定义 Ping 节点',
      body: `
        <p>输入一个可解析的域名或 IPv4 地址，将作为必测节点加入一键连通测试。</p>
        <div class="form-row"><label for="customTargetName">显示名称</label><input id="customTargetName" maxlength="40" placeholder="例如：公司服务器"></div>
        <div class="form-row"><label for="customTargetHost">域名或 IP</label><input id="customTargetHost" maxlength="253" placeholder="例如：192.168.1.10 或 example.com"><div class="form-hint">仅支持 ICMP Ping 可达的 IPv4 / 域名，不需要填写 http://。</div></div>`,
      actions: [
        { label: '取消', style: 'ghost' },
        {
          label: '添加节点',
          style: 'primary',
          onClick: () => {
            const name = ($('#customTargetName') || {}).value || '';
            const host = String((($('#customTargetHost') || {}).value) || '').trim();
            if (!host || !/^(?:\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/.test(host)) {
              toast('地址格式不正确', '请输入有效的 IPv4 地址或域名。', 'warn');
              return;
            }
            const exists = state.targets.some((target) => target.host.toLowerCase() === host.toLowerCase());
            if (exists) {
              toast('节点已存在', '该地址已经在测试目标中。', 'warn');
              return;
            }
            const custom = {
              id: `custom_${Date.now().toString(36)}`,
              name: String(name || host).slice(0, 40),
              vendor: '自定义',
              host,
              group: 'custom',
              required: true,
              note: '用户自定义节点',
              custom: true,
            };
            state.targets.push(custom);
            const settingsCustom = state.targets
              .filter((target) => target.custom)
              .map((target) => ({ id: target.id, name: target.name, host: target.host }));
            saveSettings({ customTargets: settingsCustom });
            renderConnectivityTargets();
            toast('已添加自定义节点', `${custom.name} · ${custom.host}`, 'success');
            closeModal();
          },
        },
      ],
    });
  }

  function removeCustomTarget(id) {
    const target = state.targets.find((item) => String(item.id) === String(id));
    if (!target) return;
    confirmDialog({
      kicker: '移除节点',
      title: '删除自定义节点？',
      body: `<p>将从测试目标中移除 <b>${esc(target.name)}</b>（${esc(target.host)}），不会影响系统网络设置。</p>`,
      confirmLabel: '删除',
      danger: true,
      onConfirm: () => {
        state.targets = state.targets.filter((item) => String(item.id) !== String(id));
        state.disabledTargets.delete(String(id));
        const settingsCustom = state.targets
          .filter((item) => item.custom)
          .map((item) => ({ id: item.id, name: item.name, host: item.host }));
        saveSettings({ customTargets: settingsCustom, disabledTargetIds: [...state.disabledTargets] });
        renderConnectivityTargets();
        toast('已删除节点', target.name, 'success');
      },
    });
  }

  function resetTargets() {
    confirmDialog({
      kicker: '恢复默认',
      title: '恢复默认测试目标？',
      body: '<p>将恢复国内厂商与公共 DNS 为启用状态，关闭国际节点，并移除所有自定义节点。此操作不会修改系统网络配置。</p>',
      confirmLabel: '恢复默认',
      onConfirm: () => {
        state.disabledTargets = new Set(DEFAULT_DISABLED_TARGETS);
        state.targets = state.targets.filter((target) => !target.custom);
        saveSettings({ disabledTargetIds: [...state.disabledTargets], customTargets: [] });
        renderConnectivityTargets();
        toast('已恢复默认目标', '国际节点默认关闭，可在需要时手动开启。', 'success');
      },
    });
  }

  function selectRequiredTargets() {
    const disabled = state.targets.filter((target) => target.required === false).map((target) => String(target.id));
    state.disabledTargets = new Set(disabled);
    saveSettings({ disabledTargetIds: disabled });
    renderConnectivityTargets();
    toast('已切换为仅必测', '只测试国内厂商、公共 DNS 与默认网关。', 'success', 2400);
  }

  function selectAllTargets() {
    state.disabledTargets = new Set();
    saveSettings({ disabledTargetIds: [] });
    renderConnectivityTargets();
    toast('已启用全部节点', '国际节点失败也会影响连通性判定。', 'warn', 3000);
  }

  /* ---------------------------------------------------------
     Appends below
     --------------------------------------------------------- */
  /* ---------------------------------------------------------
     Dashboard
     --------------------------------------------------------- */
  function renderDashboard() {
    const snapshot = state.snapshot;
    const timestamp = $('#dashboardTimestamp');
    if (timestamp) timestamp.textContent = snapshot ? `快照 ${fmtTime(snapshot.capturedAt)}` : '等待读取';
    const adapter = activeAdapter();
    const report = state.lastReport;
    const estimated = estimateHealth(snapshot);

    if (report) {
      updateScoreRing(report.score, {
        label: report.verdict ? report.verdict.label : scoreLabel(report.score),
        summary: (report.verdict && report.verdict.summary) || report.summary || '',
        issueCount: (report.issues || []).length,
        checkedText: `最近体检 ${fmtDateShort(report.finishedAt)}`,
        pill: report.verdict ? report.verdict.label : scoreLabel(report.score),
      });
    } else {
      updateScoreRing(estimated.score, {
        label: estimated.label,
        summary: estimated.summary,
        issueCount: estimated.issues.length,
        checkedText: '尚未体检',
        pill: estimated.score == null ? '待检测' : '配置评估',
      });
    }

    const channelType = $('#channelType');
    const channelName = $('#channelName');
    const channelSub = $('#channelSub');
    const channelIcon = $('#channelIcon');
    if (adapter) {
      if (channelType) channelType.textContent = `${adapterLabel(adapter)} · 当前主用通道`;
      if (channelName) channelName.textContent = adapter.name;
      if (channelSub) {
        channelSub.textContent = [adapter.description, windowsStateLabel(adapter.status), adapter.linkSpeed].filter(Boolean).join(' · ') || '链路已连接';
      }
      setIcon(channelIcon, adapter.kindIcon || (adapter.type === 'wifi' ? 'wifi' : 'ethernet'));
    } else {
      if (channelType) channelType.textContent = snapshot ? '未识别到主用通道' : '正在识别主用通道';
      if (channelName) channelName.textContent = snapshot ? '没有可用的默认上网通道' : '--';
      if (channelSub) channelSub.textContent = snapshot ? '请检查网线、Wi-Fi 连接或 DHCP 配置。' : '正在读取网卡与路由…';
      setIcon(channelIcon, 'alert');
    }

    const topoPcIp = $('#topoPcIp');
    const topoGateway = $('#topoGateway');
    const topoDns = $('#topoDns');
    const topoInternet = $('#topoInternet');
    if (topoPcIp) topoPcIp.textContent = primaryIp(adapter) || '--';
    if (topoGateway) topoGateway.textContent = gatewayOf(adapter) || '--';
    if (topoDns) topoDns.textContent = dnsOf(adapter)[0] || '--';
    if (topoInternet) {
      const conn = state.connectivity;
      if (!conn) topoInternet.textContent = '待测试';
      else if (conn.results && conn.results.length && conn.results.every((item) => item.success)) topoInternet.textContent = '全部可达';
      else topoInternet.textContent = '部分不可达';
    }

    const channelSpeed = $('#channelSpeed');
    const channelDhcp = $('#channelDhcp');
    const channelMetric = $('#channelMetric');
    const channelProxy = $('#channelProxy');
    if (channelSpeed) channelSpeed.textContent = (adapter && adapter.linkSpeed) || '--';
    if (channelDhcp) channelDhcp.textContent = adapter ? (adapter.dhcp ? '自动获取' : '静态配置') : '--';
    if (channelMetric) channelMetric.textContent = adapter && adapter.interfaceMetric != null ? String(adapter.interfaceMetric) : '--';
    if (channelProxy) {
      const proxy = snapshot && snapshot.proxy ? snapshot.proxy : {};
      const virtualUp = snapshot && Array.isArray(snapshot.virtualAdapters)
        ? snapshot.virtualAdapters.filter((item) => item.up).length
        : 0;
      channelProxy.textContent = proxy.enabled ? '代理开启' : virtualUp ? `VPN × ${virtualUp}` : '未启用';
    }

    const wifiCurrent = snapshot && snapshot.wifi ? snapshot.wifi.current : null;
    const signalEl = $('#kpiSignal');
    const signalHint = $('#kpiSignalHint');
    if (signalEl) signalEl.textContent = wifiCurrent && wifiCurrent.signal != null
      ? `${wifiCurrent.signal}%`
      : snapshot && snapshot.wifi && snapshot.wifi.available
        ? '未使用'
        : '未检测到';
    if (signalHint) {
      if (wifiCurrent) signalHint.textContent = `${wifiCurrent.band || '无线'} · 信道 ${wifiCurrent.channel || '--'}`;
      else if (snapshot && snapshot.wifi && snapshot.wifi.available) signalHint.textContent = '无线网卡未连接';
      else if (adapter && adapter.type === 'ethernet') signalHint.textContent = '当前使用有线通道';
      else signalHint.textContent = '未检测到无线网卡';
    }

    renderDashboardIssues();
    renderServiceMatrix();
    renderWifiSnapshot();
    renderMonitorMetrics();
    renderCharts();
    renderSideStatus();
  }

  function renderSideStatus() {
    const adapter = activeAdapter();
    const channel = $('#sideChannel');
    if (channel) channel.textContent = adapter ? adapterLabel(adapter) : '--';
    const last = state.monitorSamples[state.monitorSamples.length - 1];
    const latency = $('#sideLatency');
    if (latency) {
      latency.textContent = last && last.internet && last.internet.success && last.internet.latency != null
        ? `${fmtMs(last.internet.latency)} ms`
        : '--';
    }
    const statusText = $('#sideStatusText');
    const dot = $('#sideLiveDot');
    if (statusText) {
      if (!state.monitorRunning) statusText.textContent = '实时监控已停止';
      else if (!last) statusText.textContent = '正在采集网络质量…';
      else if (last.internet && last.internet.success) statusText.textContent = '网络在线 · 实时采样中';
      else statusText.textContent = '互联网探测失败';
    }
    if (dot) dot.classList.toggle('off', !state.monitorRunning || (last && last.internet && !last.internet.success));
  }

  function renderDashboardIssues() {
    const box = $('#dashIssues');
    if (!box) return;
    const issues = currentIssues();
    if (!issues.length) {
      box.innerHTML = `
        <div class="issue-item good">
          <span class="issue-sev"></span>
          <div class="issue-copy"><b>${state.lastReport ? '体检未发现明显问题' : '当前网络配置正常'}</b><p>${state.lastReport ? '所有检查阶段均未报告需要优先处理的风险。' : '可以运行全面体检，进一步验证 DNS、厂商节点与链路稳定性。'}</p></div>
        </div>`;
      return;
    }
    box.innerHTML = issues.slice(0, 2).map(renderIssue).join('');
  }

  function renderServiceMatrix() {
    const box = $('#dashServices');
    const foot = $('#dashServiceFoot');
    if (!box) return;
    const conn = state.connectivity;
    if (conn && Array.isArray(conn.results) && conn.results.length) {
      const results = conn.results.slice(0, 8);
      box.innerHTML = results
        .map(
          (result) => `
          <div class="service-chip" title="${esc(result.host)}">
            <span class="service-dot ${result.success ? 'ok' : 'fail'}"></span>
            <span class="service-name">${esc(result.name || result.host)}</span>
            <span class="service-ms">${result.success ? `${fmtMs(result.avg)} ms` : '不可达'}</span>
          </div>`,
        )
        .join('');
      const reachable = conn.results.filter((item) => item.success).length;
      if (foot) {
        foot.textContent = `${reachable} / ${conn.results.length} 个节点可达 · ${conn.results.every((item) => item.success) ? '全部通过' : '存在不可达节点'}`;
      }
      return;
    }
    const targets = enabledTargets().slice(0, 8);
    box.innerHTML = targets.length
      ? targets
          .map(
            (target) => `
            <div class="service-chip">
              <span class="service-dot"></span>
              <span class="service-name">${esc(target.name)}</span>
              <span class="service-ms">待测试</span>
            </div>`,
          )
          .join('')
      : '<div class="empty-state small" style="grid-column:1/-1"><p>没有启用的测试目标。</p></div>';
    if (foot) foot.textContent = '运行「一键连通测试」后显示各厂商可达性';
  }

  function renderWifiSnapshot() {
    const box = $('#dashWifi');
    if (!box) return;
    const wifi = state.snapshot && state.snapshot.wifi ? state.snapshot.wifi : null;
    const current = wifi && wifi.current;
    if (current) {
      const signal = current.signal == null ? 0 : current.signal;
      const bars = signalBars(signal);
      box.innerHTML = `
        <div class="wifi-snapshot-grid">
          <div class="wifi-snap-identity">
            <div class="wifi-snap-icon">${icon('wifi')}</div>
            <div><b>${esc(current.ssid || '未命名网络')}</b><small>${esc(current.bssid || current.physicalAddress || '--')}</small></div>
          </div>
          <div class="wifi-snap-metric"><span>信号强度</span><b>${signal ? `${signal}%` : '--'}</b>${bars}</div>
          <div class="wifi-snap-metric"><span>频段 / 信道</span><b>${esc(current.band || '--')} / ${esc(current.channel || '--')}</b></div>
          <div class="wifi-snap-metric"><span>接收 / 发送</span><b>${current.rxRate || current.receiveRate || '--'} / ${current.txRate || current.transmitRate || '--'} Mbps</b></div>
          <div class="wifi-snap-metric"><span>安全</span><b>${esc([current.authentication, current.cipher].filter(Boolean).join(' / ') || '--')}</b></div>
        </div>`;
      return;
    }
    if (wifi && wifi.available) {
      box.innerHTML = `
        <div class="empty-state small">
          ${icon('wifi')}
          <p>无线网卡已就绪，但当前没有连接 Wi-Fi。可扫描周边网络并查看信道拥挤度。</p>
          <button class="btn ghost small" data-action="go-wifi">${icon('wifi-search')}扫描 Wi-Fi</button>
        </div>`;
      return;
    }
    box.innerHTML = `
      <div class="empty-state small">
        ${icon('ethernet')}
        <p>本机未检测到可用的无线网卡，当前使用有线通道。可前往「网络通道」查看链路详情。</p>
        <button class="btn ghost small" data-action="go-channels">${icon('route')}查看网络通道</button>
      </div>`;
  }

  function signalBars(value) {
    const level = clamp(Math.ceil((Number(value) || 0) / 20), 0, 5);
    return `<div class="signal-meter">${[1, 2, 3, 4, 5].map((index) => `<i class="${index <= level ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  function renderMonitorMetrics() {
    const last = state.monitorSamples[state.monitorSamples.length - 1];
    const internet = last && last.internet;
    const latency = $('#kpiLatency');
    const latencyHint = $('#kpiLatencyHint');
    if (latency) latency.textContent = internet && internet.success ? `${fmtMs(internet.latency)} ms` : '--';
    if (latencyHint) latencyHint.textContent = internet && internet.success ? `最后采样 ${fmtTime(last.t)}` : '等待实时采样';
    const loss = $('#kpiLoss');
    const lossHint = $('#kpiLossHint');
    const lossPct = sampleLossRate(20);
    if (loss) loss.textContent = lossPct == null ? '--' : `${lossPct}%`;
    if (lossHint) lossHint.textContent = state.monitorSamples.length ? `最近 ${Math.min(20, state.monitorSamples.length)} 次采样` : '最近 60 次采样';
    const nodes = $('#kpiNodes');
    const nodesHint = $('#kpiNodesHint');
    const conn = state.connectivity;
    if (nodes) nodes.textContent = conn && conn.results ? `${conn.results.filter((item) => item.success).length}/${conn.results.length}` : '--';
    if (nodesHint) nodesHint.textContent = conn ? (conn.results.every((item) => item.success) ? '全部已启用节点可达' : '存在不可达节点') : '尚未进行全网测试';
    renderQuality();
  }

  function sampleLossRate(limit = 20) {
    const samples = state.monitorSamples.slice(-limit);
    if (!samples.length) return null;
    const failed = samples.filter((sample) => !sample.internet || !sample.internet.success).length;
    return Math.round((failed / samples.length) * 100);
  }

  function jitterFromSamples(limit = 12) {
    const values = state.monitorSamples
      .slice(-limit)
      .filter((sample) => sample.internet && sample.internet.success && sample.internet.latency != null)
      .map((sample) => Number(sample.internet.latency));
    if (values.length < 2) return null;
    let sum = 0;
    for (let i = 1; i < values.length; i += 1) sum += Math.abs(values[i] - values[i - 1]);
    return Math.round((sum / (values.length - 1)) * 10) / 10;
  }

  function renderQuality() {
    const last = state.monitorSamples[state.monitorSamples.length - 1];
    const internet = last && last.internet;
    const gateway = last && last.gateway;
    const qLatency = $('#qualityLatency');
    const qGateway = $('#qualityGateway');
    const qJitter = $('#qualityJitter');
    const qLoss = $('#qualityLoss');
    if (qLatency) qLatency.textContent = internet && internet.success ? fmtMs(internet.latency) : '--';
    if (qGateway) qGateway.textContent = gateway && gateway.success ? fmtMs(gateway.latency) : '--';
    if (qJitter) qJitter.textContent = jitterFromSamples();
    if (qLoss) qLoss.textContent = sampleLossRate(20);
    const pill = $('#qualityLivePill');
    if (pill) {
      pill.className = `mini-pill ${state.monitorRunning ? 'live' : ''}`;
      pill.innerHTML = `<span class="live-dot${state.monitorRunning ? '' : ' off'}"></span>${state.monitorRunning ? '采集中' : '已停止'}`;
    }
  }

  async function startMonitor(silent = false) {
    if (!window.wifi || typeof window.wifi.startMonitor !== 'function') return;
    if (state.monitorRunning) return;
    try {
      const result = await window.wifi.startMonitor({ interval: 1200 });
      if (result && result.ok) {
        state.monitorRunning = true;
        renderMonitorButtons();
        renderSideStatus();
        if (!silent) toast('实时监控已启动', `采样间隔 ${result.interval || 1200} ms`, 'success', 2200);
      } else if (result && result.error) {
        toast('启动实时监控失败', result.error, 'error');
      }
    } catch (error) {
      toast('启动实时监控失败', String(error.message || error), 'error');
    }
  }

  async function stopMonitor(silent = false) {
    if (!window.wifi || typeof window.wifi.stopMonitor !== 'function') return;
    try {
      await window.wifi.stopMonitor();
    } catch {
      // ignore
    }
    state.monitorRunning = false;
    renderMonitorButtons();
    renderQuality();
    renderSideStatus();
    if (!silent) toast('实时监控已停止', '历史采样仍保留在曲线中。', 'info', 2400);
  }

  function renderMonitorButtons() {
    const button = $('#stabilityMonitorBtn');
    if (!button) return;
    button.innerHTML = state.monitorRunning
      ? `${icon('monitor')}停止实时监控`
      : `${icon('play')}开始实时监控`;
    const pill = $('#qualityLivePill');
    if (pill) {
      pill.className = `mini-pill ${state.monitorRunning ? 'live' : ''}`;
      pill.innerHTML = `<span class="live-dot${state.monitorRunning ? '' : ' off'}"></span>${state.monitorRunning ? '采集中' : '已停止'}`;
    }
  }

  function handleMonitorSample(sample) {
    if (!sample || !state.monitorRunning) return;
    state.monitorSamples.push(sample);
    if (state.monitorSamples.length > MAX_SAMPLES) state.monitorSamples.splice(0, state.monitorSamples.length - MAX_SAMPLES);
    if (sample.wifi && state.snapshot && state.snapshot.wifi && state.snapshot.wifi.current) {
      state.snapshot.wifi.current.signal = sample.wifi.signal;
      state.snapshot.wifi.current.channel = sample.wifi.channel;
      state.snapshot.wifi.current.band = sample.wifi.band;
      state.snapshot.wifi.current.rxRate = sample.wifi.rxRate;
      state.snapshot.wifi.current.txRate = sample.wifi.txRate;
    }
    renderMonitorMetrics();
    renderCharts();
    renderSideStatus();
    if (state.currentView === 'wifi' && sample.wifi) renderWifi();
  }

  /* ---------------------------------------------------------
     Channels
     --------------------------------------------------------- */
  function renderChannels() {
    const snapshot = state.snapshot;
    const bannerTitle = $('#channelBannerTitle');
    const bannerText = $('#channelBannerText');
    const badges = $('#channelBannerBadges');
    const adapter = activeAdapter();
    if (!snapshot) {
      if (bannerTitle) bannerTitle.textContent = '正在识别主用通道…';
      if (bannerText) bannerText.textContent = '正在读取网卡、默认路由与链路状态。';
      if (badges) badges.innerHTML = '';
      return;
    }
    if (bannerTitle) {
      bannerTitle.textContent = adapter ? `${adapterLabel(adapter)} · ${adapter.name}` : '没有可用的默认上网通道';
    }
    if (bannerText) {
      bannerText.textContent = adapter
        ? `${adapter.description || adapter.name} · ${windowsStateLabel(adapter.status) || '状态未知'} · ${adapter.linkSpeed || '速率未知'}。Windows 按默认路由与有效跃点选择该通道。`
        : '系统没有找到带默认网关的可用网卡。请检查网线、Wi-Fi 连接或 DHCP 是否正常。';
    }
    if (badges) {
      const parts = [];
      if (adapter) {
        parts.push(`<span class="tag">${icon('ip')}${esc(primaryIp(adapter) || '无 IPv4')}</span>`);
        parts.push(`<span class="tag">${icon('gateway')}${esc(gatewayOf(adapter) || '无网关')}</span>`);
        parts.push(`<span class="tag">${icon('route')}跃点 ${esc(adapter.interfaceMetric == null ? '--' : adapter.interfaceMetric)}</span>`);
        if (state.selectedIfIndex != null && Number(state.selectedIfIndex) !== adapter.interfaceIndex) {
          const selected = snapshot.adapters.find((item) => item.interfaceIndex === Number(state.selectedIfIndex));
          parts.push(`<span class="tag" style="color:var(--blue);border-color:rgba(102,156,255,.24)">手动检查：${esc(selected ? selected.name : state.selectedIfIndex)}</span>`);
        }
      }
      parts.push(`<button class="text-btn muted" data-action="reset-priority">${icon('refresh')}恢复自动跃点</button>`);
      badges.innerHTML = parts.join('');
    }

    const grid = $('#adapterGrid');
    if (grid) {
      const adapters = snapshot.adapters.slice().sort((a, b) => {
        const rank = (item) => (adapter && item.interfaceIndex === adapter.interfaceIndex ? 0 : item.up ? 1 : 2);
        return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'zh-CN');
      });
      if (!adapters.length) {
        grid.innerHTML = '<div class="empty-state card" style="grid-column:1/-1"><p>未检测到任何网络适配器。</p></div>';
      } else {
        grid.innerHTML = adapters.map((item) => renderAdapterCard(item, adapter)).join('');
      }
    }

    renderRouteTable();
    renderProxyPanel();
    renderCompareTable(state.compareRows || []);
  }

  function renderAdapterCard(adapter, active) {
    const isActive = Boolean(active && adapter.interfaceIndex === active.interfaceIndex);
    const isSelected = state.selectedIfIndex != null && Number(state.selectedIfIndex) === adapter.interfaceIndex;
    const physical = adapter.type === 'wifi' || adapter.type === 'ethernet';
    const tags = [];
    if (isActive) tags.push('<span class="adapter-tag primary">当前通道</span>');
    if (isSelected) tags.push('<span class="adapter-tag selected">手动检查</span>');
    if (adapter.dhcp) tags.push('<span class="adapter-tag">自动获取</span>');
    else if (adapter.primaryIp) tags.push('<span class="adapter-tag">静态 IP</span>');
    if (adapter.type === 'virtual') tags.push('<span class="adapter-tag">虚拟 / VPN</span>');
    if (adapter.isApipa) tags.push('<span class="adapter-tag" style="color:var(--red)">169.254 地址</span>');
    if (!adapter.primaryIp) tags.push('<span class="adapter-tag" style="color:var(--amber)">无 IPv4</span>');
    const dns = dnsOf(adapter);
    return `
      <div class="adapter-card${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}" data-if-index="${esc(adapter.interfaceIndex)}">
        <div class="adapter-head">
          <div class="adapter-icon ${esc(adapter.type || 'other')}">${icon(adapter.kindIcon || 'adapter')}</div>
          <div class="adapter-head-copy"><b title="${esc(adapter.name)}">${esc(adapter.name)}</b><small title="${esc(adapter.description)}">${esc(adapter.description || adapter.kindLabel || '')}</small></div>
          <div class="adapter-status"><span class="status-pill ${adapter.up ? 'up' : 'down'}">${esc(windowsStateLabel(adapter.status) || (adapter.up ? '已启用' : '已断开'))}</span><span class="status-pill">${esc(adapter.kindLabel || '其他')}</span></div>
        </div>
        <div class="adapter-tags">${tags.join('')}</div>
        <div class="adapter-data">
          <div><span>IPv4 地址</span><b title="${esc(primaryIp(adapter))}">${esc(primaryIp(adapter) || '--')}</b></div>
          <div><span>默认网关</span><b>${esc(gatewayOf(adapter) || '--')}</b></div>
          <div><span>DNS</span><b title="${esc(dns.join(' / '))}">${esc(dns.join(' / ') || '--')}</b></div>
          <div><span>链路速率</span><b>${esc(adapter.linkSpeed || '--')}</b></div>
          <div><span>接口跃点</span><b>${esc(adapter.interfaceMetric == null ? '--' : adapter.interfaceMetric)}</b></div>
          <div><span>MAC</span><b title="${esc(adapter.mac)}">${esc(adapter.mac || '--')}</b></div>
        </div>
        <div class="adapter-actions">
          <button data-adapter-action="check" data-if-index="${esc(adapter.interfaceIndex)}"${!adapter.primaryIp ? ' disabled' : ''}>${icon('activity')}检查线路</button>
          ${
            physical
              ? `<button class="primary" data-adapter-action="priority" data-if-index="${esc(adapter.interfaceIndex)}"${isActive ? ' disabled' : ''}>${icon('zap')}${isActive ? '当前优先' : '设为优先'}</button>`
              : `<button data-adapter-action="detail" data-if-index="${esc(adapter.interfaceIndex)}">${icon('info')}查看详情</button>`
          }
        </div>
      </div>`;
  }

  function renderRouteTable() {
    const table = $('#routeTable');
    const count = $('#routeCount');
    if (!table) return;
    const body = table.querySelector('tbody');
    if (!body) return;
    const routes = state.snapshot && Array.isArray(state.snapshot.defaultRoutes) ? state.snapshot.defaultRoutes : [];
    if (count) count.textContent = `${routes.length} 条`;
    if (!routes.length) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted-2)">没有默认路由</td></tr>';
      return;
    }
    body.innerHTML = routes
      .map(
        (route) => `
        <tr>
          <td><b>${esc(route.interfaceAlias || '未知接口')}</b><br><small class="mono">ifIndex ${esc(route.ifIndex)}</small></td>
          <td class="mono">${esc(route.nextHop || '--')}</td>
          <td class="num">${esc(route.routeMetric)}</td>
          <td class="num">${esc(route.interfaceMetric)}</td>
          <td class="num" style="color:var(--cyan)">${esc(route.effectiveMetric)}</td>
        </tr>`,
      )
      .join('');
  }

  function proxyRow(title, detail, tone = 'good', tag = '') {
    return `
      <div class="proxy-row">
        <span class="dot ${tone}"></span>
        <div style="min-width:0;flex:1"><b>${esc(title)}</b><small title="${esc(detail)}">${esc(detail)}</small></div>
        ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}
      </div>`;
  }

  function renderProxyPanel() {
    const box = $('#proxyPanel');
    if (!box) return;
    const snapshot = state.snapshot;
    if (!snapshot) {
      box.innerHTML = '<div class="empty-state small"><p>正在读取环境信息…</p></div>';
      return;
    }
    const proxy = snapshot.proxy || {};
    const wlan = snapshot.wlanService || {};
    const virtual = (snapshot.virtualAdapters || []).filter((item) => item.up);
    const selected = snapshot.adapters.find((item) => item.interfaceIndex === Number(state.selectedIfIndex));
    const rows = [];
    rows.push(
      proxyRow(
        '系统代理',
        proxy.enabled ? `${proxy.server || '未填写服务器'} · 代理已开启` : '未启用系统代理',
        proxy.enabled ? 'warn' : 'good',
        proxy.enabled ? '需关注' : '正常',
      ),
    );
    rows.push(proxyRow('自动代理脚本 (PAC)', proxy.pac || '未配置 PAC', proxy.pac ? 'warn' : 'good', proxy.pac ? '已配置' : '正常'));
    rows.push(
      proxyRow(
        'WLAN 无线服务',
        wlan.status ? `${windowsStateLabel(wlan.status)} · 启动类型 ${windowsStateLabel(wlan.startType)}` : '未检测到 WlanSvc 服务',
        wlan.status && /running|正在运行/i.test(String(wlan.status)) ? 'good' : 'warn',
        wlan.status && /running|正在运行/i.test(String(wlan.status)) ? '运行中' : '未运行',
      ),
    );
    rows.push(
      proxyRow(
        '虚拟网卡 / VPN',
        virtual.length ? virtual.map((item) => item.name).join('、') : '没有处于连接状态的虚拟网卡',
        virtual.length ? 'warn' : 'good',
        virtual.length ? `${virtual.length} 个` : '正常',
      ),
    );
    const hosts = snapshot.system ? snapshot.system.hostsEntries : null;
    rows.push(proxyRow('Hosts 文件', hosts ? `检测到 ${hosts} 条自定义映射` : '没有自定义映射', hosts ? 'warn' : 'good', hosts ? '需核对' : '正常'));
    rows.push(
      proxyRow(
        '当前诊断线路',
        selected ? `${selected.name}（手动选择）` : activeAdapter() ? `${activeAdapter().name}（系统主用）` : '无可用通道',
        selected ? 'warn' : 'good',
        selected ? '手动' : '自动',
      ),
    );
    box.innerHTML = rows.join('');
  }

  function renderCompareTable(rows) {
    const body = $('#compareBody');
    const status = $('#compareStatus');
    if (!body) return;
    if (!rows || !rows.length) {
      if (status) status.textContent = '未测试';
      return;
    }
    if (status) status.textContent = `${rows.length} 条线路`;
    body.innerHTML = `
      <table class="compare-table">
        <thead><tr><th>线路</th><th>网关延迟</th><th>外网延迟</th><th>丢包</th><th>评价</th></tr></thead>
        <tbody>
          ${rows
            .map((row) => {
              const gw = row.gateway;
              const net = row.internet;
              const loss = Math.max(gw ? gw.lossPct || 0 : 0, net ? net.lossPct || 0 : 0);
              const avg = net && net.success ? net.avg : null;
              const tone = !net || !net.success ? 'bad' : avg < 40 ? 'good' : avg < 90 ? 'warn' : 'bad';
              const verdict = !net || !net.success ? '外网不可达' : avg < 40 ? '优秀' : avg < 90 ? '良好' : '延迟偏高';
              return `
                <tr>
                  <td><div class="compare-name">${icon(row.type === 'wifi' ? 'wifi' : row.type === 'virtual' ? 'shield' : 'ethernet')}${esc(row.name)}</div></td>
                  <td class="compare-lat ${gw && gw.success ? (gw.avg < 10 ? 'good' : gw.avg < 40 ? 'warn' : 'bad') : 'bad'}">${gw && gw.success ? `${fmtMs(gw.avg)} ms` : '不可达'}</td>
                  <td class="compare-lat ${tone}">${net && net.success ? `${fmtMs(net.avg)} ms` : '不可达'}</td>
                  <td class="num">${loss}%</td>
                  <td><span class="mini-pill ${tone === 'good' ? 'good' : tone === 'warn' ? 'warn' : 'bad'}">${verdict}</span></td>
                </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;
  }

  async function checkLine(ifIndex) {
    const adapter = state.snapshot && state.snapshot.adapters.find((item) => item.interfaceIndex === Number(ifIndex));
    if (!adapter) return;
    const ip = primaryIp(adapter);
    if (!ip) {
      toast('无法检查该线路', '该网卡没有可用的 IPv4 地址。', 'warn');
      return;
    }
    state.selectedIfIndex = Number(ifIndex);
    saveSettings({ selectedIfIndex: state.selectedIfIndex });
    renderChannels();
    showLoading(`正在检查 ${adapter.name}…`);
    const gateway = gatewayOf(adapter);
    const targets = [];
    if (gateway) targets.push({ id: 'gateway', name: '默认网关', vendor: '路由器', host: gateway, group: 'gateway', required: true });
    targets.push({ id: 'internet', name: '互联网', vendor: '阿里云 DNS', host: '223.5.5.5', group: 'dns', required: true });
    try {
      const [pingResult, tcpResult] = await Promise.allSettled([
        window.wifi.ping({ targets, count: 3, timeout: 1100, sourceIp: ip }),
        window.wifi.tcpTest({
          services: [{ host: 'www.baidu.com', port: 443, name: '百度 HTTPS', required: true }],
          localAddress: ip,
          timeout: 4000,
        }),
      ]);
      hideLoading();
      const pings = pingResult.status === 'fulfilled' && pingResult.value && pingResult.value.ok ? pingResult.value.results : [];
      const tcp = tcpResult.status === 'fulfilled' && tcpResult.value && tcpResult.value.ok ? tcpResult.value.results[0] : null;
      const gatewayPing = pings.find((item) => item.id === 'gateway') || null;
      const internetPing = pings.find((item) => item.id === 'internet') || null;
      const row = {
        ifIndex: adapter.interfaceIndex,
        name: adapter.name,
        type: adapter.type,
        gateway: gatewayPing,
        internet: internetPing,
        tcp,
      };
      state.compareRows = [row, ...(state.compareRows || []).filter((item) => item.ifIndex !== adapter.interfaceIndex)].slice(0, 6);
      state.lastLineCheck = row;
      renderCompareTable(state.compareRows);
      const body = `
        <p>已临时将 <b>${esc(adapter.name)}</b> 设为诊断线路，未修改系统网络配置。</p>
        <div class="result-metric-grid">
          <div class="result-metric"><span>网关延迟</span><b>${gatewayPing && gatewayPing.success ? `${fmtMs(gatewayPing.avg)} ms` : '不可达'}</b></div>
          <div class="result-metric"><span>外网延迟</span><b>${internetPing && internetPing.success ? `${fmtMs(internetPing.avg)} ms` : '不可达'}</b></div>
          <div class="result-metric"><span>外网丢包</span><b>${internetPing ? `${internetPing.lossPct}%` : '--'}</b></div>
          <div class="result-metric"><span>百度 TCP 443</span><b>${tcp && tcp.ok ? `${fmtMs(tcp.latency)} ms` : '失败'}</b></div>
        </div>
        <p style="margin-top:12px;color:var(--muted-2);font-size:9px">该结果已加入「线路对比」。可点击「设为优先」调整系统跃点，或直接运行全面体检使用此线路。</p>`;
      openModal({
        kicker: '线路检查',
        title: `${adapterLabel(adapter)} · ${adapter.name}`,
        body,
        actions: [
          { label: '关闭', style: 'ghost' },
          {
            label: '用此线路体检',
            style: 'primary',
            onClick: () => {
              closeModal();
              switchView('diagnostic');
              runDiagnostic();
            },
          },
        ],
      });
      const allOk = internetPing && internetPing.success && (!gatewayPing || gatewayPing.success) && tcp && tcp.ok;
      toast(allOk ? '线路检查通过' : '线路检查完成', allOk ? '网关、外网与 HTTPS 均可连通。' : '存在不可达项目，请查看详情。', allOk ? 'success' : 'warn');
    } catch (error) {
      hideLoading();
      toast('线路检查失败', String(error.message || error), 'error');
    }
  }

  async function compareChannels() {
    const snapshot = state.snapshot;
    if (!snapshot) return;
    const adapters = (snapshot.physicalAdapters || []).filter((adapter) => adapter.up && primaryIp(adapter));
    if (!adapters.length) {
      toast('没有可对比的线路', '需要有已连接且获得 IPv4 地址的物理网卡。', 'warn');
      return;
    }
    const status = $('#compareStatus');
    const body = $('#compareBody');
    if (status) status.textContent = '测试中';
    if (body) body.innerHTML = `<div class="empty-state small"><p>正在依次测试 ${adapters.length} 条线路的网关与外网延迟…</p></div>`;
    const rows = [];
    for (const adapter of adapters) {
      const gateway = gatewayOf(adapter);
      const targets = [];
      if (gateway) targets.push({ id: 'gateway', name: '默认网关', host: gateway, required: true });
      targets.push({ id: 'internet', name: '互联网', host: '223.5.5.5', required: true });
      try {
        const result = await window.wifi.ping({ targets, count: 3, timeout: 1100, sourceIp: primaryIp(adapter) });
        const pings = result && result.ok ? result.results : [];
        rows.push({
          ifIndex: adapter.interfaceIndex,
          name: adapter.name,
          type: adapter.type,
          gateway: pings.find((item) => item.id === 'gateway') || null,
          internet: pings.find((item) => item.id === 'internet') || null,
        });
        state.compareRows = rows.slice();
        renderCompareTable(rows);
      } catch (error) {
        rows.push({ ifIndex: adapter.interfaceIndex, name: adapter.name, type: adapter.type, gateway: null, internet: null });
        renderCompareTable(rows);
      }
    }
    state.compareRows = rows;
    renderCompareTable(rows);
    if (status) status.textContent = `已完成 · ${rows.length} 条`;
    const reachable = rows.filter((row) => row.internet && row.internet.success).length;
    toast('线路对比完成', `${reachable} / ${rows.length} 条线路可访问外网。`, reachable === rows.length ? 'success' : 'warn');
  }

  function setPriority(ifIndex) {
    const adapter = state.snapshot && state.snapshot.adapters.find((item) => item.interfaceIndex === Number(ifIndex));
    if (!adapter) return;
    if (!state.admin) {
      openModal({
        kicker: '需要管理员权限',
        title: '需要管理员权限',
        body: '<p>调整网卡跃点会改变 Windows 的默认路由选择，需要管理员权限。</p><div class="modal-risk">请以管理员身份重启应用后重试。当前不会修改任何系统设置。</div>',
        actions: [
          { label: '取消', style: 'ghost' },
          { label: '管理员重启', style: 'primary', onClick: relaunchAdmin },
        ],
      });
      return;
    }
    confirmDialog({
      kicker: '通道优先级',
      title: `将「${adapter.name}」设为优先通道？`,
      body: `<p>系统会将该网卡跃点设为 5，并把其他物理网卡调整为 50。这会影响 Windows 的默认上网线路。</p><div class="modal-risk">调整后可能需要数秒生效。原跃点会备份到本机数据目录，可通过「恢复自动跃点」还原。</div>`,
      confirmLabel: '设为优先',
      onConfirm: async () => {
        showLoading('正在调整网卡优先级…');
        try {
          const result = await window.wifi.setPriority({ ifIndex: adapter.interfaceIndex });
          hideLoading();
          if (result && result.ok) {
            toast('已设为优先通道', adapter.name, 'success');
            await refreshSnapshot(true, true);
          } else {
            toast('设置失败', (result && result.error) || '未知错误', 'error');
          }
        } catch (error) {
          hideLoading();
          toast('设置失败', String(error.message || error), 'error');
        }
      },
    });
  }

  function resetPriority() {
    if (!state.admin) {
      openModal({
        kicker: '需要管理员权限',
        title: '需要管理员权限',
        body: '<p>恢复自动跃点需要管理员权限。</p><div class="modal-risk">当前不会修改任何系统设置。</div>',
        actions: [
          { label: '取消', style: 'ghost' },
          { label: '管理员重启', style: 'primary', onClick: relaunchAdmin },
        ],
      });
      return;
    }
    confirmDialog({
      kicker: '恢复自动跃点',
      title: '恢复自动跃点？',
      body: '<p>将清除本应用备份的网卡跃点设置，或让 Windows 重新自动选择线路。</p>',
      confirmLabel: '恢复自动',
      onConfirm: async () => {
        showLoading('正在恢复自动跃点…');
        try {
          const result = await window.wifi.resetPriority();
          hideLoading();
          if (result && result.ok) {
            toast('已恢复自动跃点', result.restored ? '已按备份还原网卡跃点。' : 'Windows 将自动选择上网线路。', 'success');
            await refreshSnapshot(true, true);
          } else {
            toast('恢复失败', (result && result.error) || '未知错误', 'error');
          }
        } catch (error) {
          hideLoading();
          toast('恢复失败', String(error.message || error), 'error');
        }
      },
    });
  }

  function showAdapterDetail(ifIndex) {
    const adapter = state.snapshot && state.snapshot.adapters.find((item) => item.interfaceIndex === Number(ifIndex));
    if (!adapter) return;
    const rows = [
      ['名称', adapter.name],
      ['描述', adapter.description],
      ['类型', adapter.kindLabel],
      ['状态', windowsStateLabel(adapter.status)],
      ['接口索引', adapter.interfaceIndex],
      ['IPv4', primaryIp(adapter) || '--'],
      ['IPv6', (adapter.ipv6 || []).map((item) => item.address).join(', ') || '--'],
      ['网关', gatewayOf(adapter) || '--'],
      ['DNS', dnsOf(adapter).join(', ') || '--'],
      ['DHCP', adapter.dhcp ? '已启用' : '未启用'],
      ['链路速率', adapter.linkSpeed || '--'],
      ['MAC', adapter.mac || '--'],
      ['驱动版本', adapter.driverVersion || '--'],
      ['连接配置文件', adapter.profile ? adapter.profile.name : '--'],
    ];
    openModal({
      kicker: '网卡详情',
      title: adapter.name,
      body: `<div class="result-metric-grid">${rows.map(([label, value]) => `<div class="result-metric"><span>${esc(label)}</span><b style="font-size:11px;word-break:break-all">${esc(value)}</b></div>`).join('')}</div>`,
      actions: [{ label: '关闭', style: 'ghost' }],
    });
  }

  /* =========================================================
     Wi-Fi analyzer
     ========================================================= */
  function wifiCurrent() {
    return state.snapshot && state.snapshot.wifi ? state.snapshot.wifi.current : null;
  }

  function wifiAvailable() {
    return Boolean(state.snapshot && state.snapshot.wifi && state.snapshot.wifi.available);
  }

  function wifiQuality(signal) {
    const value = num(signal, null);
    if (value == null) return { label: '未知', tone: 'warn' };
    if (value >= 80) return { label: '优秀', tone: 'good' };
    if (value >= 60) return { label: '良好', tone: 'good' };
    if (value >= 40) return { label: '一般', tone: 'warn' };
    return { label: '较弱', tone: 'bad' };
  }

  function setWifiEmpty(iconName, title, text, actions = '') {
    const box = $('#wifiEmpty');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `
      <div class="empty-art">${icon(iconName)}</div>
      <div class="empty-hero-copy">
        <span class="card-label">无线适配器</span>
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
        ${actions ? `<div class="empty-hero-actions">${actions}</div>` : ''}
      </div>`;
  }

  function renderWifi() {
    const snapshot = state.snapshot;
    const main = $('#wifiMain');
    const empty = $('#wifiEmpty');
    const lowerCards = $('.wifi-lower-grid');
    const securityCard = $('.wifi-security-card');
    if (!snapshot) {
      if (main) main.hidden = true;
      if (lowerCards) lowerCards.hidden = true;
      if (securityCard) securityCard.hidden = true;
      setWifiEmpty('wifi', '正在读取无线网卡…', '正在读取 WLAN 服务、无线适配器与当前连接状态。');
      renderWifiPassword();
      return;
    }
    const wifi = snapshot.wifi || {};
    const current = wifi.current;
    if (!wifi.available) {
      if (main) main.hidden = true;
      if (lowerCards) lowerCards.hidden = true;
      if (securityCard) securityCard.hidden = true;
      if (empty) empty.classList.add('compact');
      const service = snapshot.wlanService || wifi.service || null;
      const serviceText = service && service.status
        ? `WLAN 服务状态：${windowsStateLabel(service.status)}。${/running|正在运行/i.test(String(service.status)) ? '' : '可尝试在「修复工具」中启动 WLAN 服务。'}`
        : '本机没有可用的无线网卡，当前使用有线通道。';
      setWifiEmpty(
        'ethernet',
        '未检测到无线网卡',
        serviceText,
        `<button class="btn ghost small" data-action="go-channels">${icon('route')}查看网络通道</button><button class="btn ghost small" data-action="open-wifi-settings">${icon('settings')}Windows 设置</button>`,
      );
      if (empty) empty.classList.add('compact');
      renderWifiChannels();
      renderWifiTable();
      renderWifiAdvice();
      renderWifiSecurity();
      renderWifiPassword();
      return;
    }
    if (!current) {
      if (main) main.hidden = true;
      if (lowerCards) lowerCards.hidden = false;
      if (securityCard) securityCard.hidden = false;
      if (empty) empty.classList.remove('compact');
      setWifiEmpty(
        'wifi',
        '无线网卡已就绪，当前未连接 Wi-Fi',
        '可以扫描周边网络、查看信道拥挤度，或打开 Windows Wi-Fi 设置进行连接。',
        `<button class="btn primary small" data-action="scan-wifi">${icon('wifi-search')}扫描 Wi-Fi</button><button class="btn ghost small" data-action="open-wifi-settings">${icon('settings')}Windows 设置</button>`,
      );
      renderWifiChannels();
      renderWifiTable();
      renderWifiAdvice();
      renderWifiSecurity();
      renderWifiPassword();
      return;
    }
    if (empty) {
      empty.hidden = true;
      empty.classList.remove('compact');
    }
    if (lowerCards) lowerCards.hidden = false;
    if (securityCard) securityCard.hidden = false;
    if (main) main.hidden = false;

    const signal = num(current.signal, null);
    const quality = wifiQuality(signal);
    const ssidEl = $('#wifiSsid');
    const bssidEl = $('#wifiBssid');
    const statePill = $('#wifiStatePill');
    if (ssidEl) ssidEl.textContent = current.ssid || '未命名网络';
    if (bssidEl) bssidEl.textContent = current.bssid || current.mac || '--';
    if (statePill) {
      statePill.textContent = current.state || '已连接';
      statePill.className = `mini-pill ${quality.tone === 'good' ? 'good' : quality.tone === 'warn' ? 'warn' : 'bad'}`;
    }

    const signalValue = $('#wifiSignalValue');
    if (signalValue) {
      signalValue.textContent = signal == null ? '--' : `${Math.round(signal)}%`;
      signalValue.style.color = quality.tone === 'good' ? 'var(--cyan)' : quality.tone === 'warn' ? 'var(--amber)' : 'var(--red)';
    }
    const arc = $('#wifiSignalArc');
    if (arc) {
      const value = clamp(Number(signal) || 0, 0, 100);
      arc.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - value / 100));
      arc.style.stroke = quality.tone === 'good' ? 'var(--cyan)' : quality.tone === 'warn' ? 'var(--amber)' : 'var(--red)';
    }
    const bars = $('#wifiSignalBars');
    if (bars) {
      const level = clamp(Math.ceil((Number(signal) || 0) / 20), 0, 5);
      bars.innerHTML = [1, 2, 3, 4, 5].map((index) => `<i class="${index <= level ? 'on' : ''}"></i>`).join('');
    }

    const badges = $('#wifiBadges');
    if (badges) {
      const items = [];
      items.push(`<span class="wifi-badge ${quality.tone}">信号 ${quality.label}${signal == null ? '' : ` · ${Math.round(signal)}%`}</span>`);
      if (current.band) items.push(`<span class="wifi-badge">${esc(current.band)} · 信道 ${esc(current.channel || '--')}</span>`);
      if (current.radioType) items.push(`<span class="wifi-badge">${esc(current.radioType)}</span>`);
      if (current.authentication) {
        const weak = /open|开放式|wep/i.test(current.authentication);
        items.push(`<span class="wifi-badge ${weak ? 'bad' : 'good'}">${esc(current.authentication)}</span>`);
      }
      if (current.cipher) items.push(`<span class="wifi-badge">${esc(current.cipher)}</span>`);
      badges.innerHTML = items.join('');
    }

    const details = $('#wifiDetails');
    if (details) {
      const rows = [
        ['频段 / 信道', `${current.band || '--'} / ${current.channel || '--'}`],
        ['无线电类型', current.radioType || '--'],
        ['接收 / 发送速率', `${current.rxRate || '--'} / ${current.txRate || '--'} Mbps`],
        ['身份验证', current.authentication || '--'],
        ['加密方式', current.cipher || '--'],
        ['配置文件', current.profile || (wifi.profiles && wifi.profiles[0]) || '--'],
      ];
      details.innerHTML = rows.map(([label, value]) => `<div><span>${esc(label)}</span><b title="${esc(value)}">${esc(value)}</b></div>`).join('');
    }

    renderWifiChannels();
    renderWifiTable();
    renderWifiAdvice();
    renderWifiSecurity();
    renderWifiPassword();
  }

  function renderWifiChannels() {
    const box = $('#channelChart');
    if (!box) return;
    const scan = state.wifiScan;
    const band = state.selectedBand || '2.4G';
    const current = wifiCurrent();
    $$('#bandSwitch button').forEach((button) => {
      button.classList.toggle('active', button.dataset.band === band);
    });
    const recommend = $('#wifiRecommend');
    if (!scan || !scan.ok || !scan.analysis) {
      box.innerHTML = `<div class="empty-state small"><p>${scan && scan.error ? esc(scan.error) : '扫描后显示周边信道占用'}</p></div>`;
      if (recommend) recommend.innerHTML = `<span class="rec-label">${icon('zap')}推荐信道</span><span class="rec-chip">--</span>`;
      return;
    }
    const list = (scan.analysis.list || []).filter((item) => item.band === band).sort((a, b) => a.channel - b.channel);
    if (!list.length) {
      box.innerHTML = `<div class="empty-state small"><p>${esc(band)} 频段暂未扫描到周边网络。</p></div>`;
    } else {
      const maxWeight = Math.max(...list.map((item) => Number(item.weighted) || 1), 1);
      box.innerHTML = list
        .map((item) => {
          const pct = clamp(Math.round(((Number(item.weighted) || 1) / maxWeight) * 100), 8, 100);
          const tone = (item.maxSignal || 0) >= 70 ? 'strong' : (item.maxSignal || 0) >= 45 ? 'medium' : 'weak';
          const isCurrent = current && Number(current.channel) === Number(item.channel) && (!current.band || current.band === band);
          return `
            <div class="channel-bar${isCurrent ? ' current' : ''}" title="信道 ${esc(item.channel)} · ${esc(item.count)} 个网络 · 最强信号 ${esc(item.maxSignal || 0)}%">
              <div class="channel-bar-stack"><i class="channel-bar-seg ${tone}" style="height:${pct}%"></i></div>
              <span class="channel-bar-label">${esc(item.channel)}</span>
            </div>`;
        })
        .join('');
    }
    if (recommend) {
      const channel = scan.analysis.recommended ? scan.analysis.recommended[band] : null;
      const currentOnBand = current && current.band === band;
      recommend.innerHTML = `
        <span class="rec-label">${icon('zap')}推荐信道</span>
        <span class="rec-chip">${channel ? `信道 ${esc(channel)}` : '暂无数据'}</span>
        ${currentOnBand ? `<span class="rec-label" style="margin-left:8px">当前 ${esc(current.channel || '--')}</span>` : ''}`;
    }
  }

  function renderWifiTable() {
    const table = $('#wifiTable');
    const count = $('#wifiCountPill');
    if (!table) return;
    const body = table.querySelector('tbody');
    if (!body) return;
    const networks = (state.wifiScan && state.wifiScan.networks) || [];
    const query = String(state.wifiQuery || '').trim().toLowerCase();
    const filtered = networks.filter((network) => {
      if (!query) return true;
      return String(network.ssid || '').toLowerCase().includes(query) || String(network.bssid || '').toLowerCase().includes(query);
    });
    if (count) count.textContent = `${filtered.length} 个`;
    if (!networks.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted-2)">扫描后显示周边 Wi-Fi 网络</td></tr>';
      return;
    }
    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted-2)">没有匹配的网络</td></tr>';
      return;
    }
    const current = wifiCurrent();
    body.innerHTML = filtered
      .map((network) => {
        const isCurrent = current && (
          (network.bssid && current.bssid && String(network.bssid).toLowerCase() === String(current.bssid).toLowerCase()) ||
          (!current.bssid && network.ssid && network.ssid === current.ssid)
        );
        const signal = num(network.signal, null);
        const quality = wifiQuality(signal);
        const open = Boolean(network.open);
        const weakSecurity = open || Boolean(network.wep);
        return `
          <tr class="${isCurrent ? 'current-row' : ''}">
            <td>
              <div class="ssid-cell">
                ${icon(weakSecurity ? 'unlock' : 'lock', `lock${open ? ' open' : ''}`)}
                <div><b title="${esc(network.ssid)}">${esc(network.ssid || '(隐藏网络)')}</b><small>${esc(network.radioType || network.networkType || '')}</small></div>
              </div>
            </td>
            <td><div class="wifi-sig">${signalBars(signal)}<b>${signal == null ? '--' : `${Math.round(signal)}%`}</b></div></td>
            <td>${esc(network.band || '--')} / ${esc(network.channel || '--')}</td>
            <td>${esc(network.networkType || network.radioType || '--')}</td>
            <td><span class="mini-pill ${weakSecurity ? 'bad' : 'good'}">${esc(network.security || '未知')}</span></td>
            <td class="mono">${esc(network.bssid || '--')}</td>
          </tr>`;
      })
      .join('');
  }

  function renderWifiAdvice() {
    const box = $('#wifiAdvice');
    if (!box) return;
    const current = wifiCurrent();
    const scan = state.wifiScan;
    const items = [];
    if (!wifiAvailable()) {
      box.innerHTML = '<div class="empty-state small"><p>本机没有可用的无线网卡，无需进行无线优化。</p></div>';
      return;
    }
    if (!current) {
      box.innerHTML = '<div class="empty-state small"><p>连接 Wi-Fi 后可获得针对当前网络的优化建议。</p></div>';
      return;
    }
    const signal = num(current.signal, null);
    if (signal != null && signal < 40) {
      items.push({ tone: 'bad', icon: 'alert', title: '信号偏弱', text: '当前信号低于 40%，容易掉线或降速。尽量靠近路由器，避开墙体与金属遮挡。' });
    } else if (signal != null && signal < 60) {
      items.push({ tone: 'warn', icon: 'signal', title: '信号一般', text: '当前信号低于 60%，高带宽场景可能不稳定。可尝试调整路由器位置或使用 5G 频段。' });
    }
    if (current.band === '2.4G') {
      items.push({ tone: 'warn', icon: 'wifi', title: '正在使用 2.4G 频段', text: '2.4G 穿墙强但干扰多、速率低。如果设备支持且距离较近，优先连接 5G 或 6G 网络。' });
    }
    if (scan && scan.ok && scan.analysis) {
      const list = (scan.analysis.list || []).filter((item) => item.band === current.band);
      const currentChannel = list.find((item) => Number(item.channel) === Number(current.channel));
      if (currentChannel && currentChannel.count >= 4) {
        items.push({ tone: 'warn', icon: 'activity', title: '当前信道较拥挤', text: `信道 ${current.channel} 上有 ${currentChannel.count} 个网络，可能造成干扰。可尝试切换到推荐信道。` });
      }
      const recommended = scan.analysis.recommended ? scan.analysis.recommended[current.band] : null;
      if (recommended && Number(recommended) !== Number(current.channel)) {
        items.push({ tone: 'info', icon: 'zap', title: `建议尝试信道 ${recommended}`, text: '该信道在当前扫描结果中干扰最少。修改信道需要在路由器管理界面操作。' });
      }
    }
    if (current.authentication && /open|开放式/i.test(current.authentication)) {
      items.push({ tone: 'bad', icon: 'unlock', title: '开放网络无加密', text: '当前 Wi-Fi 没有加密，传输内容可能被同一网络中的设备监听。建议使用 WPA2/WPA3 加密网络。' });
    } else if (current.authentication && /wep/i.test(current.authentication)) {
      items.push({ tone: 'bad', icon: 'lock', title: 'WEP 加密已过时', text: 'WEP 很容易被破解，建议在路由器中改用 WPA2/WPA3。' });
    } else if (current.authentication && /wpa(?!2|3)/i.test(current.authentication)) {
      items.push({ tone: 'warn', icon: 'shield', title: '建议升级到 WPA2/WPA3', text: '旧版 WPA 安全性不足，建议在路由器中启用 WPA2 或 WPA3。' });
    }
    if (!items.length) {
      items.push({ tone: 'good', icon: 'check', title: '无线配置良好', text: '当前信号、频段与安全配置未发现明显问题。继续观察延迟与丢包即可。' });
    }
    box.innerHTML = items
      .map((item) => `
        <div class="advice-item ${item.tone === 'warn' ? '' : item.tone}">
          ${icon(item.icon)}
          <div><b>${esc(item.title)}</b><p>${esc(item.text)}</p></div>
        </div>`)
      .join('');
  }

  function renderWifiSecurity() {
    const box = $('#wifiSecurity');
    if (!box) return;
    const current = wifiCurrent();
    if (!current) {
      box.innerHTML = '<div class="empty-state small"><p>连接 Wi-Fi 后显示无线安全配置检查。</p></div>';
      return;
    }
    const auth = String(current.authentication || '');
    const cipher = String(current.cipher || '');
    const open = /open|开放式|none|无/i.test(auth);
    const wep = /wep/i.test(auth) || /wep/i.test(cipher);
    const wpa3 = /wpa3|sae/i.test(auth);
    const wpa2 = /wpa2|wpa3|sae|psk|ccmp|aes/i.test(`${auth} ${cipher}`);
    const authTone = open || wep ? 'bad' : wpa3 ? 'good' : wpa2 ? 'good' : 'warn';
    const cipherTone = /wep/i.test(cipher) ? 'bad' : /tkip/i.test(cipher) ? 'warn' : /aes|ccmp|gcmp|gcm/i.test(cipher) ? 'good' : 'warn';
    const bandTone = current.band === '5G' || current.band === '6G' ? 'good' : current.band === '2.4G' ? 'warn' : 'warn';
    const signal = num(current.signal, null);
    const quality = wifiQuality(signal);
    const rows = [
      ['身份验证', auth || '未知', authTone],
      ['加密方式', cipher || '未知', cipherTone],
      ['频段', current.band || '未知', bandTone],
      ['信号质量', signal == null ? '未知' : `${Math.round(signal)}% · ${quality.label}`, quality.tone === 'good' ? 'good' : quality.tone],
      ['网络类型', current.networkType || current.radioType || '未知', 'good'],
      ['BSSID', current.bssid || current.mac || '未知', 'good'],
    ];
    box.innerHTML = rows
      .map(([label, value, tone]) => `<div class="security-item ${tone}"><span>${esc(label)}</span><b title="${esc(value)}">${esc(value)}</b></div>`)
      .join('');
  }

  /* ---------------------------------------------------------
     Wi-Fi credentials / saved profiles
     --------------------------------------------------------- */
  function wifiProfileNames() {
    const names = [];
    const add = (value) => {
      const name = String(value == null ? '' : value).trim();
      if (name && !names.includes(name)) names.push(name);
    };
    const current = wifiCurrent();
    if (current && current.ssid) add(current.ssid);
    (state.wifiProfiles || []).forEach(add);
    return names;
  }

  function wifiPasswordDetail(name) {
    return state.wifiProfileDetails[String(name || '')] || null;
  }

  function renderWifiCapabilities() {
    const box = $('#wifiCapabilities');
    if (!box) return;
    if (state.wifiProfilesLoading) {
      box.innerHTML = '<span class="capability-chip">正在读取无线能力…</span>';
      return;
    }
    if (state.wifiCapabilitiesError) {
      box.innerHTML = `<span class="capability-chip warn" title="${esc(state.wifiCapabilitiesError)}">${icon('info')}无线能力受限</span>`;
      return;
    }
    const caps = state.wifiCapabilities;
    if (!caps) {
      box.innerHTML = '';
      return;
    }
    const chips = [
      caps.radioTypes ? `无线电：${caps.radioTypes}` : '',
      caps.authAlgorithms ? `加密：${caps.authAlgorithms}` : '',
      caps.wlanService ? `WLAN：${windowsStateLabel(caps.wlanService)}` : '',
      caps.hostedNetwork ? `承载网络：${caps.hostedNetwork}` : '',
    ].filter(Boolean);
    box.innerHTML = chips.length
      ? chips.map((text) => `<span class="capability-chip" title="${esc(text)}">${icon('wifi')}${esc(text)}</span>`).join('')
      : '<span class="capability-chip">未读取到无线能力信息</span>';
  }

  function renderWifiProfileList() {
    const box = $('#wifiProfileList');
    const count = $('#wifiProfileCount');
    if (!box) return;
    const current = wifiCurrent();
    const names = wifiProfileNames();
    if (count) count.textContent = `${names.length} 个`;
    if (state.wifiProfilesLoading) {
      box.innerHTML = '<div class="empty-state small"><div class="loader-ring small"></div><p>正在读取本机保存的无线网络…</p></div>';
      return;
    }
    if (state.wifiProfilesError) {
      box.innerHTML = `<div class="empty-state small"><p>${esc(state.wifiProfilesError)}</p><button class="btn ghost small" id="wifiProfilesRetryBtn">${icon('refresh')}重试</button></div>`;
      return;
    }
    if (!names.length) {
      box.innerHTML = '<div class="empty-state small"><p>没有读取到已保存的无线网络。连接过 Wi-Fi 后，这里会显示可核对的网络。</p></div>';
      return;
    }
    box.innerHTML = names
      .map((name) => {
        const detail = wifiPasswordDetail(name);
        const isCurrent = Boolean(current && current.ssid && current.ssid === name);
        const revealed = Boolean(detail && detail.revealed && detail.keyContent);
        const secret = revealed ? detail.keyContent : detail && detail.keyError ? '无法读取' : '••••••••';
        const meta = detail
          ? [detail.authentication, detail.cipher].filter(Boolean).join(' · ') || '已保存的无线网络'
          : isCurrent
            ? '当前连接的无线网络'
            : '已保存的无线网络';
        return `
          <div class="password-profile-item${isCurrent ? ' current' : ''}">
            <div class="password-profile-main">
              <span class="password-profile-icon">${icon('wifi')}</span>
              <div>
                <b>${esc(name)}</b>
                <small>${esc(meta)}${isCurrent ? ' · 当前连接' : ''}</small>
              </div>
            </div>
            <div class="password-profile-secret${revealed ? ' revealed' : ''}">${esc(secret)}</div>
            <div class="password-profile-actions">
              <button class="btn ghost small" data-profile-reveal="${esc(name)}">${revealed ? '隐藏' : '查看密码'}</button>
              <button class="btn ghost small" data-profile-copy="${esc(name)}">复制</button>
              <button class="btn ghost small" data-profile-connect="${esc(name)}"${isCurrent ? ' disabled' : ''}>${isCurrent ? '已连接' : '连接'}</button>
            </div>
          </div>`;
      })
      .join('');
  }

  function renderWifiPassword() {
    const current = wifiCurrent();
    const ssid = current && current.ssid ? current.ssid : '';
    const detail = wifiPasswordDetail(ssid);
    const nameEl = $('#wifiPasswordSsid');
    const valueEl = $('#wifiPasswordValue');
    const statusEl = $('#wifiPasswordStatus');
    const hintEl = $('#wifiPasswordHint');
    const revealBtn = $('#wifiRevealPasswordBtn');
    const copyBtn = $('#wifiCopyPasswordBtn');
    const select = $('#wifiVerifyTarget');
    const lock = $('#wifiPasswordLockIcon');
    const revealed = Boolean(state.wifiPasswordRevealed && detail && detail.keyContent);
    if (nameEl) nameEl.textContent = ssid || '未连接无线网络';
    if (valueEl) {
      valueEl.textContent = !ssid
        ? '仅支持无线连接'
        : revealed
          ? detail.keyContent
          : detail && detail.keyError
            ? '无法读取'
            : '••••••••';
      valueEl.classList.toggle('is-revealed', revealed);
    }
    if (statusEl) {
      statusEl.textContent = state.wifiProfilesLoading
        ? '读取中'
        : state.wifiProfilesError
          ? '读取受限'
          : '仅本机处理';
      statusEl.className = `mini-pill ${state.wifiProfilesError ? 'warn' : 'good'}`;
    }
    if (hintEl) {
      hintEl.textContent = !ssid
        ? '当前没有无线连接。连接 Wi-Fi 后可核对当前网络或本机保存的网络密码。'
        : detail && detail.keyError
          ? detail.keyError
          : '密码只在本机读取，不会写入报告或上传。';
    }
    if (revealBtn) {
      revealBtn.disabled = !ssid;
      revealBtn.innerHTML = `${icon(revealed ? 'eye-off' : 'eye')}${revealed ? '隐藏密码' : '显示密码'}`;
    }
    if (copyBtn) copyBtn.disabled = !ssid;
    if (lock) lock.classList.toggle('unlocked', revealed);
    if (select) {
      const names = wifiProfileNames();
      const previous = state.wifiSelectedProfile || select.value || ssid;
      select.innerHTML = names.length
        ? names.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')
        : '<option value="">暂无可核对网络</option>';
      const next = names.includes(previous) ? previous : names[0] || '';
      select.value = next;
      state.wifiSelectedProfile = next || null;
      const verifyBtn = $('#wifiVerifyBtn');
      const input = $('#wifiPasswordInput');
      if (verifyBtn) verifyBtn.disabled = !names.length;
      if (input) input.disabled = !names.length;
    }
    renderWifiProfileList();
    renderWifiCapabilities();
  }

  async function loadWifiProfiles(force = false) {
    if (!window.wifi || typeof window.wifi.wifiProfiles !== 'function') return;
    if (state.wifiProfilesLoading) return;
    if (state.wifiProfilesLoaded && !force) {
      renderWifiPassword();
      return;
    }
    state.wifiProfilesLoading = true;
    state.wifiProfilesError = null;
    if (force) {
      state.wifiProfileDetails = {};
      state.wifiPasswordRevealed = false;
    }
    renderWifiPassword();
    try {
      const [profilesResult, capabilitiesResult] = await Promise.allSettled([
        window.wifi.wifiProfiles(),
        typeof window.wifi.wifiCapabilities === 'function' ? window.wifi.wifiCapabilities() : Promise.resolve(null),
      ]);
      const profiles = profilesResult.status === 'fulfilled' ? profilesResult.value : null;
      if (profiles && profiles.ok) {
        state.wifiProfiles = Array.isArray(profiles.profiles) ? profiles.profiles : [];
        state.wifiProfilesError = null;
      } else {
        state.wifiProfiles = [];
        state.wifiProfilesError = (profiles && profiles.error) || '无法读取已保存的无线网络。';
      }
      const caps = capabilitiesResult.status === 'fulfilled' ? capabilitiesResult.value : null;
      if (caps && caps.ok) {
        state.wifiCapabilities = caps.capabilities || null;
        state.wifiCapabilitiesError = null;
      } else {
        state.wifiCapabilities = null;
        state.wifiCapabilitiesError = (caps && caps.error) || null;
      }
      state.wifiProfilesLoaded = true;
    } catch (error) {
      state.wifiProfiles = [];
      state.wifiProfilesError = String(error.message || error);
      state.wifiCapabilities = null;
      state.wifiCapabilitiesError = state.wifiProfilesError;
      state.wifiProfilesLoaded = true;
    } finally {
      state.wifiProfilesLoading = false;
      renderWifiPassword();
    }
  }

  async function loadWifiProfileDetail(name) {
    const profileName = String(name || '').trim();
    if (!profileName || !window.wifi || typeof window.wifi.wifiPassword !== 'function') return null;
    const cached = wifiPasswordDetail(profileName);
    if (cached && (cached.keyContent || cached.keyError || cached.error)) return cached;
    try {
      const result = await window.wifi.wifiPassword({ name: profileName });
      if (result && result.ok && result.profile) {
        const detail = { ...result.profile, revealed: false, error: null };
        state.wifiProfileDetails[profileName] = detail;
        return detail;
      }
      const detail = {
        name: profileName,
        keyContent: null,
        keyError: (result && (result.error || (result.profile && result.profile.keyError))) || '无法读取该网络的密码。',
        error: result && result.error ? result.error : null,
        revealed: false,
      };
      state.wifiProfileDetails[profileName] = detail;
      return detail;
    } catch (error) {
      const detail = { name: profileName, keyContent: null, keyError: String(error.message || error), revealed: false };
      state.wifiProfileDetails[profileName] = detail;
      return detail;
    }
  }

  async function toggleCurrentWifiPassword() {
    const current = wifiCurrent();
    if (!current || !current.ssid) {
      toast('当前没有无线连接', '请先连接 Wi-Fi，再核对密码。', 'warn');
      return;
    }
    if (state.wifiPasswordRevealed) {
      state.wifiPasswordRevealed = false;
      renderWifiPassword();
      return;
    }
    const detail = await loadWifiProfileDetail(current.ssid);
    if (!detail || !detail.keyContent) {
      state.wifiPasswordRevealed = false;
      renderWifiPassword();
      toast('无法读取 Wi-Fi 密码', (detail && (detail.keyError || detail.error)) || '系统没有返回密码明文。', 'warn', 5200);
      return;
    }
    state.wifiPasswordRevealed = true;
    renderWifiPassword();
  }

  async function copyCurrentWifiPassword() {
    const current = wifiCurrent();
    if (!current || !current.ssid) {
      toast('当前没有无线连接', '请先连接 Wi-Fi，再复制密码。', 'warn');
      return;
    }
    const detail = await loadWifiProfileDetail(current.ssid);
    if (!detail || !detail.keyContent) {
      toast('无法复制 Wi-Fi 密码', (detail && (detail.keyError || detail.error)) || '系统没有返回密码明文。', 'warn', 5200);
      return;
    }
    try {
      await window.wifi.copyText(detail.keyContent);
      toast('密码已复制', '请妥善保管，不要发送给不可信的人。', 'success', 3200);
    } catch (error) {
      toast('复制失败', String(error.message || error), 'error');
    }
  }

  async function toggleSavedWifiPassword(name) {
    const detail = await loadWifiProfileDetail(name);
    if (!detail) return;
    if (!detail.keyContent) {
      toast('无法读取 Wi-Fi 密码', detail.keyError || detail.error || '系统没有返回密码明文。', 'warn', 5200);
      return;
    }
    detail.revealed = !detail.revealed;
    renderWifiPassword();
  }

  async function copySavedWifiPassword(name) {
    const detail = await loadWifiProfileDetail(name);
    if (!detail || !detail.keyContent) {
      toast('无法复制 Wi-Fi 密码', (detail && (detail.keyError || detail.error)) || '系统没有返回密码明文。', 'warn', 5200);
      return;
    }
    try {
      await window.wifi.copyText(detail.keyContent);
      toast('密码已复制', name, 'success', 3200);
    } catch (error) {
      toast('复制失败', String(error.message || error), 'error');
    }
  }

  function setVerifyResult(tone, title, text) {
    const box = $('#wifiVerifyResult');
    if (!box) return;
    box.className = `password-verify-result ${tone}`;
    box.innerHTML = `<b>${esc(title)}</b><span>${esc(text || '')}</span>`;
  }

  async function verifyWifiPasswordFromForm() {
    const select = $('#wifiVerifyTarget');
    const input = $('#wifiPasswordInput');
    const name = select ? select.value : '';
    const password = input ? input.value : '';
    if (!name) {
      setVerifyResult('warn', '请选择网络', '先选择一个已保存的无线网络。');
      return;
    }
    if (!password) {
      setVerifyResult('warn', '请输入密码', '密码不会上传，只在本机与系统保存的凭据比对。');
      if (input) input.focus();
      return;
    }
    const button = $('#wifiVerifyBtn');
    const original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.innerHTML = `${icon('refresh')}核对中…`;
    }
    setVerifyResult('checking', '正在核对', '正在读取本机保存的无线配置…');
    try {
      const result = await window.wifi.wifiVerifyPassword({ name, password });
      if (!result || !result.ok) {
        setVerifyResult('warn', '暂时无法核对', (result && result.error) || '系统没有返回该网络的密码明文。');
        return;
      }
      if (result.match) {
        setVerifyResult('match', '密码一致', `${name} 与本机保存的凭据一致。`);
        if (input) input.value = '';
      } else {
        setVerifyResult('mismatch', '密码不一致', `${name} 与本机保存的凭据不一致，请重新输入。`);
      }
    } catch (error) {
      setVerifyResult('warn', '核对失败', String(error.message || error));
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original || `${icon('check')}核对`;
      }
    }
  }

  function connectSavedWifi(name) {
    const profileName = String(name || '').trim();
    if (!profileName) return;
    const current = wifiCurrent();
    if (current && current.ssid === profileName) {
      toast('已经连接到该网络', profileName, 'info', 2200);
      return;
    }
    confirmDialog({
      kicker: 'Wi-Fi 连接',
      title: `连接到「${profileName}」？`,
      body: `<p>将通过 Windows WLAN 接口连接这个已保存的网络。连接过程不会修改本机保存的密码。</p><div class="modal-risk">如果该网络不在范围内，Windows 会保持当前连接或提示失败。</div>`,
      confirmLabel: '连接网络',
      onConfirm: async () => {
        showLoading(`正在连接 ${profileName}…`);
        try {
          const result = await window.wifi.wifiConnect({ name: profileName });
          hideLoading();
          if (result && result.ok) {
            toast('已发送连接请求', profileName, 'success', 3200);
            setTimeout(() => refreshSnapshot(true, true), 2600);
          } else {
            toast('连接失败', (result && result.error) || 'Windows 未能连接该网络。', 'error', 5200);
          }
        } catch (error) {
          hideLoading();
          toast('连接失败', String(error.message || error), 'error');
        }
      },
    });
  }

  async function scanWifi(silent = false) {
    if (!window.wifi || typeof window.wifi.scanWifi !== 'function') return;
    const button = $('#scanWifiBtn');
    const original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.classList.add('spin');
      button.innerHTML = `${icon('refresh')}扫描中…`;
    }
    try {
      const result = await window.wifi.scanWifi();
      if (result && result.ok) {
        state.wifiScan = result;
        renderWifi();
        if (!silent) toast('Wi-Fi 扫描完成', `发现 ${result.networks ? result.networks.length : 0} 个网络。`, 'success', 2600);
      } else {
        state.wifiScan = { ok: false, networks: [], analysis: null, error: (result && result.error) || '扫描失败' };
        renderWifi();
        if (!silent) toast('Wi-Fi 扫描失败', (result && result.error) || '请确认无线网卡与 WLAN 服务可用。', 'warn', 4200);
      }
    } catch (error) {
      state.wifiScan = { ok: false, networks: [], analysis: null, error: String(error.message || error) };
      renderWifi();
      if (!silent) toast('Wi-Fi 扫描失败', String(error.message || error), 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('spin');
        button.innerHTML = original || `${icon('wifi-search')}扫描 Wi-Fi`;
      }
    }
  }

  /* =========================================================
     Connectivity lab
     ========================================================= */
  function connectivityPass(conn) {
    if (!conn || !Array.isArray(conn.results) || !conn.results.length) return false;
    return conn.results.every((result) => result.success);
  }

  function connectivityAverage(conn) {
    if (!conn || !Array.isArray(conn.results)) return null;
    const values = conn.results.filter((result) => result.success && result.avg != null).map((result) => Number(result.avg));
    if (!values.length) return null;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  }

  function connectivityDuration(conn) {
    if (!conn || !conn.startedAt || !conn.finishedAt) return null;
    const start = new Date(conn.startedAt).getTime();
    const end = new Date(conn.finishedAt).getTime();
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  }

  function renderConnectivity() {
    const banner = $('#connectivityBanner');
    const conn = state.connectivity;
    const gateway = gatewayOf(activeAdapter());
    const enabled = enabledTargets().length + (gateway ? 1 : 0);
    const results = state.connectivityResults || (conn && conn.results) || [];
    const reachable = results.filter((item) => item.success).length;
    const average = connectivityAverage(conn);
    const duration = connectivityDuration(conn);
    const running = state.connectivityRunning;
    const pass = connectivityPass(conn);

    if (banner) {
      banner.classList.toggle('running', running);
      banner.classList.toggle('pass', !running && Boolean(conn) && pass);
      banner.classList.toggle('fail', !running && Boolean(conn) && !pass);
      banner.classList.toggle('warn', !running && !conn);
    }
    const iconBox = $('#connHeroIcon');
    if (iconBox) {
      iconBox.innerHTML = icon(running ? 'activity' : conn ? (pass ? 'check' : 'alert') : 'globe');
      iconBox.classList.toggle('spin', running);
    }
    const verdict = $('#connVerdict');
    const text = $('#connVerdictText');
    if (verdict) {
      verdict.textContent = running ? '正在测试各厂商节点…' : conn ? (pass ? '全部节点连通' : '存在不可达节点') : '等待测试';
    }
    if (text) {
      if (running) text.textContent = `已收到 ${results.length} / ${state.connectivityExpected || enabled} 个节点结果，请稍候。`;
      else if (conn) {
        const failed = results.filter((item) => !item.success);
        text.textContent = pass
          ? `已启用的 ${results.length} 个节点全部可达，平均延迟 ${fmtMs(average)} ms。`
          : `${reachable} / ${results.length} 个节点可达${failed.length ? `，不可达：${failed.slice(0, 4).map((item) => item.name || item.host).join('、')}${failed.length > 4 ? ' 等' : ''}` : ''}。`;
      } else {
        text.textContent = gateway
          ? `将测试默认网关与 ${enabledTargets().length} 个已启用厂商 / DNS 节点。`
          : '选择需要测试的厂商节点，然后点击「一键全网连通测试」。';
      }
    }

    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value == null ? '--' : String(value);
    };
    setText('#connEnabled', running ? state.connectivityExpected || enabled : conn ? results.length : enabled);
    setText('#connReachable', conn ? reachable : '--');
    setText('#connAvg', conn && average != null ? `${fmtMs(average)} ms` : '--');
    setText('#connStatTotal', conn ? results.length : enabled);
    setText('#connStatReachable', conn ? reachable : '--');
    setText('#connStatAvg', conn && average != null ? `${fmtMs(average)} ms` : '--');
    setText('#connStatLoss', conn && conn.summary && conn.summary.averageLoss != null ? `${conn.summary.averageLoss}%` : '--');
    setText('#connStatDuration', duration != null ? fmtDuration(duration) : '--');

    const progress = $('#connProgressBar');
    const progressText = $('#connProgressText');
    if (progress) {
      const pct = running
        ? clamp(Math.round((results.length / Math.max(1, state.connectivityExpected || enabled)) * 100), 0, 100)
        : conn ? 100 : 0;
      progress.style.width = `${pct}%`;
      if (progressText) progressText.textContent = running ? `测试中 ${pct}%` : conn ? '测试完成' : '就绪';
    }
    renderConnectivityResults();
  }

  function renderConnectivityResults() {
    const box = $('#connectivityResults');
    if (!box) return;
    const results = state.connectivityResults || [];
    if (!results.length) {
      box.innerHTML = state.connectivityRunning
        ? '<div class="empty-state"><div class="loader-ring small"></div><h3>正在等待节点响应</h3><p>Ping 结果会逐个显示在这里。</p></div>'
        : '<div class="empty-state"><svg><use href="#i-globe"></use></svg><h3>还没有测试结果</h3><p>点击右上角「一键全网连通测试」开始。</p></div>';
      return;
    }
    box.innerHTML = results.map(renderPingCard).join('');
  }

  function renderPingCard(result) {
    const ok = Boolean(result.success);
    const optional = result.required === false;
    const latency = ok && result.avg != null ? fmtMs(result.avg) : null;
    const latencies = Array.isArray(result.latencies) ? result.latencies.slice(-10) : [];
    const sparkCount = Math.max(6, Math.min(12, result.count || 4));
    const max = Math.max(...latencies, 1);
    const spark = [];
    for (let i = 0; i < sparkCount; i += 1) {
      const value = latencies[i];
      if (value == null) {
        spark.push('<i class="miss"></i>');
      } else {
        const height = clamp(Math.round((Number(value) / max) * 100), 18, 100);
        spark.push(`<i class="ok" style="height:${height}%"></i>`);
      }
    }
    if (!latencies.length) {
      for (let i = 0; i < sparkCount; i += 1) spark[i] = '<i class="miss"></i>';
    }
    return `
      <div class="ping-card ${ok ? 'ok' : 'fail'}${optional ? ' optional' : ''}" title="${esc(result.errorText || '')}">
        <div class="ping-card-head">
          <span class="ping-status ${ok ? 'ok' : 'fail'}"></span>
          <div class="ping-name"><b>${esc(result.name || result.host)}</b><small>${esc(result.host || '')}</small></div>
          ${optional ? '<span class="ping-opt">可选</span>' : ''}
        </div>
        <div class="ping-card-body">
          <div class="ping-latency" style="color:${ok ? 'var(--text)' : 'var(--red)'}">${ok && latency ? `${latency}<small>ms</small>` : '不可达'}</div>
          <div class="ping-loss">丢包 ${result.lossPct == null ? '--' : `${result.lossPct}%`}</div>
        </div>
        <div class="ping-spark">${spark.join('')}</div>
        <div class="ping-card-footer">
          <span>${ok ? `${result.replies || 0}/${result.count || 0} 响应` : esc(result.status || '失败')}</span>
          <span>${ok && result.jitter != null ? `抖动 ${fmtMs(result.jitter)} ms` : esc(result.resolvedIp || '')}</span>
        </div>
      </div>`;
  }

  async function runConnectivity() {
    if (state.connectivityRunning) return;
    if (!window.wifi || typeof window.wifi.connectivity !== 'function') {
      toast('当前环境不支持连通性测试', '请使用桌面版 WiFiMedic Pro。', 'error');
      return;
    }
    if (state.currentView !== 'connectivity') switchView('connectivity');
    const targets = enabledTargets().map((target) => ({
      id: target.id,
      name: target.name,
      vendor: target.vendor,
      host: target.host,
      group: target.group,
      required: target.required !== false,
      note: target.note || '',
    }));
    const gateway = gatewayOf(activeAdapter());
    if (!targets.length && !gateway) {
      toast('没有可测试的目标', '请至少启用一个节点，或先连接可用网络。', 'warn');
      return;
    }
    state.connectivityRunning = true;
    state.connectivity = null;
    state.connectivityResults = [];
    state.connectivityStartedAt = Date.now();
    state.connectivityExpected = targets.length + (gateway ? 1 : 0);
    const button = $('#runConnectivityBtn');
    const original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.innerHTML = `${icon('refresh')}测试进行中…`;
      button.classList.add('spin');
    }
    renderConnectivity();
    try {
      const result = await window.wifi.connectivity({ targets, count: 4, timeout: 1200, concurrency: 5 });
      if (result && result.ok) {
        state.connectivity = result;
        state.connectivityResults = Array.isArray(result.results) ? result.results.slice() : state.connectivityResults;
        renderConnectivity();
        const pass = connectivityPass(result);
        toast(
          pass ? '连通性检查通过' : '连通性检查完成',
          pass ? '所有已启用节点均可连通。' : `${result.summary ? result.summary.reachable : state.connectivityResults.filter((item) => item.success).length} / ${state.connectivityResults.length} 个节点可达。`,
          pass ? 'success' : 'warn',
          4200,
        );
      } else {
        toast('连通性测试失败', (result && result.error) || '未知错误', 'error');
      }
    } catch (error) {
      toast('连通性测试失败', String(error.message || error), 'error');
    } finally {
      state.connectivityRunning = false;
      if (button) {
        button.disabled = false;
        button.classList.remove('spin');
        button.innerHTML = original || `${icon('zap')}一键全网连通测试`;
      }
      renderConnectivity();
    }
  }

  function connectivityText() {
    const conn = state.connectivity;
    const results = state.connectivityResults || [];
    if (!conn || !results.length) return '';
    const pass = connectivityPass(conn);
    const lines = [
      'WiFiMedic Pro · 连通性测试',
      `时间：${fmtDate(conn.finishedAt || conn.startedAt)}`,
      `通道：${conn.adapter ? `${conn.adapter.name}（${conn.adapter.type === 'wifi' ? '无线' : '有线'}）` : '未知'}`,
      `结果：${pass ? '通过 · 全部已启用节点可达' : '未通过 · 存在不可达节点'}`,
      `节点：${results.filter((item) => item.success).length}/${results.length} 可达 · 平均延迟 ${fmtMs(connectivityAverage(conn))} ms`,
      '',
      ...results.map((item) => `${item.success ? '[OK]' : '[FAIL]'} ${item.name || item.host} (${item.host}) · ${item.success ? `${fmtMs(item.avg)} ms` : '不可达'} · 丢包 ${item.lossPct == null ? '--' : `${item.lossPct}%`}`),
    ];
    return lines.join('\n');
  }

  async function copyConnectivity() {
    const text = connectivityText();
    if (!text) {
      toast('还没有可复制的测试结果', '请先运行一键连通测试。', 'warn');
      return;
    }
    try {
      await window.wifi.copyText(text);
      toast('已复制测试摘要', '可直接粘贴到聊天窗口或工单。', 'success', 2200);
    } catch (error) {
      toast('复制失败', String(error.message || error), 'error');
    }
  }

  async function exportConnectivity() {
    const conn = state.connectivity;
    const results = state.connectivityResults || [];
    if (!conn || !results.length) {
      toast('还没有可导出的结果', '请先运行一键连通测试。', 'warn');
      return;
    }
    const pass = connectivityPass(conn);
    const average = connectivityAverage(conn);
    const duration = connectivityDuration(conn);
    const report = {
      app: 'WiFiMedic Pro',
      version: '1.0.0',
      startedAt: conn.startedAt,
      finishedAt: conn.finishedAt,
      durationMs: duration,
      score: Math.round((results.filter((item) => item.success).length / results.length) * 100),
      status: pass ? 'pass' : 'fail',
      verdict: {
        status: pass ? 'pass' : 'fail',
        label: pass ? '全部连通' : '部分不可达',
        summary: pass ? '所有已启用节点均可连通。' : '存在不可达节点，请结合 TCP / HTTPS 结果进一步判断。',
      },
      stats: {
        latency: average,
        loss: conn.summary ? conn.summary.averageLoss : null,
        jitter: null,
        signal: wifiCurrent() ? wifiCurrent().signal : null,
        requiredPing: `${results.filter((item) => item.required !== false && item.success).length}/${results.filter((item) => item.required !== false).length}`,
        totalPing: `${results.filter((item) => item.success).length}/${results.length}`,
      },
      activeAdapter: conn.adapter ? { ...conn.adapter, kindLabel: conn.adapter.type === 'wifi' ? '无线' : '有线' } : null,
      stages: results.map((item) => ({
        id: item.id,
        label: item.name || item.host,
        icon: 'packet',
        status: item.success ? 'pass' : 'fail',
        summary: `${item.host} · ${item.success ? `${fmtMs(item.avg)} ms · 丢包 ${item.lossPct}%` : '不可达'}`,
        durationMs: item.durationMs || 0,
      })),
      issues: results
        .filter((item) => !item.success)
        .map((item) => ({
          severity: item.required === false ? 'info' : 'critical',
          title: `${item.name || item.host} 不可达`,
          detail: `目标 ${item.host} 未收到 ICMP 回复。部分厂商会主动屏蔽 Ping，请结合 TCP 443 / HTTPS 结果判断。`,
          fix: '检查本地网络、路由器防火墙与目标服务状态；必要时启用 TCP 测试。',
        })),
      summary: pass ? '所有已启用节点均可连通。' : '存在不可达节点。',
    };
    try {
      const result = await window.wifi.exportReport({ report, format: 'html' });
      if (result && result.ok) {
        toast('连通性报告已导出', result.path, 'success', 4200);
      } else if (result && !result.canceled) {
        toast('导出失败', result.error || '未知错误', 'error');
      }
    } catch (error) {
      toast('导出失败', String(error.message || error), 'error');
    }
  }

  /* =========================================================
     Full diagnostic
     ========================================================= */
  function setDiagProgress(pct, label, sub) {
    const bar = $('#diagProgressBar');
    const pctEl = $('#diagProgressPct');
    const labelEl = $('#diagProgressLabel');
    const subEl = $('#diagProgressSub');
    const value = clamp(Math.round(Number(pct) || 0), 0, 100);
    if (bar) bar.style.width = `${value}%`;
    if (pctEl) pctEl.textContent = `${value}%`;
    if (labelEl && label) labelEl.textContent = label;
    if (subEl && sub) subEl.textContent = sub;
  }

  function localizeLogMessage(value) {
    return String(value == null ? '' : value)
      .replace(/ · Up\b/g, ' · 已启用')
      .replace(/ · Disconnected\b/g, ' · 未连接')
      .replace(/ · Stopped\b/g, ' · 已停止')
      .replace(/ · Running\b/g, ' · 运行中')
      .replace(/ · Manual\b/g, ' · 手动')
      .replace(/ · DHCP\b/g, ' · 自动获取');
  }

  function appendDiagLog(level, message, time) {
    const box = $('#diagLog');
    if (!box) return;
    const kind = ['error', 'warn', 'success', 'stage'].includes(level) ? level : 'info';
    const tags = { error: '错误', warn: '注意', success: '完成', stage: '阶段', info: '系统' };
    const line = document.createElement('div');
    line.className = `console-line ${kind}`;
    line.innerHTML = `<span class="c-time">${esc(time ? fmtTime(time) : fmtTime())}</span><span class="c-tag">${tags[kind]}</span><span>${esc(localizeLogMessage(message))}</span>`;
    box.appendChild(line);
    while (box.children.length > 300) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function clearDiagLog() {
    const box = $('#diagLog');
    if (!box) return;
    box.innerHTML = '<div class="console-line info"><span class="c-time">--:--:--</span><span class="c-tag">系统</span><span>日志已清空，等待开始全面体检…</span></div>';
    const status = $('#consoleStatus');
    if (status) status.textContent = '空闲';
    const duration = $('#consoleDuration');
    if (duration) duration.textContent = '--';
  }

  function updateDiagDuration() {
    const el = $('#consoleDuration');
    if (!el) return;
    if (!state.diagRunning || !state.diagStartedAt) {
      el.textContent = '--';
      return;
    }
    el.textContent = fmtDuration(Date.now() - state.diagStartedAt);
  }

  function setDiagButtons(running) {
    const buttons = [$('#runDiagnosticBtn'), $('#runDiagnosticMainBtn'), $('#scoreRunBtn'), $('#quickFullBtn')];
    for (const button of buttons) {
      if (!button) continue;
      button.disabled = running;
    }
    const main = $('#runDiagnosticMainBtn');
    if (main) main.innerHTML = running ? `${icon('refresh')}体检进行中…` : `${icon('play')}开始体检`;
    const quick = $('#quickFullBtn');
    if (quick) {
      const text = quick.querySelector('b');
      if (text) text.textContent = running ? '体检进行中…' : '全面网络体检';
    }
  }

  function renderDiagnosticResult(report) {
    if (!report) return;
    const score = num(report.score, null);
    const tone = scoreTone(score);
    const scoreEl = $('#resultScore');
    if (scoreEl) {
      scoreEl.textContent = score == null ? '--' : String(score);
      scoreEl.style.color = TONE_COLORS[tone] || 'var(--cyan)';
      scoreEl.style.borderColor = score == null ? 'var(--line)' : `${TONE_COLORS[tone]}55`;
    }
    const title = $('#resultTitle');
    if (title) title.textContent = report.ok === false ? '体检未能完成' : `体检完成 · ${(report.verdict && report.verdict.label) || scoreLabel(score)}`;
    const summary = $('#resultSummary');
    if (summary) summary.textContent = report.ok === false ? report.error || '读取网络配置失败。' : (report.verdict && report.verdict.summary) || report.summary || '';
    const issues = Array.isArray(report.issues) ? report.issues : [];
    const issueBox = $('#resultIssues');
    if (issueBox) {
      issueBox.innerHTML = issues.length
        ? `<div class="issue-list">${issues.map(renderIssue).join('')}</div>`
        : '<div class="issue-item good"><span class="issue-sev"></span><div class="issue-copy"><b>未发现明显问题</b><p>所有检查阶段均未报告需要优先处理的风险。</p></div></div>';
    }
    const metrics = $('#resultMetrics');
    if (metrics) {
      const stats = report.stats || {};
      const adapter = report.selectedAdapter || report.activeAdapter;
      const rows = [
        ['平均延迟', stats.latency != null ? `${fmtMs(stats.latency)} ms` : '--'],
        ['丢包率', stats.loss != null ? `${stats.loss}%` : '--'],
        ['抖动', stats.jitter != null ? `${fmtMs(stats.jitter)} ms` : '--'],
        ['无线信号', stats.signal != null ? `${stats.signal}%` : (adapter && adapter.type === 'wifi' ? '--' : '未检测到')],
        ['必测节点', stats.requiredPing || '--'],
        ['全部节点', stats.totalPing || '--'],
        ['体检耗时', report.durationMs != null ? fmtDuration(report.durationMs) : '--'],
        ['诊断通道', adapter ? `${adapter.kindLabel || (adapter.type === 'wifi' ? '无线' : '有线')} · ${adapter.name}` : '--'],
      ];
      metrics.innerHTML = rows.map(([label, value]) => `<div class="result-metric"><span>${esc(label)}</span><b title="${esc(value)}">${esc(value)}</b></div>`).join('');
    }
    updateScoreRing(score, {
      label: report.verdict ? report.verdict.label : scoreLabel(score),
      summary: (report.verdict && report.verdict.summary) || report.summary || '',
      issueCount: issues.length,
      checkedText: `最近体检 ${fmtDateShort(report.finishedAt)}`,
      pill: report.verdict ? report.verdict.label : scoreLabel(score),
    });
    const heroTitle = $('#diagHeroTitle');
    const heroText = $('#diagHeroText');
    if (heroTitle) heroTitle.textContent = `体检完成 · ${(report.verdict && report.verdict.label) || scoreLabel(score)}`;
    if (heroText) heroText.textContent = `共 ${Array.isArray(report.stages) ? report.stages.length : 0} 项检查，发现 ${issues.length} 个关注项。详细结论与修复建议已生成。`;
  }

  function finishDiagnostic(report) {
    state.diagRunning = false;
    if (state.diagTimer) {
      clearInterval(state.diagTimer);
      state.diagTimer = null;
    }
    setDiagButtons(false);
    const status = $('#consoleStatus');
    if (status) status.textContent = report && report.ok !== false ? '已完成' : '失败';
    updateDiagDuration();
    if (!report) return;
    if (report.ok === false) {
      toast('体检失败', report.error || '无法读取网络配置。', 'error', 5000);
      renderDiagnosticResult(report);
      return;
    }
    if (state.lastReport && report.finishedAt && state.lastReport.finishedAt === report.finishedAt) return;
    state.lastReport = report;
    setDiagProgress(100, '体检完成', `${report.verdict ? report.verdict.label : ''} · ${report.durationMs != null ? fmtDuration(report.durationMs) : ''}`);
    renderDiagnosticResult(report);
    const tone = report.status === 'pass' ? 'success' : report.status === 'fail' ? 'error' : 'warn';
    toast(
      '全面体检完成',
      `${report.score} 分 · ${report.verdict ? report.verdict.label : ''} · 发现 ${(report.issues || []).length} 个关注项`,
      tone,
      4600,
    );
    loadHistory(true);
  }

  async function runDiagnostic() {
    if (state.diagRunning) return;
    if (!window.wifi || typeof window.wifi.runDiagnostics !== 'function') {
      toast('当前环境不支持全面体检', '请使用桌面版 WiFiMedic Pro。', 'error');
      return;
    }
    if (state.currentView !== 'diagnostic') switchView('diagnostic');
    state.diagRunning = true;
    state.diagStartedAt = Date.now();
    state.lastReport = null;
    state.diagStageDone = new Set();
    resetStageList();
    clearDiagLog();
    setDiagButtons(true);
    setDiagProgress(0, '正在准备…', '检查期间请保持网络连接');
    const heroTitle = $('#diagHeroTitle');
    const heroText = $('#diagHeroText');
    if (heroTitle) heroTitle.textContent = '正在读取系统环境…';
    if (heroText) heroText.textContent = '将依次执行 14 项检查，预计耗时 40–70 秒。';
    const status = $('#consoleStatus');
    if (status) status.textContent = '运行中';
    if (state.diagTimer) clearInterval(state.diagTimer);
    state.diagTimer = setInterval(updateDiagDuration, 1000);
    updateDiagDuration();
    try {
      const report = await window.wifi.runDiagnostics({
        ifIndex: state.selectedIfIndex != null ? Number(state.selectedIfIndex) : undefined,
        forceSnapshot: true,
      });
      finishDiagnostic(report);
    } catch (error) {
      finishDiagnostic({ ok: false, error: String(error.message || error), issues: [], stages: [], stats: {} });
    }
  }

  function handleDiagnosticEvent(event) {
    if (!event || !event.type) return;
    if (event.type === 'diagnostic-start') {
      state.diagStartedAt = event.startedAt ? new Date(event.startedAt).getTime() : Date.now();
      const total = event.totalStages || (state.meta && state.meta.stageDefs ? state.meta.stageDefs.length : 14);
      setDiagProgress(0, '开始体检', `共 ${total} 项检查`);
      return;
    }
    if (event.type === 'log') {
      appendDiagLog(event.level, event.message, event.time);
      return;
    }
    if (event.type === 'stage-start') {
      setStageState(event.id, 'running', '正在检查…');
      const pct = event.total ? ((event.index - 1) / event.total) * 100 : 0;
      setDiagProgress(pct, `正在检查：${event.label || event.id}`, `第 ${event.index || '--'} / ${event.total || '--'} 项`);
      const heroTitle = $('#diagHeroTitle');
      if (heroTitle) heroTitle.textContent = `正在检查：${event.label || event.id}`;
      const status = $('#consoleStatus');
      if (status) status.textContent = '运行中';
      return;
    }
    if (event.type === 'stage-end') {
      const stage = event.stage || event;
      setStageState(stage.id, stage.status, stage.summary);
      state.diagStageDone.add(String(stage.id));
      const total = (state.meta && state.meta.stageDefs ? state.meta.stageDefs.length : 14) || 14;
      const pct = (state.diagStageDone.size / total) * 100;
      setDiagProgress(pct, `已完成 ${state.diagStageDone.size} / ${total} 项`, stage.label || '');
      const pill = $('#stageCountPill');
      if (pill) pill.textContent = `${state.diagStageDone.size} / ${total}`;
      return;
    }
    if (event.type === 'diagnostic-complete') {
      finishDiagnostic(event.report);
    }
  }

  /* =========================================================
     Speed test / deep stability
     ========================================================= */
  function setSpeedGauge(mbps) {
    const value = num(mbps, 0);
    const gauge = $('#speedGauge');
    const label = $('#speedValue');
    if (gauge) gauge.style.setProperty('--speed-pct', String(clamp((value / 200) * 75, 0, 75)));
    if (label) label.textContent = value > 0 ? fmtMbps(value) : '--';
  }

  function setSpeedProgress(pct, text) {
    const bar = $('#speedProgressBar');
    const label = $('#speedProgressText');
    if (bar) bar.style.width = `${clamp(Math.round(Number(pct) || 0), 0, 100)}%`;
    if (label) label.textContent = text || '--';
  }

  function setSpeedPill(text, tone = '') {
    const pill = $('#speedStatePill');
    if (!pill) return;
    pill.textContent = text;
    pill.className = `mini-pill ${tone}`;
  }

  function renderSpeedResult(result) {
    const download = result && result.download && result.download.ok ? result.download.mbps : null;
    const upload = result && result.upload && result.upload.ok ? result.upload.mbps : null;
    const idle = result && result.latency ? result.latency.idle : null;
    const increase = result && result.latency ? result.latency.increase : null;
    const grade = result && result.latency ? result.latency.grade : null;
    setSpeedGauge(download || 0);
    const downloadEl = $('#speedDownload');
    const uploadEl = $('#speedUpload');
    const idleEl = $('#speedIdle');
    const bufferEl = $('#speedBufferbloat');
    if (downloadEl) downloadEl.textContent = download != null ? `${fmtMbps(download)} Mbps` : '失败';
    if (uploadEl) uploadEl.textContent = upload != null ? `${fmtMbps(upload)} Mbps` : '未测试';
    if (idleEl) idleEl.textContent = idle != null ? `${fmtMs(idle)} ms` : '--';
    if (bufferEl) bufferEl.textContent = increase != null ? `+${fmtMs(increase)} ms · ${grade}` : '--';
    const note = $('#speedNote');
    if (note) note.textContent = (result && result.note) || '单线程测速，结果受测速节点、运营商与 Wi-Fi 环境影响。';
    setSpeedProgress(100, '测速完成');
    setSpeedPill(download != null ? '完成' : '失败', download != null ? 'good' : 'bad');
  }

  function handleSpeedProgress(progress) {
    if (!state.speedRunning || !progress) return;
    if (progress.phase === 'download-connecting') {
      setSpeedPill('连接节点', 'live');
      setSpeedProgress(4, `正在连接 ${progress.endpoint || '测速节点'}…`);
      return;
    }
    if (progress.phase === 'download') {
      setSpeedGauge(progress.mbps || 0);
      const pct = 8 + clamp((Number(progress.elapsedMs) || 0) / 9000, 0, 1) * 72;
      setSpeedProgress(pct, `下载 ${fmtMbps(progress.mbps)} Mbps`);
      setSpeedPill('下载中', 'live');
      return;
    }
    if (progress.phase === 'upload-connecting') {
      setSpeedPill('准备上传', 'live');
      setSpeedProgress(86, '正在准备上传测试…');
      return;
    }
    if (progress.phase === 'upload') {
      setSpeedProgress(90 + clamp((Number(progress.elapsedMs) || 0) / 12000, 0, 1) * 9, `上传 ${fmtMbps(progress.mbps)} Mbps`);
      setSpeedPill('上传中', 'live');
    }
  }

  async function runSpeed() {
    if (state.speedRunning) return;
    if (!window.wifi || typeof window.wifi.speedTest !== 'function') {
      toast('当前环境不支持测速', '请使用桌面版 WiFiMedic Pro。', 'error');
      return;
    }
    if (state.currentView !== 'stability') switchView('stability');
    state.speedRunning = true;
    const button = $('#runSpeedBtn');
    const original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.classList.add('spin');
      button.innerHTML = `${icon('refresh')}测速中…`;
    }
    setSpeedGauge(0);
    setSpeedProgress(0, '正在准备测速…');
    setSpeedPill('准备中', 'live');
    const downloadEl = $('#speedDownload');
    const uploadEl = $('#speedUpload');
    const idleEl = $('#speedIdle');
    const bufferEl = $('#speedBufferbloat');
    if (downloadEl) downloadEl.textContent = '--';
    if (uploadEl) uploadEl.textContent = '--';
    if (idleEl) idleEl.textContent = '--';
    if (bufferEl) bufferEl.textContent = '--';
    const includeUpload = Boolean($('#includeUploadToggle') && $('#includeUploadToggle').checked);
    try {
      const result = await window.wifi.speedTest({ includeUpload, durationMs: 9000 });
      if (result && result.ok) {
        renderSpeedResult(result);
        toast('测速完成', `下载 ${fmtMbps(result.download && result.download.mbps)} Mbps${result.upload && result.upload.ok ? ` · 上传 ${fmtMbps(result.upload.mbps)} Mbps` : ''}`, 'success', 4000);
      } else {
        setSpeedPill('失败', 'bad');
        setSpeedProgress(0, '测速失败');
        toast('测速失败', (result && result.error) || '无法连接测速节点，请稍后重试。', 'error', 4200);
      }
    } catch (error) {
      setSpeedPill('失败', 'bad');
      setSpeedProgress(0, '测速失败');
      toast('测速失败', String(error.message || error), 'error');
    } finally {
      state.speedRunning = false;
      if (button) {
        button.disabled = false;
        button.classList.remove('spin');
        button.innerHTML = original || `${icon('speed')}开始测速`;
      }
    }
  }

  function renderDeepStability(result) {
    const box = $('#deepStabilityResult');
    if (!box) return;
    if (!result || !result.ok) {
      box.innerHTML = `<div class="empty-state small"><p>${esc((result && result.error) || '深度采样失败。')}</p></div>`;
      return;
    }
    const internet = result.internet || {};
    const gateway = result.gateway || null;
    const stats = [
      ['外网平均延迟', internet.avg != null ? `${fmtMs(internet.avg)} ms` : '--'],
      ['外网丢包', internet.lossPct != null ? `${internet.lossPct}%` : '--'],
      ['外网抖动', internet.jitter != null ? `${fmtMs(internet.jitter)} ms` : '--'],
      ['外网最大延迟', internet.max != null ? `${fmtMs(internet.max)} ms` : '--'],
    ];
    if (gateway) {
      stats.push(['网关平均延迟', gateway.avg != null ? `${fmtMs(gateway.avg)} ms` : '--']);
      stats.push(['网关丢包', gateway.lossPct != null ? `${gateway.lossPct}%` : '--']);
    }
    const latencies = Array.isArray(internet.latencies) ? internet.latencies.slice(-20) : [];
    const max = Math.max(...latencies, 1);
    const bars = latencies.length
      ? latencies.map((value) => `<i style="height:${clamp(Math.round((Number(value) / max) * 100), 8, 100)}%"></i>`).join('')
      : '<i style="height:8%"></i>';
    box.innerHTML = `
      <div class="deep-stability-grid">${stats.map(([label, value]) => `<div class="deep-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>
      <div class="deep-bar" title="最近 ${latencies.length} 次外网延迟">${bars}</div>
      <p style="margin:10px 0 0;color:var(--muted-2);font-size:8px;line-height:1.5">共 ${result.count || 0} 次采样。${internet.success ? `成功 ${internet.replies || 0} 次。` : '外网采样不可达。'}${gateway ? ` 网关 ${gateway.success ? '正常' : '不可达'}。` : ''}</p>`;
  }

  async function runStabilityDeep() {
    if (!window.wifi || typeof window.wifi.stability !== 'function') return;
    const button = $('#runStabilityDeepBtn');
    const box = $('#deepStabilityResult');
    if (button) button.disabled = true;
    if (box) box.innerHTML = '<div class="empty-state small"><div class="loader-ring small"></div><p>正在进行 20 次网关与外网采样…</p></div>';
    try {
      const result = await window.wifi.stability({ count: 20 });
      renderDeepStability(result);
      if (result && result.ok) toast('深度采样完成', `外网丢包 ${result.internet ? result.internet.lossPct : '--'}% · 抖动 ${result.internet && result.internet.jitter != null ? `${fmtMs(result.internet.jitter)} ms` : '--'}`, 'success', 3200);
    } catch (error) {
      renderDeepStability({ ok: false, error: String(error.message || error) });
      toast('深度采样失败', String(error.message || error), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* =========================================================
     Repair toolkit
     ========================================================= */
  function repairActionById(id) {
    return repairActions().find((action) => String(action.id) === String(id)) || null;
  }

  function renderRepairLogs() {
    const box = $('#repairLog');
    if (!box) return;
    if (!state.repairLogs.length) {
      box.innerHTML = '<div class="empty-state small"><p>执行修复操作后，这里会显示命令输出与结果。</p></div>';
      return;
    }
    box.innerHTML = state.repairLogs
      .map((entry) => {
        const time = fmtTime(entry.time);
        const output = String(entry.output || entry.error || '').trim();
        return `
          <div class="log-line"><span class="log-time">${esc(time)}</span><span class="${entry.ok ? 'log-ok' : 'log-err'}">${entry.ok ? '[OK]' : '[FAIL]'}</span><span>${esc(entry.name || entry.action || '修复操作')}${entry.durationMs != null ? ` · ${fmtDuration(entry.durationMs)}` : ''}</span></div>
          ${output ? `<div class="log-line"><span class="log-time"></span><span class="log-cmd"></span><span style="white-space:pre-wrap;word-break:break-word">${esc(output).replace(/\n/g, '<br>')}</span></div>` : ''}`;
      })
      .join('');
    box.scrollTop = box.scrollHeight;
  }

  function pushRepairLog(entry) {
    state.repairLogs.push(entry);
    if (state.repairLogs.length > 24) state.repairLogs.splice(0, state.repairLogs.length - 24);
    renderRepairLogs();
  }

  async function executeRepair(action) {
    if (!action) return;
    showLoading(`正在执行：${action.name}…`);
    try {
      const adapter = activeAdapter();
      const result = await window.wifi.repair({
        action: action.id,
        ifIndex: state.selectedIfIndex != null ? Number(state.selectedIfIndex) : adapter ? adapter.interfaceIndex : undefined,
      });
      hideLoading();
      if (result && result.needsAdmin) {
        openModal({
          kicker: '需要管理员权限',
          title: '需要管理员权限',
          body: `<p>${esc(result.error || '该操作需要管理员权限。')}</p><div class="modal-risk">请以管理员身份重启应用后重试。当前不会修改任何系统设置。</div>`,
          actions: [{ label: '取消', style: 'ghost' }, { label: '管理员重启', style: 'primary', onClick: relaunchAdmin }],
        });
        return;
      }
      pushRepairLog({
        time: new Date().toISOString(),
        ok: Boolean(result && result.ok),
        name: action.name,
        action: action.id,
        output: (result && result.output) || (result && result.error) || '',
        error: result && result.error,
        durationMs: result && result.durationMs,
      });
      if (result && result.ok) {
        toast('修复操作已完成', action.name, 'success', 3000);
        if (result.needsReboot) {
          toast('需要重启电脑', 'Winsock / TCP/IP 重置需要重启后才会完全生效。', 'warn', 7000);
        }
        await refreshSnapshot(true, true);
      } else {
        toast('修复操作失败', (result && result.error) || '请查看执行日志。', 'error', 5000);
      }
    } catch (error) {
      hideLoading();
      pushRepairLog({ time: new Date().toISOString(), ok: false, name: action.name, action: action.id, output: String(error.message || error), error: String(error.message || error) });
      toast('修复操作失败', String(error.message || error), 'error');
    }
  }

  function runRepairAction(id) {
    const action = repairActionById(id);
    if (!action) return;
    if (action.admin && !state.admin) {
      openModal({
        kicker: '需要管理员权限',
        title: '需要管理员权限',
        body: `<p><b>${esc(action.name)}</b> 需要修改系统网络设置。</p><div class="modal-risk">请以管理员身份重启应用后重试。当前不会执行任何修改。若没有出现 UAC 弹窗，请关闭应用后右键 EXE，选择“以管理员身份运行”。</div>`,
        actions: [{ label: '取消', style: 'ghost' }, { label: '管理员重启', style: 'primary', onClick: relaunchAdmin }],
      });
      return;
    }
    const risk = action.risk === 'danger' ? 'danger' : action.risk === 'caution' ? 'warn' : 'info';
    confirmDialog({
      kicker: '修复操作',
      title: action.name,
      body: `<p>${esc(action.description || '')}</p><div class="modal-risk ${risk === 'danger' ? 'danger' : ''}">${risk === 'danger' ? '高风险操作：' : risk === 'warn' ? '注意：' : ''}${esc(action.command || '')}</div><p style="margin-top:9px;color:var(--muted-2);font-size:9px">执行输出会记录在下方日志中。${action.risk === 'danger' ? '该操作可能需要重启电脑。' : ''}</p>`,
      confirmLabel: '执行操作',
      danger: action.risk === 'danger',
      onConfirm: () => executeRepair(action),
    });
  }

  function clearRepairLogs() {
    state.repairLogs = [];
    renderRepairLogs();
    toast('执行日志已清空', '', 'info', 2000);
  }

  async function relaunchAdmin() {
    if (state.admin) {
      toast('当前已是管理员权限', '无需重复启动。', 'info', 2200);
      return;
    }
    showLoading('等待 Windows 管理员授权…');
    try {
      const result = await window.wifi.relaunchAdmin();
      hideLoading();
      if (result && result.ok) {
        toast(result.alreadyAdmin ? '当前已是管理员权限' : '正在以管理员身份重启', result.alreadyAdmin ? '' : '请在系统弹窗中确认授权。', 'success', 4200);
      } else {
        toast('管理员重启失败', (result && result.error) || '用户取消了授权，或启动失败。', 'error', 6000);
      }
    } catch (error) {
      hideLoading();
      toast('管理员重启失败', String(error.message || error), 'error', 6000);
    }
  }

  async function openSettings(page) {
    try {
      await window.wifi.openSettings(page);
    } catch (error) {
      toast('无法打开 Windows 设置', String(error.message || error), 'error');
    }
  }

  async function openDataDir() {
    try {
      const result = await window.wifi.openDataDir();
      if (result && result.ok) toast('已打开数据目录', result.path, 'success', 2600);
      else toast('无法打开数据目录', (result && result.error) || '', 'error');
    } catch (error) {
      toast('无法打开数据目录', String(error.message || error), 'error');
    }
  }

  /* =========================================================
     Reports / history
     ========================================================= */
  function renderHistory() {
    const box = $('#historyList');
    const pill = $('#historyCountPill');
    if (!box) return;
    if (pill) pill.textContent = `${state.history.length} 份`;
    if (!state.history.length) {
      box.innerHTML = '<div class="empty-state small"><svg><use href="#i-file"></use></svg><p>完成一次全面体检后，报告会自动保存在这里。</p></div>';
      return;
    }
    box.innerHTML = state.history
      .map((entry) => {
        const tone = scoreTone(entry.score);
        const active = String(entry.id) === String(state.selectedReportId);
        const verdict = entry.verdict && entry.verdict.label ? entry.verdict.label : scoreLabel(entry.score);
        return `
          <div class="history-item${active ? ' active' : ''}" data-report-id="${esc(entry.id)}" role="button" tabindex="0">
            <div class="history-score ${tone}">${entry.score == null ? '--' : esc(entry.score)}</div>
            <div class="history-copy">
              <b>${esc(verdict)} · ${entry.score == null ? '--' : esc(entry.score)} 分</b>
              <small>${esc(fmtDateShort(entry.createdAt))} · ${esc(entry.adapter ? entry.adapter.name : '未知通道')}</small>
            </div>
            <div class="history-meta"><span>${esc(entry.issueCount == null ? 0 : entry.issueCount)} 个问题</span><b>${esc(entry.durationMs != null ? fmtDuration(entry.durationMs) : '--')}</b></div>
          </div>`;
      })
      .join('');
  }

  function renderReportDetailEmpty() {
    const box = $('#reportDetail');
    const tools = $('#reportDetailTools');
    if (tools) tools.innerHTML = '';
    if (box) {
      box.innerHTML = '<div class="empty-state"><svg><use href="#i-file"></use></svg><h3>尚未选择报告</h3><p>从左侧选择一份历史报告，或先完成一次全面体检。</p></div>';
    }
  }

  function renderReportDetail(report, meta = {}) {
    const box = $('#reportDetail');
    const tools = $('#reportDetailTools');
    if (!box) return;
    if (!report) {
      renderReportDetailEmpty();
      return;
    }
    const score = num(report.score, null);
    const tone = scoreTone(score);
    const verdict = report.verdict || {};
    const issues = Array.isArray(report.issues) ? report.issues : [];
    const stages = Array.isArray(report.stages) ? report.stages : [];
    const adapter = report.selectedAdapter || report.activeAdapter;
    const created = meta.createdAt || report.finishedAt || report.startedAt;
    if (tools) {
      tools.innerHTML = `
        <button class="text-btn muted" data-report-export="html">${icon('file')}HTML</button>
        <button class="text-btn muted" data-report-export="json">${icon('database')}JSON</button>
        <button class="text-btn muted" data-report-export="txt">${icon('log')}TXT</button>`;
    }
    box.innerHTML = `
      <div class="report-detail-head">
        <div class="report-detail-score ${tone}">${score == null ? '--' : score}</div>
        <div class="report-detail-copy">
          <h2>${esc(verdict.label || scoreLabel(score))} · ${score == null ? '--' : score} 分</h2>
          <p>${esc(fmtDate(created))} · ${esc(adapter ? `${adapter.kindLabel || (adapter.type === 'wifi' ? '无线' : '有线')} · ${adapter.name}` : '未知通道')} · 耗时 ${esc(report.durationMs != null ? fmtDuration(report.durationMs) : '--')}</p>
          <div class="report-detail-actions">
            <button class="btn ghost small" data-report-export="html">${icon('file')}导出 HTML</button>
            <button class="btn ghost small" data-report-export="json">${icon('database')}JSON</button>
            <button class="btn ghost small" data-report-copy>${icon('copy')}复制摘要</button>
          </div>
        </div>
      </div>
      <div class="report-issues">
        ${issues.length ? issues.map(renderIssue).join('') : '<div class="issue-item good"><span class="issue-sev"></span><div class="issue-copy"><b>未发现明显问题</b><p>本次体检没有报告需要优先处理的风险。</p></div></div>'}
      </div>
      <div class="report-stage-list">
        ${stages
          .map((stage) => `<div class="report-stage-row" title="${esc(localizeReportText(stage.summary || ''))}"><span class="dot ${esc(stage.status || 'info')}"></span><b>${esc(stage.label || stage.id || '检查')}</b><span>${esc(localizeReportText(stage.summary || ''))}</span><em>${esc(stage.durationMs != null ? fmtDuration(stage.durationMs) : '')}</em></div>`)
          .join('') || '<div class="empty-state small"><p>报告中没有阶段明细。</p></div>'}
      </div>`;
  }

  async function selectReport(id, silent = false) {
    if (!id) return;
    state.selectedReportId = String(id);
    renderHistory();
    if (!window.wifi || typeof window.wifi.historyItem !== 'function') return;
    try {
      const result = await window.wifi.historyItem(id);
      if (result && result.ok && result.entry) {
        state.selectedReport = result.entry.report;
        renderReportDetail(result.entry.report, result.entry);
        if (!state.lastReport) {
          state.lastReport = result.entry.report;
          renderDashboard();
        }
        if (!silent && state.currentView !== 'reports') switchView('reports');
      } else {
        state.selectedReport = null;
        renderReportDetailEmpty();
        if (!silent) toast('无法读取报告', (result && result.error) || '报告可能已被清理。', 'error');
      }
    } catch (error) {
      state.selectedReport = null;
      renderReportDetailEmpty();
      if (!silent) toast('无法读取报告', String(error.message || error), 'error');
    }
  }

  async function loadHistory(silent = false) {
    if (!window.wifi || typeof window.wifi.history !== 'function') return;
    try {
      const result = await window.wifi.history();
      if (result && result.ok) {
        state.history = Array.isArray(result.history) ? result.history : [];
        if (state.selectedReportId && !state.history.some((entry) => String(entry.id) === String(state.selectedReportId))) {
          state.selectedReportId = null;
          state.selectedReport = null;
        }
        renderHistory();
        if (!state.history.length) {
          renderReportDetailEmpty();
        } else if (!state.selectedReportId) {
          await selectReport(state.history[0].id, true);
        } else if (state.selectedReport) {
          renderReportDetail(state.selectedReport, state.history.find((entry) => String(entry.id) === String(state.selectedReportId)) || {});
        }
      } else if (!silent) {
        toast('无法读取历史报告', (result && result.error) || '未知错误', 'warn');
      }
    } catch (error) {
      if (!silent) toast('无法读取历史报告', String(error.message || error), 'warn');
    }
  }

  function reportSummaryText(report) {
    if (!report) return '';
    const issues = Array.isArray(report.issues) ? report.issues : [];
    const lines = [
      `WiFiMedic Pro · 网络体检报告`,
      `时间：${fmtDate(report.finishedAt || report.startedAt)}`,
      `评分：${report.score == null ? '--' : report.score} 分 · ${(report.verdict && report.verdict.label) || scoreLabel(report.score)}`,
      `通道：${report.activeAdapter ? `${report.activeAdapter.name}（${report.activeAdapter.kindLabel || report.activeAdapter.type || '--'}）` : '未知'}`,
      `耗时：${report.durationMs != null ? fmtDuration(report.durationMs) : '--'}`,
      `问题：${issues.length} 个`,
      '',
      '关键指标：',
      `- 平均延迟：${report.stats && report.stats.latency != null ? `${fmtMs(report.stats.latency)} ms` : '--'}`,
      `- 丢包率：${report.stats && report.stats.loss != null ? `${report.stats.loss}%` : '--'}`,
      `- 抖动：${report.stats && report.stats.jitter != null ? `${fmtMs(report.stats.jitter)} ms` : '--'}`,
      `- 必测节点：${report.stats && report.stats.requiredPing ? report.stats.requiredPing : '--'}`,
      '',
      '发现项：',
      ...(issues.length ? issues.map((issue) => `- [${severityLabel(issue.severity)}] ${issue.title}${issue.fix ? `（建议：${issue.fix}）` : ''}`) : ['- 未发现明显问题']),
    ];
    return lines.join('\n');
  }

  async function copyReportSummary(report) {
    const value = report || state.selectedReport || state.lastReport;
    if (!value) {
      toast('没有可复制的报告', '请先完成一次全面体检。', 'warn');
      return;
    }
    try {
      await window.wifi.copyText(reportSummaryText(value));
      toast('已复制报告摘要', '', 'success', 2200);
    } catch (error) {
      toast('复制失败', String(error.message || error), 'error');
    }
  }

  async function exportReport(format = 'html', report) {
    const value = report || state.selectedReport || state.lastReport;
    if (!value) {
      toast('没有可导出的报告', '请先完成一次全面体检。', 'warn');
      return;
    }
    try {
      const result = await window.wifi.exportReport({ report: value, format });
      if (result && result.ok) {
        toast('报告已导出', result.path, 'success', 5000);
        openModal({
          kicker: '导出完成',
          title: '报告已保存',
          body: `<p>已生成 <b>${esc(String(format).toUpperCase())}</b> 报告：</p><div class="data-path">${esc(result.path)}</div><p style="color:var(--muted-2);font-size:9px">报告包含评分、问题清单、阶段明细与关键指标。</p>`,
          actions: [{ label: '关闭', style: 'ghost' }, { label: '打开所在文件夹', style: 'primary', onClick: () => { closeModal(); window.wifi.showItem(result.path); } }],
        });
      } else if (result && !result.canceled) {
        toast('导出失败', result.error || '未知错误', 'error');
      }
    } catch (error) {
      toast('导出失败', String(error.message || error), 'error');
    }
  }

  function clearHistory() {
    confirmDialog({
      kicker: '清空历史',
      title: '清空全部历史报告？',
      body: '<p>将删除本机保存的全部体检历史与报告文件，此操作不可撤销。当前网络配置不会受到影响。</p>',
      confirmLabel: '清空历史',
      danger: true,
      onConfirm: async () => {
        showLoading('正在清空历史报告…');
        try {
          const result = await window.wifi.clearHistory();
          hideLoading();
          if (result && result.ok) {
            state.history = [];
            state.selectedReport = null;
            state.selectedReportId = null;
            renderHistory();
            renderReportDetailEmpty();
            toast('历史报告已清空', '', 'success', 2400);
          } else {
            toast('清空失败', (result && result.error) || '未知错误', 'error');
          }
        } catch (error) {
          hideLoading();
          toast('清空失败', String(error.message || error), 'error');
        }
      },
    });
  }

  /* =========================================================
     Settings
     ========================================================= */
  async function updateToggleSetting(patch, successMessage) {
    await saveSettings(patch);
    if (successMessage) toast(successMessage, '', 'success', 2000);
  }

  function bindSettingsControls() {
    const scaleControl = $('#uiScaleControl');
    if (scaleControl) {
      scaleControl.addEventListener('click', (event) => {
        const button = event.target.closest('[data-ui-scale]');
        if (!button) return;
        const next = normalizeUiScale(button.dataset.uiScale);
        const current = normalizeUiScale(state.settings && state.settings.uiScale);
        if (next === current) return;
        const label = next === 1 ? '标准' : next === 1.35 ? '特大' : '舒适';
        applyUiScale(next, true).then(() => toast('界面字号已调整', `当前为“${label}”显示比例。`, 'success', 2200)).catch(() => {});
      });
    }
    const autoSave = $('#autoSaveToggle');
    if (autoSave) {
      autoSave.addEventListener('change', () => updateToggleSetting({ autoSaveHistory: autoSave.checked }, autoSave.checked ? '已开启自动保存' : '已关闭自动保存'));
    }
    const upload = $('#uploadToggle');
    const upload2 = $('#includeUploadToggle');
    const syncUpload = (checked) => {
      if (upload) upload.checked = checked;
      if (upload2) upload2.checked = checked;
      if (state.settings) state.settings.includeUploadInSpeedTest = checked;
    };
    if (upload) {
      upload.addEventListener('change', () => {
        syncUpload(upload.checked);
        updateToggleSetting({ includeUploadInSpeedTest: upload.checked }, upload.checked ? '测速将同时测试上传' : '测速将跳过上传');
      });
    }
    if (upload2) {
      upload2.addEventListener('change', () => {
        syncUpload(upload2.checked);
        updateToggleSetting({ includeUploadInSpeedTest: upload2.checked }, upload2.checked ? '测速将同时测试上传' : '测速将跳过上传');
      });
    }
    const theme = $('#themeToggle');
    if (theme) {
      theme.addEventListener('change', () => applyTheme(theme.checked ? 'light' : 'dark', true));
    }
  }

  /* =========================================================
     Render all / event wiring
     ========================================================= */
  function renderAll() {
    renderAdmin();
    renderSystemInfo();
    renderDashboard();
    renderChannels();
    renderWifi();
    renderWifiPassword();
    renderConnectivityTargets();
    renderConnectivity();
    renderRepairCards();
    renderRepairLogs();
    renderMonitorButtons();
    renderCharts();
    if (!$('#stageList .stage-item')) renderStageList();
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      const modalAction = target.closest('[data-modal-action]');
      if (modalAction) {
        const index = Number(modalAction.dataset.modalAction);
        const action = state.modalActions[index];
        if (action && typeof action.onClick === 'function') action.onClick();
        else closeModal();
        return;
      }
      const nav = target.closest('.nav-item[data-view]');
      if (nav) {
        switchView(nav.dataset.view);
        return;
      }
      const profileReveal = target.closest('[data-profile-reveal]');
      if (profileReveal) {
        event.stopPropagation();
        toggleSavedWifiPassword(profileReveal.dataset.profileReveal);
        return;
      }
      const profileCopy = target.closest('[data-profile-copy]');
      if (profileCopy) {
        event.stopPropagation();
        copySavedWifiPassword(profileCopy.dataset.profileCopy);
        return;
      }
      const profileConnect = target.closest('[data-profile-connect]');
      if (profileConnect) {
        event.stopPropagation();
        connectSavedWifi(profileConnect.dataset.profileConnect);
        return;
      }
      if (target.closest('#wifiProfilesRetryBtn')) {
        loadWifiProfiles(true);
        return;
      }
      const deleteTarget = target.closest('[data-target-delete]');
      if (deleteTarget) {
        event.stopPropagation();
        removeCustomTarget(deleteTarget.dataset.targetDelete);
        return;
      }
      const targetItem = target.closest('[data-target-id]');
      if (targetItem) {
        toggleTarget(targetItem.dataset.targetId);
        return;
      }
      const adapterAction = target.closest('[data-adapter-action]');
      if (adapterAction) {
        const ifIndex = adapterAction.dataset.ifIndex;
        if (adapterAction.dataset.adapterAction === 'check') checkLine(ifIndex);
        else if (adapterAction.dataset.adapterAction === 'priority') setPriority(ifIndex);
        else showAdapterDetail(ifIndex);
        return;
      }
      const repair = target.closest('[data-repair-run]');
      if (repair) {
        runRepairAction(repair.dataset.repairRun);
        return;
      }
      const settingsPage = target.closest('[data-settings-page]');
      if (settingsPage) {
        openSettings(settingsPage.dataset.settingsPage);
        return;
      }
      const band = target.closest('[data-band]');
      if (band) {
        state.selectedBand = band.dataset.band;
        renderWifiChannels();
        return;
      }
      const reportItem = target.closest('[data-report-id]');
      if (reportItem) {
        selectReport(reportItem.dataset.reportId);
        return;
      }
      const reportExport = target.closest('[data-report-export]');
      if (reportExport) {
        exportReport(reportExport.dataset.reportExport);
        return;
      }
      const reportCopy = target.closest('[data-report-copy]');
      if (reportCopy) {
        copyReportSummary();
        return;
      }
      const action = target.closest('[data-action]');
      if (action) {
        const value = action.dataset.action;
        if (value === 'go-channels') switchView('channels');
        else if (value === 'go-wifi') switchView('wifi');
        else if (value === 'scan-wifi') scanWifi(false);
        else if (value === 'open-wifi-settings') openSettings('wifi');
        else if (value === 'reset-priority') resetPriority();
        else if (value === 'open-data-dir') openDataDir();
        return;
      }
    });

    const bind = (id, handler) => {
      const element = document.getElementById(id);
      if (element) element.addEventListener('click', handler);
    };

    bind('openPreferencesBtn', openPreferences);
    bind('themeBtn', toggleTheme);
    bind('refreshTopBtn', () => refreshSnapshot(true));
    bind('refreshDashboardBtn', () => refreshSnapshot(true));
    bind('refreshChannelsBtn', () => refreshSnapshot(true));
    bind('compareChannelsBtn', compareChannels);
    bind('scanWifiBtn', () => scanWifi(false));
    bind('wifiOpenSettingsBtn', () => openSettings('wifi'));
    bind('wifiProfilesRefreshBtn', () => loadWifiProfiles(true));
    bind('wifiRevealPasswordBtn', toggleCurrentWifiPassword);
    bind('wifiCopyPasswordBtn', copyCurrentWifiPassword);
    bind('wifiVerifyBtn', verifyWifiPasswordFromForm);
    const wifiVerifyInput = $('#wifiPasswordInput');
    if (wifiVerifyInput) {
      wifiVerifyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          verifyWifiPasswordFromForm();
        }
      });
    }
    const wifiVerifyTarget = $('#wifiVerifyTarget');
    if (wifiVerifyTarget) {
      wifiVerifyTarget.addEventListener('change', () => {
        state.wifiSelectedProfile = wifiVerifyTarget.value || null;
        setVerifyResult('', '等待核对', '选择网络并输入密码，核对是否与本机保存的一致。');
      });
    }
    bind('runConnectivityBtn', runConnectivity);
    bind('resetTargetsBtn', resetTargets);
    bind('selectRequiredBtn', selectRequiredTargets);
    bind('selectAllTargetsBtn', selectAllTargets);
    bind('addTargetBtn', addCustomTarget);
    bind('copyConnBtn', copyConnectivity);
    bind('exportConnBtn', exportConnectivity);
    bind('runDiagnosticBtn', runDiagnostic);
    bind('runDiagnosticMainBtn', runDiagnostic);
    bind('quickConnectivityBtn', () => { switchView('connectivity'); runConnectivity(); });
    bind('quickWifiBtn', () => { switchView('wifi'); if (!state.wifiScan) scanWifi(false); });
    bind('quickSpeedBtn', () => { switchView('stability'); runSpeed(); });
    bind('quickRepairBtn', () => switchView('repair'));
    bind('diagRefreshBtn', () => refreshSnapshot(true));
    bind('clearLogBtn', clearDiagLog);
    bind('resultExportHtml', () => exportReport('html', state.lastReport));
    bind('resultExportJson', () => exportReport('json', state.lastReport));
    bind('resultCopy', () => copyReportSummary(state.lastReport));
    bind('resultGoReport', () => switchView('reports'));
    bind('runSpeedBtn', runSpeed);
    bind('stabilityMonitorBtn', () => (state.monitorRunning ? stopMonitor(false) : startMonitor(false)));
    bind('runStabilityDeepBtn', runStabilityDeep);
    bind('openNetworkSettingsBtn', () => openSettings('network'));
    bind('relaunchAdminBtn', relaunchAdmin);
    bind('relaunchAdminMainBtn', relaunchAdmin);
    bind('openDataDirBtn', openDataDir);
    bind('clearRepairLogBtn', clearRepairLogs);
    bind('exportCurrentHtmlBtn', () => exportReport('html'));
    bind('clearHistoryBtn', clearHistory);
    bind('viewAllIssuesBtn', () => showIssueList(currentIssues()));
    bind('dashReportLink', () => switchView('reports'));
    bind('winMinBtn', () => window.wifi.windowControl('minimize'));
    bind('winMaxBtn', () => window.wifi.windowControl('maximize'));
    bind('winCloseBtn', () => window.wifi.windowControl('close'));
    bind('modalCloseBtn', closeModal);
    bind('modalBackdrop', (event) => {
      if (event.target === document.getElementById('modalBackdrop')) closeModal();
    });

    const search = $('#wifiSearch');
    if (search) {
      search.addEventListener('input', debounce(() => {
        state.wifiQuery = search.value;
        renderWifiTable();
      }, 120));
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        refreshSnapshot(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        openPreferences();
      }
    });

    window.addEventListener('resize', debounce(() => {
      renderCharts();
      if (state.currentView === 'wifi') renderWifiChannels();
    }, 200));

    window.addEventListener('online', () => {
      toast('网络已恢复', '正在刷新网络状态…', 'success', 2600);
      refreshSnapshot(true, true);
    });
    window.addEventListener('offline', () => toast('网络已断开', '请检查网线、Wi-Fi 或路由器连接。', 'warn', 4200));

    if (window.wifi) {
      if (typeof window.wifi.onMonitor === 'function') window.wifi.onMonitor(handleMonitorSample);
      if (typeof window.wifi.onDiagnostic === 'function') window.wifi.onDiagnostic(handleDiagnosticEvent);
      if (typeof window.wifi.onPingResult === 'function') {
        window.wifi.onPingResult((payload) => {
          if (!payload || payload.context !== 'connectivity' || !state.connectivityRunning) return;
          const result = payload.result;
          if (!result) return;
          if (!state.connectivityResults.some((item) => String(item.id) === String(result.id))) {
            state.connectivityResults.push(result);
            renderConnectivityResults();
            renderConnectivity();
          }
        });
      }
      if (typeof window.wifi.onSpeedProgress === 'function') window.wifi.onSpeedProgress(handleSpeedProgress);
      if (typeof window.wifi.onHistoryUpdated === 'function') {
        window.wifi.onHistoryUpdated(() => {
          if (state.currentView === 'reports') loadHistory(true);
          else if (window.wifi.history) loadHistory(true);
        });
      }
      if (typeof window.wifi.onToast === 'function') {
        window.wifi.onToast((payload) => {
          if (payload && payload.title) toast(payload.title, payload.message || '', payload.type || 'info');
        });
      }
      if (typeof window.wifi.onWindowState === 'function') {
        window.wifi.onWindowState((payload) => {
          const button = $('#winMaxBtn');
          if (button && payload) setIcon(button, payload.maximized ? 'restore' : 'maximize');
        });
      }
    }

    bindSettingsControls();
  }

  async function boot() {
    document.body.dataset.view = state.currentView || 'dashboard';
    bindEvents();
    try {
      await Promise.all([loadMeta(), loadSettings()]);
    } catch (error) {
      toast('初始化失败', String(error.message || error), 'warn');
    }
    await loadSnapshot(false);
    renderAll();
    renderStageList();
    await loadHistory(true);
    const hint = $('#titlebarHint');
    if (hint) hint.textContent = 'Ctrl+R 刷新网络配置 · Esc 关闭弹窗';
    if (wifiAvailable() && wifiCurrent()) {
      setTimeout(() => scanWifi(true), 1600);
    }
    setTimeout(() => startMonitor(true), 900);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
