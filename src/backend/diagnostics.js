'use strict';

const { performance } = require('node:perf_hooks');
const { getSnapshot, scanWifiNetworks, getRecentNetworkEvents } = require('./network');
const {
  pingHost,
  pingBatch,
  dnsTest,
  tcpTest,
  httpTest,
  measureStability,
  mtuTest,
  traceRoute,
  round,
} = require('./ping');
const { PING_TARGETS, SCORE_LABELS } = require('./constants');
const { isAdmin } = require('./win');

const STAGE_DEFS = [
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

function nowIso() {
  return new Date().toISOString();
}

function severityRank(value) {
  return { info: 1, warning: 2, critical: 3 }[value] || 0;
}

function stateText(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '--';
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
  };
  const key = raw.toLowerCase();
  if (known[key]) return known[key];
  if (/^up\b/i.test(raw)) return '已启用';
  if (/^connected/i.test(raw)) return '已连接';
  if (/^disconnected/i.test(raw)) return '未连接';
  if (/^stopped/i.test(raw)) return '已停止';
  if (/^running/i.test(raw)) return '运行中';
  if (/^manual/i.test(raw)) return '手动';
  return raw;
}

function safeAdapter(adapter) {
  if (!adapter) return null;
  return {
    name: adapter.name,
    description: adapter.description,
    interfaceIndex: adapter.interfaceIndex,
    type: adapter.type,
    kindLabel: adapter.kindLabel,
    status: stateText(adapter.status),
    up: adapter.up,
    linkSpeed: adapter.linkSpeed,
    mac: adapter.mac,
    driverVersion: adapter.driverVersion,
    ipv4: adapter.ipv4,
    ipv6: adapter.ipv6,
    primaryIp: adapter.primaryIp,
    gateway: adapter.gateway,
    dns: adapter.dns,
    dhcp: adapter.dhcp,
    interfaceMetric: adapter.interfaceMetric,
    isApipa: adapter.isApipa,
    profile: adapter.profile,
  };
}

function parseLinkMbps(linkSpeed) {
  const text = String(linkSpeed || '').toLowerCase();
  const value = Number((text.match(/[\d.]+/) || [0])[0]);
  if (!value) return null;
  if (text.includes('gbps') || text.includes('gbit')) return value * 1000;
  if (text.includes('kbps')) return value / 1000;
  return value;
}

function isWifiAdapter(adapter) {
  return adapter && adapter.type === 'wifi';
}

function wifiSecurityWeak(wifi) {
  if (!wifi) return { weak: false, reason: '' };
  const auth = String(wifi.authentication || '');
  const cipher = String(wifi.cipher || '');
  if (/open|开放式|none|无/i.test(auth) && !/wep/i.test(cipher)) {
    return { weak: true, reason: '开放网络，没有加密保护' };
  }
  if (/wep/i.test(auth) || /wep/i.test(cipher)) {
    return { weak: true, reason: '使用已淘汰的 WEP 加密' };
  }
  if (/wpa(?!2|3)/i.test(auth) && !/wpa2|wpa3/i.test(auth)) {
    return { weak: true, reason: '使用旧版 WPA 加密，建议升级 WPA2/WPA3' };
  }
  return { weak: false, reason: '' };
}

function buildVerdict(score, issues, stages) {
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const failedStages = stages.filter((s) => s.status === 'fail').length;
  let status = 'pass';
  if (critical > 0 || score < 55 || failedStages >= 3) status = 'fail';
  else if (warnings > 0 || score < 80 || failedStages > 0) status = 'warn';
  const label = SCORE_LABELS.find((l) => score >= l.min) || SCORE_LABELS[SCORE_LABELS.length - 1];
  return {
    status,
    label: label.label,
    tone: label.tone,
    summary: label.summary,
    critical,
    warnings,
    failedStages,
  };
}

