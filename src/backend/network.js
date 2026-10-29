'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { psJson, ps, runNetsh, normalizeText } = require('./win');

const WLAN_SERVICE = 'WlanSvc';

function safeArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter((v) => v != null) : [value];
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function classifyAdapter(adapter) {
  const text = [
    adapter.name,
    adapter.description,
    adapter.physicalMediaType,
    adapter.mediaType,
    adapter.driverDescription,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    /(wi-?fi|wireless|wlan|802\.11|native 802\.11|无线|无线网卡)/i.test(text) ||
    /native 802\.11/i.test(String(adapter.mediaType || ''))
  ) {
    return 'wifi';
  }
  if (/(bluetooth|蓝牙)/i.test(text)) return 'bluetooth';
  if (
    /(hyper-v|vethernet|vmware|virtualbox|virtual box|qemu|tap-|tap adapter|tun|wireguard|tailscale|zerotier|vpn|openvpn|wireguard|softether|loopback|teredo|isatap|npcap|wintun)/i.test(
      text,
    )
  ) {
    return 'virtual';
  }
  if (/(ethernet|802\.3|gbe|gigabit|以太网|局域网)/i.test(text)) return 'ethernet';
  if (/unspecified/i.test(String(adapter.physicalMediaType || '')) && adapter.mediaType === '802.3') {
    return 'ethernet';
  }
  return 'other';
}

function adapterKindLabel(type) {
  return (
    {
      wifi: '无线',
      ethernet: '有线',
      virtual: '虚拟 / VPN',
      bluetooth: '蓝牙',
      other: '其他',
    }[type] || '其他'
  );
}

function adapterKindIcon(type) {
  return (
    {
      wifi: 'wifi',
      ethernet: 'ethernet',
      virtual: 'shield',
      bluetooth: 'bluetooth',
      other: 'adapter',
    }[type] || 'adapter'
  );
}

function normalizeAdapter(adapter) {
  const type = classifyAdapter(adapter);
  const ipv4 = safeArray(adapter.ipv4).map((ip) => ({
    address: String(ip.address || ''),
    prefixLength: toNumber(ip.prefixLength, 0),
    prefixOrigin: String(ip.prefixOrigin || ''),
    suffixOrigin: String(ip.suffixOrigin || ''),
  }));
  const ipv6 = safeArray(adapter.ipv6).map((ip) => ({
    address: String(ip.address || ''),
    prefixLength: toNumber(ip.prefixLength, 0),
    prefixOrigin: String(ip.prefixOrigin || ''),
  }));
  const gateway = safeArray(adapter.gateway)
    .map(String)
    .filter((v) => v && v !== '0.0.0.0');
  const dns = [...new Set(safeArray(adapter.dns).map(String).filter(Boolean))];
  const primaryIp = ipv4[0] || null;
  const isApipa = ipv4.some((ip) => ip.address.startsWith('169.254.'));
  const status = String(adapter.status || '');
  const up = /^up$/i.test(status) || /已启用|已连接/i.test(status);

  return {
    ...adapter,
    interfaceIndex: toNumber(adapter.interfaceIndex, -1),
    name: String(adapter.name || '未知网卡'),
    description: String(adapter.description || ''),
    status,
    up,
    type,
    kindLabel: adapterKindLabel(type),
    kindIcon: adapterKindIcon(type),
    virtual: type === 'virtual',
    bluetooth: type === 'bluetooth',
    ipv4,
    ipv6,
    primaryIp,
    isApipa,
    gateway,
    dns,
    dhcp: /enabled|启用/i.test(String(adapter.dhcp || '')),
    interfaceMetric: toNumber(adapter.interfaceMetric, 0),
    linkSpeed: String(adapter.linkSpeed || ''),
    mac: String(adapter.mac || ''),
    driverVersion: String(adapter.driverVersion || ''),
    profile: adapter.connectionProfile || null,
  };
}

function normalizeRoute(route, adapters) {
  const ifIndex = toNumber(route.ifIndex, -1);
  const adapter = adapters.find((a) => a.interfaceIndex === ifIndex);
  const routeMetric = toNumber(route.routeMetric, 0);
  const interfaceMetric = toNumber(route.interfaceMetric, 0);
  return {
    ...route,
    ifIndex,
    interfaceAlias: adapter ? adapter.name : String(route.interfaceAlias || '未知接口'),
    nextHop: String(route.nextHop || ''),
    routeMetric,
    interfaceMetric,
    effectiveMetric: routeMetric + interfaceMetric,
    adapter,
  };
}

function detectActivePath(adapters, routes) {
  const candidates = routes
    .filter((r) => r.nextHop && r.nextHop !== '0.0.0.0')
    .filter((r) => {
      const adapter = adapters.find((a) => a.interfaceIndex === r.ifIndex);
      return adapter && adapter.up;
    })
    .sort((a, b) => a.effectiveMetric - b.effectiveMetric);

  const activeRoute = candidates[0] || null;
  const activeAdapter = activeRoute ? adapters.find((a) => a.interfaceIndex === activeRoute.ifIndex) : null;
  return {
    route: activeRoute,
    adapter: activeAdapter || null,
    candidates,
    type: activeAdapter ? activeAdapter.type : null,
  };
}

