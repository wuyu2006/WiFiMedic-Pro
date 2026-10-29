'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ps, isAdmin } = require('./win');
const { REPAIR_ACTIONS } = require('./constants');

function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertIfIndex(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error('无效的网卡索引');
  return n;
}

function assertAdapterName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 200 || /[\r\n]/.test(name)) throw new Error('无效的网卡名称');
  return name;
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best effort
  }
}

function writeBackup(dataDir, name, data) {
  if (!dataDir) return null;
  try {
    ensureDir(dataDir);
    const file = path.join(dataDir, name);
    fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), data }, null, 2), 'utf8');
    return file;
  } catch {
    return null;
  }
}

function readBackup(dataDir, name) {
  if (!dataDir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
  } catch {
    return null;
  }
}

async function runRepair(actionId, context = {}) {
  const action = REPAIR_ACTIONS[actionId];
  if (!action) throw new Error(`未知修复操作: ${actionId}`);
  const admin = await isAdmin();
  if (action.admin && !admin) {
    return {
      ok: false,
      needsAdmin: true,
      action: actionId,
      error: '该操作需要管理员权限，请点击右上角「以管理员身份重启」后重试。',
    };
  }

  const ifIndex = context.ifIndex != null ? assertIfIndex(context.ifIndex) : null;
  const adapterName = context.adapterName ? assertAdapterName(context.adapterName) : null;
  const dataDir = context.dataDir || '';
  let script = '';
  let needsReboot = false;
  let backupFile = null;

  switch (actionId) {
    case 'flushDns':
      script = 'Clear-DnsClientCache -ErrorAction Stop; Write-Output "DNS 缓存已刷新"';
      break;
    case 'clearArp':
      script = 'arp -d *';
      break;
    case 'renewDhcp': {
      const target = adapterName ? ` ${quotePs(adapterName)}` : '';
      script = `Write-Output '正在释放 IP 地址...'; & ipconfig /release${target} | Out-String; Write-Output '正在重新获取 IP 地址...'; & ipconfig /renew${target} | Out-String`;
      break;
    }
    case 'restartAdapter': {
      if (!adapterName) throw new Error('缺少网卡名称');
      script = `Restart-NetAdapter -Name ${quotePs(adapterName)} -Confirm:$false -ErrorAction Stop; Write-Output '网卡已重启'; Get-NetAdapter -Name ${quotePs(adapterName)} | Select-Object Name,Status,LinkSpeed | Format-List | Out-String`;
      break;
    }
    case 'restartWlan':
      script = 'Restart-Service -Name WlanSvc -Force -ErrorAction Stop; Write-Output "WLAN 服务状态: $((Get-Service WlanSvc).Status)"';
      break;
    case 'startWlan':
      script = 'Start-Service -Name WlanSvc -ErrorAction Stop; Write-Output "WLAN 服务状态: $((Get-Service WlanSvc).Status)"';
      break;
    case 'resetProxy':
      backupFile = writeBackup(dataDir, 'proxy-backup.json', {
        note: '由 WiFiMedic Pro 在关闭系统代理前自动备份',
        capturedAt: new Date().toISOString(),
      });
      script = `
        $key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
        $p = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        $backup = [pscustomobject]@{ ProxyEnable=$p.ProxyEnable; ProxyServer=$p.ProxyServer; AutoConfigURL=$p.AutoConfigURL; ProxyOverride=$p.ProxyOverride }
        $dir = Join-Path $env:APPDATA 'WiFiMedic'
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $backup | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 (Join-Path $dir 'proxy-backup.json')
        Set-ItemProperty -Path $key -Name ProxyEnable -Value 0 -Type DWord
        Remove-ItemProperty -Path $key -Name AutoConfigURL -ErrorAction SilentlyContinue
        Write-Output '系统代理已关闭，原设置已备份到 APPDATA\\WiFiMedic\\proxy-backup.json'
      `;
      break;
    case 'setPublicDns': {
      if (ifIndex == null) throw new Error('缺少网卡索引');
      const current = await ps(
        `$dns=@(Get-DnsClientServerAddress -InterfaceIndex ${ifIndex} -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object {$_.ServerAddresses}); $dns | ConvertTo-Json -Compress`,
        { timeout: 10000 },
      );
      backupFile = writeBackup(dataDir, `dns-backup-${ifIndex}.json`, {
        ifIndex,
        adapterName,
        previousDns: (current.stdout || '').trim(),
        capturedAt: new Date().toISOString(),
      });
      script = `Set-DnsClientServerAddress -InterfaceIndex ${ifIndex} -ServerAddresses @('223.5.5.5','119.29.29.29') -ErrorAction Stop; ipconfig /flushdns | Out-String; Write-Output 'DNS 已切换为 223.5.5.5 / 119.29.29.29'`;
      break;
    }
    case 'resetDns':
      if (ifIndex == null) throw new Error('缺少网卡索引');
      script = `Set-DnsClientServerAddress -InterfaceIndex ${ifIndex} -ResetServerAddresses -ErrorAction Stop; ipconfig /flushdns | Out-String; Write-Output 'DNS 已恢复为自动获取'`;
      break;
    case 'resetWinsock':
      script = 'netsh winsock reset';
      needsReboot = true;
      break;
    case 'resetTcpip':
      script = 'netsh int ip reset';
      needsReboot = true;
      break;
    case 'resetRouteMetric':
      script = 'Get-NetIPInterface -AddressFamily IPv4 | ForEach-Object { Set-NetIPInterface -InterfaceIndex $_.ifIndex -AutomaticMetric Enabled -ErrorAction SilentlyContinue }; Write-Output "已恢复自动跃点"';
      break;
    default:
      throw new Error(`未实现的修复操作: ${actionId}`);
  }

  const started = Date.now();
  const result = await ps(
    `try { ${script} } catch { Write-Output ('ERROR: ' + $_.Exception.Message); exit 1 }`,
    { timeout: actionId === 'renewDhcp' ? 60000 : 35000, maxBuffer: 8 * 1024 * 1024 },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const failed = !result.ok || /ERROR:|Exception|失败|拒绝访问|Access is denied/i.test(output);
  return {
    ok: !failed,
    action: actionId,
    name: action.name,
    output: output.slice(0, 8000),
    needsReboot,
    backupFile,
    durationMs: Date.now() - started,
    error: failed ? output.slice(0, 2000) || result.error || '操作失败' : null,
  };
}

async function setPreferredInterface(ifIndex, context = {}) {
  const index = assertIfIndex(ifIndex);
  const admin = await isAdmin();
  if (!admin) {
    return { ok: false, needsAdmin: true, error: '设置网卡优先级需要管理员权限。' };
  }
  const dataDir = context.dataDir || '';
  const interfaces = Array.isArray(context.interfaces) ? context.interfaces : [];
  const physical = interfaces.filter((a) => a.interfaceIndex && (a.type === 'wifi' || a.type === 'ethernet'));
  const backup = physical.map((a) => ({
    interfaceIndex: a.interfaceIndex,
    name: a.name,
    metric: a.interfaceMetric,
  }));
  const backupFile = writeBackup(dataDir, 'priority-backup.json', {
    selected: index,
    interfaces: backup,
    capturedAt: new Date().toISOString(),
  });
  const others = physical.filter((a) => a.interfaceIndex !== index).map((a) => a.interfaceIndex);
  const parts = [];
  parts.push(`Set-NetIPInterface -InterfaceIndex ${index} -InterfaceMetric 5 -ErrorAction Stop`);
  for (const other of others) {
    parts.push(`Set-NetIPInterface -InterfaceIndex ${other} -InterfaceMetric 50 -ErrorAction SilentlyContinue`);
  }
  const script = `
    try {
      ${parts.join('; ')};
      ipconfig /flushdns | Out-Null;
      Write-Output '已将网卡索引 ${index} 设为优先通道（跃点 5）'
    } catch {
      Write-Output ('ERROR: ' + $_.Exception.Message);
      exit 1
    }
  `;
  const result = await ps(script, { timeout: 25000 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return {
    ok: result.ok && !/ERROR:/i.test(output),
    output,
    backupFile,
    selected: index,
    others,
    error: result.ok && !/ERROR:/i.test(output) ? null : output || result.error,
  };
}

async function resetPreferredInterface(context = {}) {
  const admin = await isAdmin();
  if (!admin) return { ok: false, needsAdmin: true, error: '恢复跃点需要管理员权限。' };
  const dataDir = context.dataDir || '';
  const backup = readBackup(dataDir, 'priority-backup.json');
  let script;
  if (backup && backup.data && Array.isArray(backup.data.interfaces)) {
    const parts = backup.data.interfaces.map(
      (i) =>
        `Set-NetIPInterface -InterfaceIndex ${Number(i.interfaceIndex)} -InterfaceMetric ${Number(i.metric) || 0} -ErrorAction SilentlyContinue`,
    );
    script = `${parts.join('; ')}; Write-Output '已恢复此前的网卡跃点设置'`;
  } else {
    script =
      'Get-NetIPInterface -AddressFamily IPv4 | Set-NetIPInterface -AutomaticMetric Enabled -ErrorAction SilentlyContinue; Write-Output "已恢复 Windows 自动跃点"';
  }
  const result = await ps(script, { timeout: 25000 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return {
    ok: result.ok,
    output,
    restored: Boolean(backup),
    error: result.ok ? null : output || result.error,
  };
}

module.exports = {
  runRepair,
  setPreferredInterface,
  resetPreferredInterface,
  REPAIR_ACTIONS,
};