async function runFullDiagnostic(options = {}) {
  const started = performance.now();
  const startedAt = nowIso();
  const emit = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const logs = [];
  const stages = [];
  const issues = [];
  const penalized = new Set();
  let score = 100;

  const log = (level, message) => {
    const item = { time: nowIso(), level, message };
    logs.push(item);
    emit({ type: 'log', ...item });
  };

  const addIssue = (severity, code, title, detail, fix, impact = 0, action = null) => {
    const existing = issues.find((i) => i.code === code);
    if (existing) {
      if (severityRank(severity) > severityRank(existing.severity)) {
        existing.severity = severity;
        existing.title = title;
        existing.detail = detail;
        existing.fix = fix;
        existing.action = action || existing.action;
      }
    } else {
      issues.push({ severity, code, title, detail, fix, action, scoreImpact: impact });
    }
    if (impact > 0 && !penalized.has(code)) {
      score -= impact;
      penalized.add(code);
    }
  };

  emit({ type: 'diagnostic-start', startedAt, totalStages: STAGE_DEFS.length });
  log('info', '开始全维度网络体检，正在读取系统网络配置…');

  let snapshot;
  try {
    snapshot = options.snapshot || (await getSnapshot());
  } catch (error) {
    const report = {
      ok: false,
      error: `无法读取网络配置: ${String(error.message || error)}`,
      startedAt,
      finishedAt: nowIso(),
      stages,
      issues: [
        {
          severity: 'critical',
          code: 'SNAPSHOT_FAIL',
          title: '无法读取系统网络配置',
          detail: String(error.message || error),
          fix: '请尝试以管理员身份运行，或检查 Windows 管理工具是否可用。',
        },
      ],
    };
    emit({ type: 'diagnostic-complete', report });
    return report;
  }

  for (const issue of snapshot.issues || []) {
    if (!issues.find((i) => i.code === issue.code)) issues.push(issue);
  }

  const selectedAdapter =
    (options.ifIndex != null && snapshot.adapters.find((a) => a.interfaceIndex === Number(options.ifIndex))) ||
    snapshot.active.adapter ||
    null;
  const selectedIsActive = Boolean(
    selectedAdapter && snapshot.active.adapter && selectedAdapter.interfaceIndex === snapshot.active.adapter.interfaceIndex,
  );
  const sourceIp = selectedAdapter && selectedAdapter.primaryIp ? selectedAdapter.primaryIp.address : null;
  const activeAdapter = snapshot.active.adapter;
  const gateway = selectedAdapter && selectedAdapter.gateway.length ? selectedAdapter.gateway[0] : null;
  const admin = await isAdmin();

  const runStage = async (id, fn) => {
    const def = STAGE_DEFS.find((s) => s.id === id);
    const index = STAGE_DEFS.indexOf(def) + 1;
    const stageStarted = performance.now();
    const stageStartedAt = nowIso();
    emit({
      type: 'stage-start',
      id,
      label: def.label,
      icon: def.icon,
      index,
      total: STAGE_DEFS.length,
      startedAt: nowIso(),
    });
    log('stage', `[${index}/${STAGE_DEFS.length}] ${def.label}`);
    let result;
    try {
      result = await fn();
    } catch (error) {
      result = {
        status: 'fail',
        summary: `检查失败：${String(error.message || error)}`,
        data: { error: String(error.message || error) },
      };
      log('error', `${def.label}：${String(error.message || error)}`);
    }
    const stage = {
      id,
      label: def.label,
      icon: def.icon,
      index,
      total: STAGE_DEFS.length,
      status: result.status || 'info',
      summary: result.summary || '',
      detail: result.detail || '',
      durationMs: Math.round(performance.now() - stageStarted),
      data: result.data || {},
      startedAt: stageStartedAt,
    };
    stages.push(stage);
    emit({
      type: 'stage-end',
      ...stage,
      stage,
      score: Math.max(0, Math.min(100, score)),
    });
    log(
      stage.status === 'fail' ? 'error' : stage.status === 'warn' ? 'warn' : stage.status === 'skip' ? 'info' : 'success',
      `${def.label}：${stage.summary}`,
    );
    return stage;
  };

  /* 1. System */
  await runStage('system', async () => {
    const vpnLike = snapshot.adapters.filter(
      (a) =>
        a.up &&
        (a.type === 'virtual' ||
          /(vpn|wireguard|openvpn|tailscale|zerotier|clash|proxy|加速器|tun|tap)/i.test(
            `${a.name} ${a.description}`,
          )),
    );
    const proxy = snapshot.proxy || {};
    let status = 'pass';
    if (proxy.enabled) {
      status = 'warn';
      addIssue(
        'warning',
        'PROXY_ON',
        '系统代理处于开启状态',
        `代理服务器：${proxy.server || '未填写'}。如果代理软件没有运行，浏览器和部分应用会出现无法联网。`,
        '关闭代理软件后重试，或在「修复工具」中关闭系统代理。',
        5,
        { type: 'repair', id: 'resetProxy' },
      );
    }
    if (vpnLike.length) {
      status = status === 'pass' ? 'warn' : status;
      log('warn', `检测到虚拟 / VPN 通道：${vpnLike.map((a) => a.name).join('、')}`);
    }
    if (!admin) log('info', '当前为普通权限运行，部分修复功能需要管理员权限。');
    const hasWifiHardware = snapshot.wifiAdapters.length > 0 || Boolean(snapshot.wifi && snapshot.wifi.available);
    if (hasWifiHardware && snapshot.wlanService && /stopped|已停止/i.test(String(snapshot.wlanService.status))) {
      status = 'warn';
      addIssue(
        'warning',
        'WLAN_STOPPED',
        'WLAN 无线服务未运行',
        'Windows 无线自动配置服务已停止，无线网卡无法扫描或连接 Wi-Fi。',
        '在「修复工具」中启动 WLAN 服务，或手动运行 services.msc 启动 WLAN AutoConfig。',
        6,
        { type: 'repair', id: 'startWlan' },
      );
    }
    return {
      status,
      summary: `${snapshot.system.caption} · ${admin ? '管理员权限' : '普通权限'} · ${
        vpnLike.length ? `${vpnLike.length} 个虚拟/VPN 通道` : '未发现 VPN 干扰'
      } · 代理${proxy.enabled ? '开启' : '关闭'}`,
      data: {
        admin,
        system: snapshot.system,
        proxy,
        vpnLike: vpnLike.map(safeAdapter),
        wlanService: snapshot.wlanService,
      },
    };
  });

  /* 2. Channel */
  await runStage('channel', async () => {
    const routes = snapshot.defaultRoutes || [];
    const distinct = [...new Set(routes.map((r) => `${r.ifIndex}:${r.nextHop}`))];
    if (!activeAdapter) {
      addIssue(
        'critical',
        'NO_ACTIVE_ROUTE',
        '没有可用的默认上网通道',
        '系统没有找到带默认网关的可用网卡，电脑可能没有连接网络，或 DHCP 未成功获取地址。',
        '检查网线 / Wi-Fi 是否连接，尝试重新获取 IP，或重启路由器。',
        28,
        { type: 'navigate', view: 'channels' },
      );
      return {
        status: 'fail',
        summary: '未发现带默认网关的可用通道',
        data: { selected: null, active: null, defaultRoutes: routes, distinct },
      };
    }
    let status = 'pass';
    if (!selectedAdapter) status = 'warn';
    else if (!selectedAdapter.up) status = 'fail';
    else if (!selectedIsActive) status = 'warn';
    if (distinct.length > 1) {
      status = 'warn';
      addIssue(
        'warning',
        'MULTI_DEFAULT_ROUTE',
        '检测到多条默认路由',
        `系统同时存在 ${distinct.length} 条默认线路，Windows 会按跃点选择，可能导致上网通道与预期不一致。`,
        '在「网络通道」中确认当前生效线路，必要时手动设置网卡优先级。',
        4,
        { type: 'navigate', view: 'channels' },
      );
    }
    if (selectedAdapter && selectedAdapter.type === 'virtual') {
      status = 'warn';
      addIssue(
        'warning',
        'ACTIVE_VIRTUAL',
        '当前通道是虚拟网卡 / VPN',
        `系统正通过「${selectedAdapter.name}」上网。VPN、虚拟机或加速器异常时，会影响全部网络。`,
        '如不需要 VPN，请退出代理 / VPN 软件后再测试。',
        3,
        { type: 'navigate', view: 'channels' },
      );
    }
    return {
      status,
      summary: selectedAdapter
        ? `${selectedAdapter.kindLabel}通道「${selectedAdapter.name}」${selectedIsActive ? '（系统当前首选）' : '（非首选，仅诊断）'} · 默认路由 ${distinct.length} 条`
        : '没有匹配的网卡',
      data: {
        selected: safeAdapter(selectedAdapter),
        active: safeAdapter(activeAdapter),
        selectedIsActive,
        defaultRoutes: routes.map((r) => ({
          ifIndex: r.ifIndex,
          interfaceAlias: r.interfaceAlias,
          nextHop: r.nextHop,
          routeMetric: r.routeMetric,
          interfaceMetric: r.interfaceMetric,
          effectiveMetric: r.effectiveMetric,
        })),
        distinct,
      },
    };
  });

  /* 3. Link */
  await runStage('link', async () => {
    if (!selectedAdapter) {
      return { status: 'skip', summary: '未选择网卡，跳过链路检查', data: {} };
    }
    const wifi = selectedAdapter.type === 'wifi' ? snapshot.wifi.current : null;
    let status = 'pass';
    const details = [];
    if (!selectedAdapter.up) {
      status = 'fail';
      addIssue(
        'critical',
        'LINK_DOWN',
        `网卡「${selectedAdapter.name}」未连接`,
        `网卡状态为 ${stateText(selectedAdapter.status) || '未知'}，无法承载网络流量。`,
        '检查网线、Wi-Fi 开关、驱动状态，或启用该网卡。',
        22,
        { type: 'navigate', view: 'channels' },
      );
    }
    const linkMbps = parseLinkMbps(selectedAdapter.linkSpeed);
    if (selectedAdapter.type === 'ethernet' && linkMbps != null && linkMbps < 100) {
      status = status === 'pass' ? 'warn' : status;
      details.push(`有线协商速率仅 ${selectedAdapter.linkSpeed}`);
      addIssue(
        'warning',
        'LOW_LINK_SPEED',
        '有线链路协商速率偏低',
        `当前链路速率为 ${selectedAdapter.linkSpeed}，可能使用了老网线、百兆口或网线质量不佳。`,
        '更换超五类/六类网线，确认路由器和电脑网口均为千兆。',
        3,
        { type: 'navigate', view: 'channels' },
      );
    }
    if (selectedAdapter.type === 'wifi') {
      if (!wifi) {
        status = status === 'pass' ? 'warn' : status;
        details.push('无线网卡未连接到任何 SSID');
        addIssue(
          'warning',
          'WIFI_NOT_CONNECTED',
          '无线网卡未连接 Wi-Fi',
          '当前没有已连接的无线网络，电脑无法通过 Wi-Fi 上网。',
          '在 Windows Wi-Fi 列表中选择并连接可用网络。',
          12,
          { type: 'navigate', view: 'wifi' },
        );
      } else {
        const signal = Number(wifi.signal);
        details.push(`信号 ${wifi.signal ?? '?'}% · ${wifi.band || ''} 信道 ${wifi.channel || '?'} · ${wifi.radioType || ''}`);
        if (Number.isFinite(signal) && signal < 35) {
          status = 'fail';
          addIssue(
            'warning',
            'WEAK_WIFI',
            'Wi-Fi 信号很弱',
            `当前信号 ${signal}%，容易出现丢包、延迟升高和速率下降。`,
            '靠近路由器，优先连接 5GHz 频段，或调整路由器位置与天线。',
            10,
            { type: 'navigate', view: 'wifi' },
          );
        } else if (Number.isFinite(signal) && signal < 55) {
          status = status === 'pass' ? 'warn' : status;
          addIssue(
            'warning',
            'WEAK_WIFI',
            'Wi-Fi 信号偏弱',
            `当前信号 ${signal}%，建议靠近路由器或切换到 5GHz。`,
            '移动到信号更好的位置，避免承重墙和金属遮挡。',
            5,
            { type: 'navigate', view: 'wifi' },
          );
        }
        const sec = wifiSecurityWeak(wifi);
        if (sec.weak) {
          status = status === 'pass' ? 'warn' : status;
          addIssue(
            'warning',
            'WIFI_SECURITY_WEAK',
            'Wi-Fi 安全配置较弱',
            `${sec.reason}。`,
            '在路由器管理后台将无线加密升级为 WPA2-AES 或 WPA3。',
            5,
            { type: 'navigate', view: 'wifi' },
          );
        }
      }
    }
    return {
      status,
      summary:
        details.length > 0
          ? `${selectedAdapter.name} · ${details.join(' · ')}`
          : `${selectedAdapter.name} · ${selectedAdapter.linkSpeed || '链路正常'} · ${stateText(selectedAdapter.status)}`,
      data: {
        adapter: safeAdapter(selectedAdapter),
        wifi: wifi || null,
        linkMbps,
      },
    };
  });

  /* 4. IP */
  await runStage('ip', async () => {
    if (!selectedAdapter) {
      return { status: 'skip', summary: '未选择网卡，跳过 IP 检查', data: {} };
    }
    let status = 'pass';
    const ipv4 = selectedAdapter.ipv4[0] || null;
    const duplicate = ipv4
      ? snapshot.adapters.filter(
          (a) => a.interfaceIndex !== selectedAdapter.interfaceIndex && a.ipv4.some((ip) => ip.address === ipv4.address),
        )
      : [];
    if (!ipv4) {
      status = 'fail';
      addIssue(
        'critical',
        'NO_IP',
        '网卡没有 IPv4 地址',
        `「${selectedAdapter.name}」未获得 IPv4 地址，无法访问 IPv4 互联网。`,
        '重新获取 IP，或检查网卡 IPv4 设置是否为自动获取。',
        22,
        { type: 'repair', id: 'renewDhcp' },
      );
    } else if (selectedAdapter.isApipa) {
      status = 'fail';
      addIssue(
        'critical',
        'APIPA',
        '获取到 169.254 开头的无效地址',
        `${selectedAdapter.name} 未从路由器获得有效 IP，通常表示 DHCP 失败或网线 / Wi-Fi 未真正连通。`,
        '重新获取 IP 地址，检查路由器 DHCP 服务，或更换网线 / 重新连接 Wi-Fi。',
        24,
        { type: 'repair', id: 'renewDhcp' },
      );
    }
    if (!selectedAdapter.gateway.length) {
      status = 'fail';
      addIssue(
        'critical',
        'NO_GATEWAY',
        '当前通道缺少默认网关',
        '没有默认网关，电脑只能访问同网段设备，无法访问互联网。',
        '检查路由器 / 光猫连接，或重新获取 DHCP。',
        20,
        { type: 'repair', id: 'renewDhcp' },
      );
    }
    if (!selectedAdapter.dns.length) {
      status = status === 'pass' ? 'warn' : status;
      addIssue(
        'warning',
        'NO_DNS',
        '当前通道没有配置 DNS',
        '没有 DNS 服务器时，IP 能通但域名无法解析，表现为网页打不开、应用无法登录。',
        '将 DNS 设置为自动获取，或切换为公共 DNS。',
        8,
        { type: 'repair', id: 'setPublicDns' },
      );
    }
    if (duplicate.length) {
      status = 'fail';
      addIssue(
        'critical',
        'DUPLICATE_IP',
        '检测到重复的 IP 地址',
        `IP ${ipv4.address} 同时出现在「${duplicate.map((a) => a.name).join('、')}」，可能造成局域网冲突。`,
        '重新获取 IP，或在路由器中检查 DHCP 地址池与静态 IP 设置。',
        15,
        { type: 'repair', id: 'renewDhcp' },
      );
    }
    return {
      status,
      summary: ipv4
        ? `${ipv4.address}/${ipv4.prefixLength} · 网关 ${selectedAdapter.gateway[0] || '无'} · DNS ${selectedAdapter.dns.join(', ') || '无'} · ${selectedAdapter.dhcp ? '自动获取' : '静态配置'}`
        : '未获取到 IPv4 地址',
      data: {
        ipv4,
        gateway: selectedAdapter.gateway,
        dns: selectedAdapter.dns,
        dhcp: selectedAdapter.dhcp,
        prefixOrigin: ipv4 ? ipv4.prefixOrigin : '',
        suffixOrigin: ipv4 ? ipv4.suffixOrigin : '',
        duplicate: duplicate.map((a) => a.name),
        ipv6: selectedAdapter.ipv6,
      },
    };
  });

  /* 5. Gateway */
  await runStage('gateway', async () => {
    if (!gateway) {
      return { status: 'skip', summary: '没有默认网关，跳过网关探测', data: {} };
    }
    const result = await pingHost(gateway, { count: 4, timeout: 1000, sourceIp });
    let status = 'pass';
    if (result.replies === 0) {
      status = 'fail';
      addIssue(
        'critical',
        'GATEWAY_UNREACHABLE',
        '默认网关无法 Ping 通',
        `网关 ${gateway} 没有响应。电脑与路由器之间的链路可能中断，或路由器禁用了 ICMP。`,
        '检查网线 / Wi-Fi 连接、重启路由器；如果只是 ICMP 被禁用，可继续观察 DNS 与网页访问结果。',
        20,
        { type: 'repair', id: 'renewDhcp' },
      );
    } else if (!result.fullSuccess) {
      status = 'warn';
      addIssue(
        'warning',
        'GATEWAY_LOSS',
        '默认网关存在丢包',
        `网关 ${gateway} 丢包 ${result.lossPct}%，局域网链路可能不稳定。`,
        '检查网线、Wi-Fi 信号和路由器负载。',
        8,
        { type: 'navigate', view: 'connectivity' },
      );
    } else if (result.avg != null && result.avg > 30) {
      status = 'warn';
    }
    return {
      status,
      summary: `${gateway} · ${result.replies}/4 响应 · 平均 ${result.avg ?? '-'} ms · 丢包 ${result.lossPct}%`,
      data: { ping: result },
    };
  });

  /* 6. DNS */
  await runStage('dns', async () => {
    const result = await dnsTest();
    const failedRequired = result.system.filter((d) => d.required && !d.ok);
    const failedOptional = result.system.filter((d) => !d.required && !d.ok);
    let status = 'pass';
    if (failedRequired.length > 0) {
      status = 'fail';
      addIssue(
        'critical',
        'DNS_FAIL',
        '关键域名解析失败',
        `${failedRequired.map((d) => d.domain).join('、')} 无法解析。IP 能通但域名打不开时，优先检查 DNS。`,
        '刷新 DNS 缓存；仍失败时切换为阿里云 223.5.5.5 或腾讯 119.29.29.29。',
        20,
        { type: 'repair', id: 'setPublicDns' },
      );
    } else if (failedOptional.length > 0) {
      status = 'warn';
      addIssue(
        'warning',
        'DNS_PARTIAL',
        '部分域名解析失败',
        `${failedOptional.map((d) => d.domain).join('、')} 解析失败，可能是目标域名被限制或 DNS 缓存异常。`,
        '刷新 DNS 缓存后重试，必要时切换 DNS。',
        5,
        { type: 'repair', id: 'flushDns' },
      );
    }
    if (result.summary.avgLatency != null && result.summary.avgLatency > 180) {
      status = status === 'pass' ? 'warn' : status;
      addIssue(
        'warning',
        'DNS_SLOW',
        'DNS 解析延迟偏高',
        `平均解析耗时 ${result.summary.avgLatency} ms，网页首次打开可能明显变慢。`,
        '切换到更快的公共 DNS，或检查路由器 DNS 转发性能。',
        4,
        { type: 'repair', id: 'setPublicDns' },
      );
    }
    const systemFailed = result.system.some((d) => !d.ok);
    const publicOk = result.publicResolvers.some((r) => r.ok);
    if (systemFailed && publicOk) {
      addIssue(
        'warning',
        'DNS_SERVER_DIFF',
        '系统 DNS 异常，但公共 DNS 可用',
        '本机配置的 DNS 服务器响应异常，而公共 DNS 可以解析。问题更可能出在路由器 DNS 转发或运营商 DNS。',
        '切换为公共 DNS，或在路由器中修改 DNS 设置。',
        4,
        { type: 'repair', id: 'setPublicDns' },
      );
    }
    return {
      status,
      summary: `${result.summary.success}/${result.summary.total} 个域名解析成功 · 平均 ${result.summary.avgLatency ?? '-'} ms · 公共 DNS ${result.publicResolvers.filter((r) => r.ok).length}/${result.publicResolvers.length} 可用`,
      data: result,
    };
  });

  /* 7. ICMP */
  await runStage('icmp', async () => {
    const results = await pingBatch(
      PING_TARGETS,
      { count: 4, timeout: 1200, concurrency: 6, sourceIp },
      (partial) => {
        emit({
          type: 'ping-result',
          stage: 'icmp',
          result: partial,
          score: Math.max(0, Math.min(100, score)),
        });
      },
    );
    const required = results.filter((r) => r.required);
    const failedRequired = required.filter((r) => !r.success);
    const failedOptional = results.filter((r) => !r.required && !r.success);
    const reachable = results.filter((r) => r.success);
    let status = 'pass';
    if (failedRequired.length > 0) {
      status = 'fail';
      addIssue(
        'critical',
        'ICMP_FAIL',
        `${failedRequired.length} 个关键厂商节点无法 Ping 通`,
        `失败节点：${failedRequired.map((r) => `${r.name}(${r.host})`).join('、')}。可能是网络出口故障、目标 ICMP 限制或防火墙拦截。`,
        '结合 DNS 与网页访问结果判断；如果只有个别节点失败，通常不影响上网。',
        Math.min(30, failedRequired.length * 5),
        { type: 'navigate', view: 'connectivity' },
      );
    } else if (failedOptional.length > 0) {
      status = 'warn';
      addIssue(
        'info',
        'ICMP_OPTIONAL',
        '部分国际节点不可达',
        `可选国际节点：${failedOptional.map((r) => r.name).join('、')}。国内网络访问国际服务受限时属于常见情况。`,
        '如需要访问国际服务，请检查代理 / VPN 或运营商国际出口。',
        0,
        { type: 'navigate', view: 'connectivity' },
      );
    }
    const avg = reachable.filter((r) => r.avg != null).map((r) => r.avg);
    const avgLatency = avg.length ? round(avg.reduce((a, b) => a + b, 0) / avg.length) : null;
    if (avgLatency != null && avgLatency > 200) {
      status = status === 'pass' ? 'warn' : status;
      addIssue(
        'warning',
        'HIGH_ICMP_LATENCY',
        '外网 Ping 延迟偏高',
        `平均 ${avgLatency} ms，可能存在 Wi-Fi 干扰、路由器拥塞或运营商线路绕路。`,
        '使用 5GHz Wi-Fi、减少下载占用，并检查路由器负载。',
        4,
        { type: 'navigate', view: 'stability' },
      );
    }
    return {
      status,
      summary: `必测 ${required.filter((r) => r.success).length}/${required.length} 连通 · 全部 ${reachable.length}/${results.length} 可达 · 平均 ${avgLatency ?? '-'} ms`,
      data: {
        results,
        requiredTotal: required.length,
        requiredReachable: required.filter((r) => r.success).length,
        optionalFailed: failedOptional.map((r) => r.name),
        avgLatency,
      },
    };
  });

  /* 8. TCP */
  await runStage('tcp', async () => {
    const result = await tcpTest({ localAddress: sourceIp });
    const failedRequired = result.results.filter((r) => r.required && !r.ok);
    const failedOptional = result.results.filter((r) => !r.required && !r.ok);
    let status = 'pass';
    if (failedRequired.length > 0) {
      status = 'fail';
      addIssue(
        'critical',
        'TCP_FAIL',
        '关键网站 443 端口无法建立连接',
        `${failedRequired.map((r) => r.name).join('、')} 连接失败。可能是 DNS、TLS 拦截、代理或出口防火墙问题。`,
        '先检查 DNS 与系统代理，再尝试直接访问网站对比。',
        Math.min(20, failedRequired.length * 6),
        { type: 'navigate', view: 'connectivity' },
      );
    } else if (failedOptional.length > 0) {
      status = 'warn';
    }
    if (result.summary.avgLatency != null && result.summary.avgLatency > 220) {
      status = status === 'pass' ? 'warn' : status;
    }
    return {
      status,
      summary: `${result.summary.success}/${result.summary.total} 个 HTTPS 服务可连接 · 平均握手 ${result.summary.avgLatency ?? '-'} ms`,
      data: result,
    };
  });

  /* 9. Web */
  await runStage('web', async () => {
    const result = await httpTest({ localAddress: sourceIp });
    const failed = result.results.filter((r) => !r.ok);
    let status = 'pass';
    if (result.summary.reachable === 0) {
      status = 'fail';
      addIssue(
        'critical',
        'HTTP_FAIL',
        '网页访问测试全部失败',
        'HTTP / HTTPS 请求无法完成，可能是代理、DNS、路由或防火墙问题。',
        '关闭代理软件后重试；检查 DNS 与默认网关；必要时重置 Winsock。',
        16,
        { type: 'navigate', view: 'repair' },
      );
    } else if (failed.length > 0) {
      status = 'warn';
    }
    const portal = result.results.find(
      (r) => r.id === 'miui-204' && !r.ok && (r.statusCode === 200 || r.statusCode === 302 || r.statusCode === 301),
    );
    const msft = result.results.find((r) => r.id === 'msft-connect');
    if (portal || (msft && !msft.ok && msft.statusCode === 200)) {
      addIssue(
        'warning',
        'CAPTIVE_PORTAL',
        '疑似被强制门户 / 认证页面拦截',
        '网络探测请求没有返回预期的 204 或标准内容，可能连接到了需要网页认证的公共 Wi-Fi。',
        '打开浏览器访问任意 HTTP 网站，完成登录认证后再测试。',
        8,
        { type: 'openUrl', url: 'http://connect.rom.miui.com/generate_204' },
      );
    }
    const certError = result.results.find((r) => /CERT|certificate|证书/i.test(String(r.error || '')));
    if (certError) {
      addIssue(
        'warning',
        'CERT_ERROR',
        'HTTPS 证书校验异常',
        `访问 ${certError.name} 时证书校验失败（${certError.error}），可能存在代理中间人、系统时间错误或网络劫持。`,
        '检查系统时间、代理软件和证书设置；不要在不可信网络输入敏感信息。',
        5,
        { type: 'navigate', view: 'repair' },
      );
    }
    return {
      status,
      summary: `${result.summary.reachable}/${result.summary.total} 个 HTTP 探测通过${portal ? ' · 疑似强制门户' : ''}`,
      data: result,
    };
  });

  /* 10. Stability */
  await runStage('stability', async () => {
    const result = await measureStability({
      gateway,
      host: '223.5.5.5',
      count: 8,
      sourceIp,
    });
    const internet = result.internet;
    const gw = result.gateway;
    let status = 'pass';
    if (internet && internet.replies === 0) {
      status = 'fail';
      addIssue(
        'critical',
        'INTERNET_UNREACHABLE',
        '互联网稳定性测试完全失败',
        '连续 8 次 Ping 阿里云 DNS 均无响应，外网链路可能中断。',
        '检查路由器 WAN 口、光猫指示灯和运营商线路；必要时重启网络设备。',
        18,
        { type: 'navigate', view: 'stability' },
      );
    } else if (internet && (internet.lossPct >= 8 || (internet.jitter != null && internet.jitter > 40))) {
      status = 'warn';
      addIssue(
        'warning',
        'UNSTABLE',
        '网络存在丢包或抖动',
        `外网丢包 ${internet.lossPct}%，抖动 ${internet.jitter ?? '-'} ms。视频会议、游戏可能卡顿。`,
        '优先使用 5GHz Wi-Fi 或有线连接，检查路由器负载与无线干扰。',
        8,
        { type: 'navigate', view: 'stability' },
      );
    } else if (internet && internet.avg != null && internet.avg > 120) {
      status = 'warn';
    }
    if (gw && gw.replies > 0 && gw.lossPct > 0) {
      status = status === 'pass' ? 'warn' : status;
    }
    return {
      status,
      summary: internet
        ? `外网 ${internet.replies}/8 响应 · 丢包 ${internet.lossPct}% · 平均 ${internet.avg ?? '-'} ms · 抖动 ${internet.jitter ?? '-'} ms${
            gw ? ` · 网关丢包 ${gw.lossPct}%` : ''
          }`
        : '稳定性测试失败',
      data: result,
    };
  });

  /* 11. MTU */
  await runStage('mtu', async () => {
    const result = await mtuTest({ host: '223.5.5.5', sourceIp });
    let status = 'info';
    if (!result.unknown && result.mtu != null) {
      if (result.mtu < 1280) {
        status = 'fail';
        addIssue(
          'critical',
          'LOW_MTU',
          'MTU 值异常偏低',
          `探测到的 MTU 约 ${result.mtu}，可能导致部分网站或 VPN 无法访问。`,
          '检查 PPPoE、VPN、路由器 MTU 设置，通常应为 1500 或 1492。',
          8,
          { type: 'navigate', view: 'repair' },
        );
      } else if (result.mtu < 1400) {
        status = 'warn';
        addIssue(
          'warning',
          'MTU_LOW',
          'MTU 小于常规值',
          `探测到的 MTU 约 ${result.mtu}，可能由 PPPoE、VPN 或中间设备导致。`,
          '若个别网站打不开但其他正常，可尝试将路由器 MTU 调整为 1492 或 1480。',
          3,
          { type: 'navigate', view: 'repair' },
        );
      } else {
        status = 'pass';
      }
    }
    return {
      status,
      summary: result.unknown
        ? '目标未响应分片探测，无法确认 MTU（通常不影响正常上网）'
        : `估算 MTU ${result.mtu ?? '未知'}${result.mtu === 1500 ? '（标准）' : ''}`,
      data: result,
    };
  });

  /* 12. Wi-Fi */
  await runStage('wifi', async () => {
    if (!snapshot.wifi.available && snapshot.wifiAdapters.length === 0) {
      return {
        status: 'info',
        summary: '未检测到无线网卡，当前为有线通道',
        data: { available: false, reason: 'NO_WIFI_ADAPTER' },
      };
    }
    if (snapshot.wlanService && /stopped|已停止/i.test(String(snapshot.wlanService.status))) {
      return {
        status: 'warn',
        summary: 'WLAN 服务未运行，无法扫描周边 Wi-Fi',
        data: { available: true, service: snapshot.wlanService, reason: 'WLAN_STOPPED' },
      };
    }
    const scan = await scanWifiNetworks();
    if (!scan.ok) {
      return {
        status: 'warn',
        summary: scan.error || 'Wi-Fi 扫描失败',
        data: { available: true, error: scan.error },
      };
    }
    const current = snapshot.wifi.current;
    const currentBand = current ? current.band : null;
    const currentChannel = current ? current.channel : null;
    const coChannel = currentChannel
      ? scan.networks.filter((n) => n.channel === currentChannel && n.band === currentBand)
      : [];
    const strongCoChannel = coChannel.filter((n) => (n.signal || 0) >= 55);
    let status = 'pass';
    if (strongCoChannel.length >= 3) {
      status = 'warn';
      addIssue(
        'warning',
        'WIFI_CONGESTION',
        '当前 Wi-Fi 信道拥挤',
        `信道 ${currentChannel} 上有 ${strongCoChannel.length} 个较强信号，可能与你的网络互相干扰。`,
        `建议在路由器中将信道调整为 ${scan.analysis.recommended[currentBand] || '干扰更少的信道'}。`,
        4,
        { type: 'navigate', view: 'wifi' },
      );
    }
    if (current && current.signal != null && current.signal < 45) {
      status = status === 'pass' ? 'warn' : status;
    }
    return {
      status,
      summary: current
        ? `${current.ssid} · 信号 ${current.signal}% · ${current.band || ''} 信道 ${current.channel || '?'} · 周边 ${scan.networks.length} 个 AP`
        : `周边扫描到 ${scan.networks.length} 个 Wi-Fi 网络`,
      data: {
        available: true,
        current,
        networks: scan.networks,
        analysis: scan.analysis,
        coChannel: strongCoChannel.map((n) => ({ ssid: n.ssid, signal: n.signal, bssid: n.bssid })),
      },
    };
  });

  /* 13. Events */
  await runStage('events', async () => {
    const result = await getRecentNetworkEvents();
    if (!result.ok) {
      return {
        status: 'info',
        summary: '无法读取网络事件日志（权限或日志服务限制）',
        data: { error: result.error, events: [] },
      };
    }
    const events = result.events || [];
    const errors = events.filter((e) => /错误|error|critical|严重/i.test(String(e.level)));
    const warnings = events.filter((e) => /警告|warning/i.test(String(e.level)));
    let status = 'pass';
    if (errors.length + warnings.length >= 3) {
      status = 'warn';
      addIssue(
        'warning',
        'EVENT_ERRORS',
        '最近 24 小时存在网络事件',
        `WLAN / DHCP 日志中有 ${errors.length} 条错误、${warnings.length} 条警告，可能存在反复掉线或认证失败。`,
        '查看事件详情；若反复掉线，更新无线网卡驱动并重启 WLAN 服务。',
        4,
        { type: 'navigate', view: 'repair' },
      );
    }
    return {
      status,
      summary: events.length
        ? `24 小时内 ${events.length} 条 WLAN/DHCP 警告或错误`
        : '最近 24 小时未发现 WLAN/DHCP 异常事件',
      data: { events, errors: errors.length, warnings: warnings.length },
    };
  });

  /* 14. Route */
  await runStage('route', async () => {
    if (!activeAdapter) {
      return { status: 'skip', summary: '没有可用通道，跳过路由追踪', data: {} };
    }
    const trace = await traceRoute({ host: '223.5.5.5', maxHops: 10, timeout: 450 });
    if (!trace.ok) {
      return {
        status: 'info',
        summary: '目标或中间设备屏蔽了 ICMP，路由追踪未完成（不代表网络故障）',
        data: trace,
      };
    }
    const timeouts = trace.hops.filter((h) => h.timedOut).length;
    const status = timeouts > trace.hops.length / 2 ? 'info' : 'pass';
    return {
      status,
      summary: `经过 ${trace.hops.length} 跳 · ${timeouts} 跳超时 · 耗时 ${trace.durationMs} ms`,
      data: trace,
    };
  });

  /* Finalize */
  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = buildVerdict(score, issues, stages);
  const requiredIcmp = stages.find((s) => s.id === 'icmp');
  const icmpData = requiredIcmp ? requiredIcmp.data : null;
  const stats = {
    latency:
      (stages.find((s) => s.id === 'stability')?.data?.internet &&
        stages.find((s) => s.id === 'stability').data.internet.avg) ||
      (icmpData && icmpData.avgLatency) ||
      null,
    loss: stages.find((s) => s.id === 'stability')?.data?.internet?.lossPct ?? null,
    jitter: stages.find((s) => s.id === 'stability')?.data?.internet?.jitter ?? null,
    signal: snapshot.wifi.current ? snapshot.wifi.current.signal : null,
    requiredPing: icmpData ? `${icmpData.requiredReachable}/${icmpData.requiredTotal}` : null,
    totalPing: icmpData ? `${icmpData.results.filter((r) => r.success).length}/${icmpData.results.length}` : null,
  };
  const durationMs = Math.round(performance.now() - started);
  const report = {
    ok: true,
    app: 'WiFiMedic Pro',
    version: options.version || '1.0.0',
    startedAt,
    finishedAt: nowIso(),
    durationMs,
    score,
    verdict,
    status: verdict.status,
    stats,
    selectedAdapter: safeAdapter(selectedAdapter),
    activeAdapter: safeAdapter(activeAdapter),
    selectedIsActive,
    snapshot: {
      capturedAt: snapshot.capturedAt,
      system: snapshot.system,
      adapters: snapshot.adapters.map(safeAdapter),
      defaultRoutes: snapshot.defaultRoutes.map((r) => ({
        ifIndex: r.ifIndex,
        interfaceAlias: r.interfaceAlias,
        nextHop: r.nextHop,
        routeMetric: r.routeMetric,
        interfaceMetric: r.interfaceMetric,
        effectiveMetric: r.effectiveMetric,
      })),
      proxy: snapshot.proxy,
      wlanService: snapshot.wlanService,
      wifi: {
        available: snapshot.wifi.available,
        current: snapshot.wifi.current,
        service: snapshot.wifi.service,
      },
    },
    stages,
    issues: issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    logs,
    summary: verdict.summary,
  };
  emit({ type: 'diagnostic-complete', report });
  log('success', `体检完成：${score} 分 · ${verdict.label} · ${durationMs} ms`);
  return report;
}

module.exports = {
  runFullDiagnostic,
  STAGE_DEFS,
};