function buildIssues(snapshot) {
  const issues = [];
  const { adapters, active, routes, proxy, wlanService, wifi } = snapshot;
  const physical = adapters.filter((a) => a.up && (a.type === 'wifi' || a.type === 'ethernet'));

  if (!active || !active.adapter) {
    issues.push({
      severity: 'critical',
      code: 'NO_ACTIVE_ROUTE',
      title: '没有可用的默认上网通道',
      detail: '系统没有找到带默认网关的可用网卡，电脑可能没有连接网络，或 DHCP 未成功获取地址。',
      fix: '检查网线 / Wi-Fi 是否连接，尝试重新获取 IP，或重启路由器。',
    });
  } else if (active.adapter.type === 'virtual') {
    issues.push({
      severity: 'warning',
      code: 'ACTIVE_VIRTUAL',
      title: '当前默认通道是虚拟网卡 / VPN',
      detail: `系统正通过「${active.adapter.name}」上网。VPN、虚拟机或加速器异常时，会影响全部网络。`,
      fix: '如不需要 VPN，请退出代理 / VPN 软件后再测试；如必须使用，请检查其路由与 DNS 设置。',
    });
  }

  if (physical.length === 0) {
    issues.push({
      severity: 'critical',
      code: 'NO_PHYSICAL_ADAPTER',
      title: '未检测到可用的物理网卡',
      detail: '有线网卡和无线网卡均未处于已连接状态。',
      fix: '检查网卡是否被禁用、驱动是否正常，或重新插拔网线 / 连接 Wi-Fi。',
    });
  }

  const apipa = adapters.filter((a) => a.up && a.isApipa);
  if (apipa.length) {
    issues.push({
      severity: 'critical',
      code: 'APIPA',
      title: '网卡获取到 169.254 开头的无效地址',
      detail: `${apipa.map((a) => a.name).join('、')} 未从路由器获得有效 IP，通常表示 DHCP 失败或网线 / Wi-Fi 未真正连通。`,
      fix: '重新获取 IP 地址，检查路由器 DHCP 服务，或更换网线 / 重新连接 Wi-Fi。',
    });
  }

  const defaultRoutes = routes.filter((r) => r.nextHop && r.nextHop !== '0.0.0.0');
  if (defaultRoutes.length > 1) {
    const distinctGateways = [...new Set(defaultRoutes.map((r) => `${r.ifIndex}:${r.nextHop}`))];
    if (distinctGateways.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'MULTI_DEFAULT_ROUTE',
        title: '检测到多条默认路由',
        detail: `系统同时存在 ${distinctGateways.length} 条默认线路，Windows 会按跃点选择，可能造成上网通道与预期不一致。`,
        fix: '在「网络通道」中确认当前生效线路，必要时手动设置网卡优先级。',
      });
    }
  }

  const activeAdapter = active && active.adapter;
  if (activeAdapter) {
    if (!activeAdapter.primaryIp) {
      issues.push({
        severity: 'critical',
        code: 'NO_IP',
        title: '当前上网通道没有 IPv4 地址',
        detail: `「${activeAdapter.name}」未获得 IPv4 地址，无法访问 IPv4 互联网。`,
        fix: '重新获取 IP，或检查网卡 IPv4 设置是否为自动获取。',
      });
    }
    if (activeAdapter.gateway.length === 0) {
      issues.push({
        severity: 'critical',
        code: 'NO_GATEWAY',
        title: '当前通道缺少默认网关',
        detail: '没有默认网关，电脑只能访问同网段设备，无法访问互联网。',
        fix: '检查路由器 / 光猫连接，或重新获取 DHCP。',
      });
    }
    if (activeAdapter.dns.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'NO_DNS',
        title: '当前通道没有配置 DNS',
        detail: '没有 DNS 服务器时，IP 能通但域名无法解析，表现为网页打不开、应用无法登录。',
        fix: '将 DNS 设置为自动获取，或切换为公共 DNS。',
      });
    }
  }

  if (proxy && proxy.enabled) {
    issues.push({
      severity: 'warning',
      code: 'PROXY_ON',
      title: '系统代理已开启',
      detail: `当前代理服务器：${proxy.server || '未填写'}。代理软件异常退出后，浏览器和部分应用会无法联网。`,
      fix: '确认代理软件正在运行；不需要时关闭系统代理。',
    });
  }
  if (proxy && proxy.pac) {
    issues.push({
      severity: 'info',
      code: 'PAC_ON',
      title: '检测到自动代理脚本',
      detail: `PAC 地址：${proxy.pac}`,
      fix: '若网络异常，可暂时关闭自动代理脚本后对比测试。',
    });
  }

  const hasWifiHardware = adapters.some((a) => a.type === 'wifi') || Boolean(wifi && wifi.available);
  if (hasWifiHardware && wlanService && /stopped|已停止/i.test(String(wlanService.status || ''))) {
    issues.push({
      severity: 'warning',
      code: 'WLAN_STOPPED',
      title: 'WLAN 无线服务未运行',
      detail: 'Windows 无线自动配置服务已停止，无线网卡无法扫描或连接 Wi-Fi。',
      fix: '启动 WLAN 服务，或重启无线服务后重试。',
    });
  }

  if (wifi && wifi.current) {
    const signal = toNumber(wifi.current.signal, null);
    if (signal != null && signal < 35) {
      issues.push({
        severity: 'warning',
        code: 'WEAK_WIFI',
        title: 'Wi-Fi 信号较弱',
        detail: `当前信号 ${signal}%，可能出现丢包、延迟升高和速率下降。`,
        fix: '靠近路由器，优先使用 5GHz，或调整路由器天线位置。',
      });
    }
  }

  return issues;
}

