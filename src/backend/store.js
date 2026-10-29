'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function getUserDataDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return app.getPath('userData');
  } catch {
    // Running outside Electron (unit tests / CLI diagnostics).
  }
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'WiFiMedic');
}

const DATA_DIR = getUserDataDir();
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const DEFAULT_SETTINGS = {
  theme: 'light',
  selectedIfIndex: null,
  disabledTargetIds: ['microsoft', 'cloudflare-dns', 'github', 'google-dns', 'google', 'cloudflare-web'],
  customTargets: [],
  autoSaveHistory: true,
  monitorIntervalMs: 1200,
  includeUploadInSpeedTest: false,
  uiScale: 1.2,
  lastView: 'dashboard',
  lastReportId: null,
};

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // best effort
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function getSettings() {
  const stored = readJson(SETTINGS_FILE, {});
  return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current };
  if (!patch || typeof patch !== 'object') return next;
  const allowed = Object.keys(DEFAULT_SETTINGS);
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
  }
  if (next.selectedIfIndex != null) {
    const n = Number(next.selectedIfIndex);
    next.selectedIfIndex = Number.isInteger(n) && n >= 0 ? n : null;
  }
  if (!Array.isArray(next.disabledTargetIds)) next.disabledTargetIds = [];
  if (!Array.isArray(next.customTargets)) next.customTargets = [];
  if (!['dark', 'light'].includes(next.theme)) next.theme = 'light';
  if (typeof next.autoSaveHistory !== 'boolean') next.autoSaveHistory = true;
  if (typeof next.includeUploadInSpeedTest !== 'boolean') next.includeUploadInSpeedTest = false;
  const uiScale = Number(next.uiScale);
  next.uiScale = [1, 1.2, 1.35].includes(uiScale) ? uiScale : 1.2;
  next.monitorIntervalMs = Math.max(800, Math.min(Number(next.monitorIntervalMs) || 1200, 10000));
  try {
    writeJson(SETTINGS_FILE, next);
  } catch {
    // keep in-memory behavior even if disk is read-only
  }
  return next;
}

function getHistory() {
  const stored = readJson(HISTORY_FILE, []);
  return Array.isArray(stored) ? stored : [];
}

function saveHistory(report, extra = {}) {
  if (!report || typeof report !== 'object') return null;
  const history = getHistory();
  const entry = {
    id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    score: report.score,
    status: report.status,
    verdict: report.verdict,
    durationMs: report.durationMs,
    adapter: report.activeAdapter
      ? { name: report.activeAdapter.name, type: report.activeAdapter.type, kindLabel: report.activeAdapter.kindLabel }
      : null,
    stats: report.stats,
    issueCount: Array.isArray(report.issues) ? report.issues.length : 0,
    criticalCount: Array.isArray(report.issues) ? report.issues.filter((i) => i.severity === 'critical').length : 0,
    note: extra.note || '',
    report,
  };
  const next = [entry, ...history].slice(0, 30);
  try {
    writeJson(HISTORY_FILE, next);
  } catch {
    // ignore disk errors
  }
  return entry;
}

function getHistoryItem(id) {
  return getHistory().find((entry) => entry.id === id) || null;
}

function clearHistory() {
  try {
    writeJson(HISTORY_FILE, []);
    return true;
  } catch {
    return false;
  }
}

function getDataDir() {
  ensureDir();
  return DATA_DIR;
}

module.exports = {
  DATA_DIR,
  getDataDir,
  getSettings,
  updateSettings,
  getHistory,
  saveHistory,
  getHistoryItem,
  clearHistory,
  DEFAULT_SETTINGS,
};