async function getSystemInfo() {
  const script = `
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $wlan = Get-Service -Name '${WLAN_SERVICE}' -ErrorAction SilentlyContinue
    [pscustomobject]@{
      caption = [string]$os.Caption
      version = [string]$os.Version
      build = [string]$os.BuildNumber
      installDate = if($os.InstallDate){$os.InstallDate.ToString('yyyy-MM-dd')}else{''}
      lastBoot = if($os.LastBootUpTime){$os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm:ss')}else{''}
      manufacturer = [string]$cs.Manufacturer
      model = [string]$cs.Model
      cpu = [string]$cpu.Name
      cores = [int]$cpu.NumberOfCores
      logicalProcessors = [int]$cpu.NumberOfLogicalProcessors
      memoryBytes = [long]$cs.TotalPhysicalMemory
      wlanService = if($wlan){[pscustomobject]@{status=[string]$wlan.Status;startType=[string]$wlan.StartType}}else{$null}
    } | ConvertTo-Json -Depth 5 -Compress
  `;
  const res = await psJson(script, { timeout: 18000 });
  const psInfo = res.ok ? res.data : {};
  const cpus = os.cpus();
  let hostsActive = 0;
  try {
    const hosts = fs.readFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts'), 'utf8');
    hostsActive = hosts
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith('#') && !/^\s*#/.test(line)).length;
  } catch {
    hostsActive = 0;
  }
  return {
    hostname: os.hostname(),
    username: os.userInfo().username,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    uptime: os.uptime(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    cpu: psInfo.cpu || (cpus[0] ? cpus[0].model : '未知处理器'),
    cores: psInfo.cores || cpus.length,
    logicalProcessors: psInfo.logicalProcessors || cpus.length,
    caption: psInfo.caption || `Windows ${os.release()}`,
    version: psInfo.version || os.release(),
    build: psInfo.build || '',
    installDate: psInfo.installDate || '',
    lastBoot: psInfo.lastBoot || '',
    manufacturer: psInfo.manufacturer || '',
    model: psInfo.model || '',
    memoryBytes: psInfo.memoryBytes || os.totalmem(),
    wlanService: psInfo.wlanService || null,
    hostsEntries: hostsActive,
    node: process.versions.node,
    electron: process.versions.electron || '',
    chrome: process.versions.chrome || '',
  };
}

async function getRawNetwork() {
  const script = `
    $profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object Name,InterfaceAlias,InterfaceIndex,NetworkCategory,IPv4Connectivity,IPv6Connectivity)
    $adapters = @()
    foreach($a in @(Get-NetAdapter -ErrorAction SilentlyContinue)) {
      $idx = [int]$a.ifIndex
      $ipif = Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
      $ips = @(Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -ne 'Tentative' })
      $ips6 = @(Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -ne 'Tentative' -and $_.IPAddress -notlike 'fe80::*' } | Select-Object -First 3)
      $cfg = @(Get-NetIPConfiguration -InterfaceIndex $idx -ErrorAction SilentlyContinue) | Select-Object -First 1
      $gateways = @()
      if($cfg -and $cfg.IPv4DefaultGateway) { $gateways = @($cfg.IPv4DefaultGateway | ForEach-Object { [string]$_.NextHop }) }
      $dns = @(Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ } | Select-Object -Unique)
      $prof = $profiles | Where-Object { $_.InterfaceIndex -eq $idx } | Select-Object -First 1
      $adapters += [pscustomobject]@{
        name = [string]$a.Name
        description = [string]$a.InterfaceDescription
        interfaceIndex = $idx
        status = [string]$a.Status
        linkSpeed = [string]$a.LinkSpeed
        mac = [string]$a.MacAddress
        mediaType = [string]$a.MediaType
        physicalMediaType = [string]$a.PhysicalMediaType
        driverDescription = [string]$a.DriverDescription
        driverVersion = [string]$a.DriverVersion
        fullDuplex = [bool]$a.FullDuplex
        receiveLinkSpeed = [long]$a.ReceiveLinkSpeed
        transmitLinkSpeed = [long]$a.TransmitLinkSpeed
        ipv4 = @($ips | ForEach-Object { [pscustomobject]@{ address=[string]$_.IPAddress; prefixLength=[int]$_.PrefixLength; prefixOrigin=[string]$_.PrefixOrigin; suffixOrigin=[string]$_.SuffixOrigin } })
        ipv6 = @($ips6 | ForEach-Object { [pscustomobject]@{ address=[string]$_.IPAddress; prefixLength=[int]$_.PrefixLength; prefixOrigin=[string]$_.PrefixOrigin } })
        gateway = @($gateways | Where-Object { $_ })
        dns = @($dns)
        dhcp = if($ipif) { [string]$ipif.Dhcp } else { '' }
        interfaceMetric = if($ipif) { [int]$ipif.InterfaceMetric } else { 0 }
        connectionProfile = if($prof) { [pscustomobject]@{ name=[string]$prof.Name; category=[string]$prof.NetworkCategory; ipv4=[string]$prof.IPv4Connectivity; ipv6=[string]$prof.IPv6Connectivity } } else { $null }
      }
    }
    $routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object {
      [pscustomobject]@{
        ifIndex = [int]$_.InterfaceIndex
        nextHop = [string]$_.NextHop
        routeMetric = [int]$_.RouteMetric
        interfaceMetric = [int]$_.InterfaceMetric
        protocol = [string]$_.Protocol
        store = [string]$_.Store
      }
    })
    $p = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue
    $proxy = [pscustomobject]@{
      enabled = [bool]($p.ProxyEnable -eq 1)
      server = [string]$p.ProxyServer
      pac = [string]$p.AutoConfigURL
      override = [string]$p.ProxyOverride
    }
    $wlan = Get-Service -Name '${WLAN_SERVICE}' -ErrorAction SilentlyContinue
    $dnsClient = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ interfaceIndex=[int]$_.InterfaceIndex; servers=@($_.ServerAddresses) } })
    [pscustomobject]@{
      adapters = $adapters
      routes = $routes
      proxy = $proxy
      wlanService = if($wlan){[pscustomobject]@{status=[string]$wlan.Status;startType=[string]$wlan.StartType}}else{$null}
      dnsClients = $dnsClient
      capturedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json -Depth 8 -Compress
  `;
  const res = await psJson(script, { timeout: 30000 });
  if (!res.ok) {
    return {
      ok: false,
      error: res.error || '读取网络配置失败',
      adapters: [],
      routes: [],
      proxy: { enabled: false, server: '', pac: '', override: '' },
      wlanService: null,
      dnsClients: [],
      capturedAt: new Date().toISOString(),
    };
  }
  const data = res.data || {};
  return {
    ok: true,
    adapters: safeArray(data.adapters),
    routes: safeArray(data.routes),
    proxy: data.proxy || { enabled: false, server: '', pac: '', override: '' },
    wlanService: data.wlanService || null,
    dnsClients: safeArray(data.dnsClients),
    capturedAt: data.capturedAt || new Date().toISOString(),
  };
}

function normalizeKey(key) {
  const raw = String(key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '');
  const map = {
    name: 'name',
    名称: 'name',
    description: 'description',
    描述: 'description',
    guid: 'guid',
    physicaladdress: 'mac',
    物理地址: 'mac',
    state: 'state',
    状态: 'state',
    ssid: 'ssid',
    bssid: 'bssid',
    networktype: 'networkType',
    网络类型: 'networkType',
    radiotype: 'radioType',
    无线电类型: 'radioType',
    authentication: 'authentication',
    身份验证: 'authentication',
    cipher: 'cipher',
    密码: 'cipher',
    encryption: 'encryption',
    加密: 'encryption',
    connectionmode: 'connectionMode',
    连接模式: 'connectionMode',
    channel: 'channel',
    频道: 'channel',
    receiveratembs: 'rxRate',
    接收速率mbps: 'rxRate',
    transmitratembs: 'txRate',
    传输速率mbps: 'txRate',
    signal: 'signal',
    信号: 'signal',
    profile: 'profile',
    配置文件: 'profile',
    band: 'band',
    频带: 'band',
    baserates: 'basicRates',
    基本速率: 'basicRates',
  };
  return map[raw] || raw;
}

function parseNetshInterfaces(text) {
  const interfaces = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const match = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*)$/);
    if (!match) continue;
    const key = normalizeKey(match[1]);
    const value = match[2].trim();
    if (!key) continue;
    if (key === 'name') {
      if (current && Object.keys(current).length > 0) interfaces.push(current);
      current = {};
    }
    if (!current) current = {};
    if (current[key] === undefined || current[key] === '') {
      current[key] = value;
    }
  }
  if (current && Object.keys(current).length > 0) interfaces.push(current);

  return interfaces
    .filter((item) => item.name || item.ssid)
    .map((item) => {
      const signal = toNumber(String(item.signal || '').replace('%', ''), null);
      const channel = toNumber(String(item.channel || '').replace(/[^\d]/g, ''), null);
      const radioType = item.radioType || '';
      const band = inferBand(channel, radioType, item.band);
      return {
        ...item,
        signal,
        channel,
        band,
        frequency: channelToFrequency(channel, band),
        rssi: signal == null ? null : Math.round(signal / 2 - 100),
        rxRate: toNumber(item.rxRate, null),
        txRate: toNumber(item.txRate, null),
        connected: /connected|已连接/i.test(String(item.state || '')) && Boolean(item.ssid),
      };
    });
}

function parseNetshNetworks(text) {
  const lines = String(text || '').split(/\r?\n/);
  const networks = [];
  let network = null;
  let ap = null;

  const finishAp = () => {
    if (network && ap) {
      network.aps.push(ap);
      ap = null;
    }
  };
  const finishNetwork = () => {
    finishAp();
    if (network) networks.push(network);
    network = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    let m = line.match(/^\s*SSID\s+\d+\s*[:：]\s*(.*)$/i);
    if (m) {
      finishNetwork();
      network = {
        ssid: m[1].trim(),
        hidden: !m[1].trim(),
        networkType: '',
        authentication: '',
        encryption: '',
        aps: [],
      };
      continue;
    }
    m = line.match(/^\s*BSSID\s+\d+\s*[:：]\s*([0-9a-f:.-]+)\s*$/i);
    if (m && network) {
      finishAp();
      ap = {
        bssid: m[1].trim(),
        signal: null,
        channel: null,
        band: '',
        radioType: '',
        basicRates: '',
      };
      continue;
    }
    m = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*)$/);
    if (!m || !network) continue;
    const key = normalizeKey(m[1]);
    const value = m[2].trim();
    if (!value) continue;
    if (['authentication', 'encryption', 'networkType'].includes(key)) {
      if (!ap) network[key] = value;
      else if (!network[key]) network[key] = value;
      continue;
    }
    if (ap) {
      if (key === 'signal') ap.signal = toNumber(value.replace('%', ''), null);
      else if (key === 'channel') ap.channel = toNumber(value.replace(/[^\d]/g, ''), null);
      else if (key === 'band') ap.band = value;
      else if (key === 'radioType') ap.radioType = value;
      else if (key === 'basicRates') ap.basicRates = value;
      else if (key === 'bssid') ap.bssid = value;
    } else if (key === 'channel') {
      network.channel = toNumber(value.replace(/[^\d]/g, ''), null);
    }
  }
  finishNetwork();

  const result = [];
  for (const net of networks) {
    for (const item of net.aps) {
      const channel = item.channel;
      const band = inferBand(channel, item.radioType, item.band);
      const auth = net.authentication || '';
      const enc = net.encryption || '';
      const security = [auth, enc].filter(Boolean).join(' / ') || '未知';
      const open = /open|开放式|none|无/i.test(auth) && !/wep/i.test(enc);
      const wep = /wep/i.test(enc) || /wep/i.test(auth);
      result.push({
        ssid: net.ssid || '(隐藏网络)',
        hidden: Boolean(net.hidden),
        bssid: item.bssid,
        signal: item.signal,
        rssi: item.signal == null ? null : Math.round(item.signal / 2 - 100),
        channel,
        band,
        frequency: channelToFrequency(channel, band),
        radioType: item.radioType || '',
        authentication: auth,
        encryption: enc,
        security,
        open,
        wep,
        networkType: net.networkType || '',
      });
    }
  }
  return result
    .filter((n) => n.bssid || n.ssid)
    .sort((a, b) => (b.signal || 0) - (a.signal || 0));
}

function inferBand(channel, radioType, bandText) {
  if (bandText) {
    if (/6\s*ghz|6g/i.test(bandText)) return '6G';
    if (/5\s*ghz|5g/i.test(bandText)) return '5G';
    if (/2\.4|2g/i.test(bandText)) return '2.4G';
  }
  if (/6\s*ghz|6e|802\.11be/i.test(String(radioType || ''))) return '6G';
  if (channel == null) return '未知';
  if (channel >= 1 && channel <= 14) return '2.4G';
  if (channel >= 32 && channel <= 196) return '5G';
  if (channel >= 1 && channel <= 233) return '6G';
  return '未知';
}

function channelToFrequency(channel, band) {
  if (!channel) return null;
  if (band === '2.4G') return channel === 14 ? 2484 : 2407 + channel * 5;
  if (band === '5G') return 5000 + channel * 5;
  if (band === '6G') return 5950 + channel * 5;
  return null;
}

function analyzeChannels(networks) {
  const channels = new Map();
  for (const net of networks) {
    if (!net.channel) continue;
    const key = `${net.band}:${net.channel}`;
    if (!channels.has(key)) {
      channels.set(key, {
        channel: net.channel,
        band: net.band,
        count: 0,
        strong: 0,
        maxSignal: 0,
        weighted: 0,
        networks: [],
      });
    }
    const item = channels.get(key);
    item.count += 1;
    item.maxSignal = Math.max(item.maxSignal, net.signal || 0);
    item.weighted += 1 + (net.signal || 0) / 100;
    if ((net.signal || 0) >= 60) item.strong += 1;
    item.networks.push(net.ssid);
  }
  const list = [...channels.values()].sort((a, b) => {
    if (a.band !== b.band) return String(a.band).localeCompare(String(b.band));
    return a.channel - b.channel;
  });
  const recommended = {};
  for (const band of ['2.4G', '5G']) {
    const candidateChannels = band === '2.4G' ? [1, 6, 11] : [36, 40, 44, 48, 149, 153, 157, 161];
    const scored = candidateChannels.map((channel) => {
      const exact = channels.get(`${band}:${channel}`);
      const overlap =
        band === '2.4G'
          ? [...channels.values()]
              .filter((c) => c.band === band && Math.abs(c.channel - channel) <= 4)
              .reduce((sum, c) => sum + c.weighted, 0)
          : exact
            ? exact.weighted
            : 0;
      return { channel, score: overlap, count: exact ? exact.count : 0 };
    });
    scored.sort((a, b) => a.score - b.score);
    recommended[band] = scored[0] ? scored[0].channel : null;
  }
  return { list, recommended };
}

async function getWifiInterfaces() {
  const res = await runNetsh(['wlan', 'show', 'interfaces'], { timeout: 12000 });
  const text = normalizeText(res.stdout || res.stderr || '');
  if (!res.ok && !/interface|接口/i.test(text)) {
    return { ok: false, error: text || '无法读取无线网卡状态', interfaces: [], current: null, raw: text };
  }
  if (/no wireless interface|没有无线接口|无线接口不存在|There is no wireless/i.test(text)) {
    return { ok: true, interfaces: [], current: null, raw: text, error: null };
  }
  const interfaces = parseNetshInterfaces(text);
  const current = interfaces.find((i) => i.connected) || null;
  return { ok: true, interfaces, current, raw: text, error: null };
}

async function scanWifiNetworks() {
  const res = await runNetsh(['wlan', 'show', 'networks', 'mode=bssid'], { timeout: 25000 });
  const text = normalizeText(res.stdout || res.stderr || '');
  if (!res.ok) {
    return {
      ok: false,
      error: text || '扫描 Wi-Fi 失败，请确认 WLAN 服务已启动且无线网卡可用',
      networks: [],
      raw: text,
    };
  }
  if (/no wireless interface|没有无线接口|无线接口不存在|There is no wireless/i.test(text)) {
    return { ok: false, error: '未检测到无线网卡', networks: [], raw: text };
  }
  const networks = parseNetshNetworks(text);
  const analysis = analyzeChannels(networks);
  return { ok: true, error: null, networks, analysis, raw: text };
}

async function getWifiProfiles() {
  const res = await runNetsh(['wlan', 'show', 'profiles'], { timeout: 12000 });
  const text = normalizeText(`${res.stdout || ''}\n${res.stderr || ''}`);
  if (!res.ok) {
    return {
      ok: false,
      profiles: [],
      error: /not running|未运行|服务.*停止/i.test(text)
        ? 'WLAN 自动配置服务未运行，无法读取已保存的无线网络。'
        : text || '无法读取已保存的无线网络。',
      raw: text,
    };
  }
  const profiles = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:All User Profile|所有用户配置文件)\s*[:：]\s*(.+)$/i);
    if (m && !profiles.includes(m[1].trim())) profiles.push(m[1].trim());
  }
  return { ok: true, profiles, error: null, raw: text };
}

function parseWifiProfileDetail(text, name) {
  const fields = {};
  const labels = [
    ['authentication', /^(?:身份验证|Authentication)\s*[:：]\s*(.+)$/i],
    ['cipher', /^(?:密码|Cipher)\s*[:：]\s*(.+)$/i],
    ['securityKey', /^(?:安全密钥|Security key)\s*[:：]\s*(.+)$/i],
    ['keyContent', /^(?:密钥内容|Key Content)\s*[:：]\s*(.+)$/i],
    ['connectionMode', /^(?:连接模式|Connection mode)\s*[:：]\s*(.+)$/i],
    ['radioType', /^(?:无线电类型|Radio type)\s*[:：]\s*(.+)$/i],
    ['macRandomization', /^(?:MAC 随机化|MAC Randomization)\s*[:：]\s*(.+)$/i],
    ['cost', /^(?:成本|Cost)\s*[:：]\s*(.+)$/i],
  ];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    for (const [key, pattern] of labels) {
      if (fields[key] != null) continue;
      const match = line.match(pattern);
      if (match) fields[key] = match[1].trim();
    }
  }
  const keyText = String(fields.securityKey || '');
  const keyPresent = keyText
    ? !/不存在|absent|no\b/i.test(keyText)
    : Boolean(fields.keyContent);
  const keyContent = fields.keyContent && !/^(?:不可用|not available|n\/a)$/i.test(fields.keyContent)
    ? fields.keyContent
    : null;
  return {
    name,
    authentication: fields.authentication || '',
    cipher: fields.cipher || '',
    securityKey: fields.securityKey || '',
    keyPresent,
    keyContent,
    connectionMode: fields.connectionMode || '',
    radioType: fields.radioType || '',
    macRandomization: fields.macRandomization || '',
    cost: fields.cost || '',
  };
}

async function getWifiProfileDetail(name, options = {}) {
  const profileName = String(name == null ? '' : name).trim();
  if (!profileName) return { ok: false, error: '缺少无线网络名称。', profile: null };
  const escapedName = profileName.replace(/"/g, '');
  const args = ['wlan', 'show', 'profile', `name="${escapedName}"`];
  if (options.includeKey) args.push('key=clear');
  const res = await runNetsh(args, { timeout: 15000 });
  const text = normalizeText(`${res.stdout || ''}\n${res.stderr || ''}`);
  const denied = /access is denied|拒绝访问|requires elevation|需要提升|管理员权限/i.test(text);
  if (!res.ok && !/安全设置|Security settings/i.test(text)) {
    return {
      ok: false,
      needsAdmin: denied,
      error: denied
        ? '读取 Wi-Fi 密码需要管理员权限，请以管理员身份重启后再试。'
        : /not running|未运行|服务.*停止/i.test(text)
          ? 'WLAN 自动配置服务未运行，无法读取无线网络配置。'
          : text || '无法读取该无线网络配置。',
      profile: null,
    };
  }
  const profile = parseWifiProfileDetail(text, profileName);
  if (options.includeKey && profile.keyPresent && !profile.keyContent) {
    profile.keyError = '该系统或安全策略没有返回密码明文，请尝试以管理员身份运行。';
  }
  return { ok: true, profile, error: null, raw: options.includeRaw ? text : undefined };
}

async function verifyWifiPassword(name, password) {
  const detail = await getWifiProfileDetail(name, { includeKey: true });
  if (!detail.ok) return detail;
  const stored = detail.profile && detail.profile.keyContent;
  if (stored == null) {
    return {
      ok: false,
      match: false,
      hasKey: false,
      profile: {
        name: detail.profile ? detail.profile.name : String(name || ''),
        authentication: detail.profile ? detail.profile.authentication : '',
        keyPresent: Boolean(detail.profile && detail.profile.keyPresent),
      },
      error: (detail.profile && detail.profile.keyError) || '该网络没有可核对的密码明文（可能是开放网络或系统未返回密钥）。',
    };
  }
  return {
    ok: true,
    match: String(password == null ? '' : password) === String(stored),
    hasKey: true,
    profile: {
      name: detail.profile.name,
      authentication: detail.profile.authentication,
      cipher: detail.profile.cipher,
    },
    checkedAt: new Date().toISOString(),
  };
}

async function connectWifiProfile(name) {
  const profileName = String(name == null ? '' : name).trim();
  if (!profileName) return { ok: false, error: '缺少无线网络名称。' };
  const escapedName = profileName.replace(/"/g, '');
  const res = await runNetsh(['wlan', 'connect', `name="${escapedName}"`], { timeout: 20000 });
  const text = normalizeText(`${res.stdout || ''}\n${res.stderr || ''}`);
  if (!res.ok) {
    return {
      ok: false,
      error: /not running|未运行|服务.*停止/i.test(text)
        ? 'WLAN 自动配置服务未运行，请先在修复工具中启动 WLAN 服务。'
        : text || '连接无线网络失败。',
      output: text,
    };
  }
  return { ok: true, output: text || '已发送连接请求。', error: null };
}

async function getWifiCapabilities() {
  const [drivers, caps] = await Promise.all([
    runNetsh(['wlan', 'show', 'drivers'], { timeout: 15000 }),
    runNetsh(['wlan', 'show', 'wirelesscapabilities'], { timeout: 15000 }),
  ]);
  const driverText = normalizeText(`${drivers.stdout || ''}\n${drivers.stderr || ''}`);
  const capsText = normalizeText(`${caps.stdout || ''}\n${caps.stderr || ''}`);
  const text = `${driverText}\n${capsText}`;
  const serviceStopped = /not running|未运行|服务.*停止/i.test(text) && !/支持的无线电类型|Radio types supported/i.test(text);
  if (serviceStopped) {
    return {
      ok: false,
      error: 'WLAN 自动配置服务未运行，无法读取无线网卡能力。',
      raw: text,
    };
  }
  if (!drivers.ok && !caps.ok && !/无线|wireless|802\.11/i.test(text)) {
    return {
      ok: false,
      error: text || '无法读取无线网卡能力。',
      raw: text,
    };
  }
  const pick = (pattern) => {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      const match = line.match(pattern);
      if (match) return match[1].trim();
    }
    return '';
  };
  return {
    ok: true,
    error: null,
    capabilities: {
      radioTypes: pick(/^(?:支持的无线电类型|Radio types supported)\s*[:：]\s*(.+)$/i),
      authAlgorithms: pick(/^(?:支持的身份验证和密码|Authentication and cipher supported)\s*[:：]\s*(.+)$/i),
      hostedNetwork: pick(/^(?:支持的承载网络|Hosted network supported)\s*[:：]\s*(.+)$/i),
      wlanService: pick(/^(?:WLAN AutoConfig service|WLAN 自动配置服务)\s*[:：]\s*(.+)$/i),
      wirelessDisplay: pick(/^(?:无线显示支持|Wireless Display Supported)\s*[:：]\s*(.+)$/i),
      fips: pick(/^(?:FIPS 模式|FIPS mode)\s*[:：]\s*(.+)$/i),
    },
    raw: text,
  };
}

async function getSnapshot() {
  const [raw, system, wifiInterfaces, profileState] = await Promise.all([
    getRawNetwork(),
    getSystemInfo(),
    getWifiInterfaces().catch((error) => ({ ok: false, error: String(error), interfaces: [], current: null })),
    getWifiProfiles().catch(() => ({ ok: false, profiles: [], error: '无法读取已保存的无线网络。' })),
  ]);

  const adapters = raw.adapters.map(normalizeAdapter);
  const routes = raw.routes.map((r) => normalizeRoute(r, adapters));
  const active = detectActivePath(adapters, routes);
  const wifi = {
    available: Boolean(wifiInterfaces.interfaces && wifiInterfaces.interfaces.length) || adapters.some((a) => a.type === 'wifi'),
    service: raw.wlanService || system.wlanService || null,
    interfaces: wifiInterfaces.interfaces || [],
    current: wifiInterfaces.current || null,
    error: wifiInterfaces.error || null,
    profiles: profileState.ok ? profileState.profiles || [] : [],
    profilesError: profileState.ok ? null : profileState.error || null,
  };
  if (wifi.current) {
    const adapter = adapters.find(
      (a) => a.type === 'wifi' && (a.name === wifi.current.name || a.description === wifi.current.description),
    );
    if (adapter) wifi.current.interfaceIndex = adapter.interfaceIndex;
  }
  const snapshot = {
    ok: raw.ok,
    error: raw.error || null,
    capturedAt: raw.capturedAt || new Date().toISOString(),
    system,
    adapters,
    routes,
    defaultRoutes: routes
      .filter((r) => r.nextHop && r.nextHop !== '0.0.0.0')
      .sort((a, b) => a.effectiveMetric - b.effectiveMetric),
    active,
    proxy: raw.proxy || { enabled: false, server: '', pac: '', override: '' },
    wlanService: raw.wlanService || system.wlanService || null,
    dnsClients: raw.dnsClients || [],
    wifi,
    physicalAdapters: adapters.filter((a) => a.type === 'wifi' || a.type === 'ethernet'),
    wifiAdapters: adapters.filter((a) => a.type === 'wifi'),
    ethernetAdapters: adapters.filter((a) => a.type === 'ethernet'),
    virtualAdapters: adapters.filter((a) => a.type === 'virtual'),
    issues: [],
  };
  snapshot.issues = buildIssues(snapshot);
  return snapshot;
}

async function getPublicIp() {
  const endpoints = [
    { url: 'https://api.ip.sb/geoip', map: (d) => ({ ip: d.ip, country: d.country, city: d.city, isp: d.isp, org: d.organization }) },
    { url: 'https://ipinfo.io/json', map: (d) => ({ ip: d.ip, country: d.country, city: d.city, isp: d.org, org: d.org }) },
    { url: 'https://api.ipify.org?format=json', map: (d) => ({ ip: d.ip, country: '', city: '', isp: '', org: '' }) },
  ];
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(endpoint.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'WiFiMedic/1.0' },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const mapped = endpoint.map(data);
      if (mapped.ip) return { ok: true, ...mapped, source: endpoint.url };
    } catch {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: '公网 IP 查询失败（可能被代理、防火墙或网络策略拦截）' };
}

async function getRecentNetworkEvents() {
  const script = `
    $result = @()
    $logs = @(
      @{Name='Microsoft-Windows-WLAN-AutoConfig/Operational'; Label='WLAN'},
      @{Name='Microsoft-Windows-Dhcp-Client/Admin'; Label='DHCP'}
    )
    foreach($log in $logs){
      try {
        $events = @(Get-WinEvent -FilterHashtable @{LogName=$log.Name; StartTime=(Get-Date).AddDays(-1); Level=1,2,3} -MaxEvents 12 -ErrorAction Stop)
        foreach($e in $events){
          $result += [pscustomobject]@{
            source = $log.Label
            level = [string]$e.LevelDisplayName
            time = $e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')
            id = $e.Id
            message = ($e.Message -replace '\\r?\\n',' ').Substring(0, [Math]::Min(260, ($e.Message -replace '\\r?\\n',' ').Length))
          }
        }
      } catch {}
    }
    @($result) | ConvertTo-Json -Depth 4 -Compress
  `;
  const res = await psJson(script, { timeout: 18000 });
  if (!res.ok) return { ok: false, error: res.error, events: [] };
  return { ok: true, events: safeArray(res.data) };
}

async function restartWlanService() {
  const res = await ps(
    `try { Restart-Service -Name '${WLAN_SERVICE}' -Force -ErrorAction Stop; (Get-Service '${WLAN_SERVICE}').Status } catch { Write-Output ('ERROR: ' + $_.Exception.Message); exit 1 }`,
    { timeout: 25000 },
  );
  return {
    ok: res.ok && !/ERROR:/i.test(res.stdout || ''),
    output: normalizeText(`${res.stdout}\n${res.stderr}`),
  };
}

module.exports = {
  getSnapshot,
  getRawNetwork,
  getSystemInfo,
  getWifiInterfaces,
  scanWifiNetworks,
  getWifiProfiles,
  getWifiProfileDetail,
  verifyWifiPassword,
  connectWifiProfile,
  getWifiCapabilities,
  parseWifiProfileDetail,
  getPublicIp,
  getRecentNetworkEvents,
  parseNetshInterfaces,
  parseNetshNetworks,
  analyzeChannels,
  classifyAdapter,
  inferBand,
  channelToFrequency,
  restartWlanService,
};
