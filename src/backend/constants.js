'use strict';

const APP_NAME = 'WiFiMedic Pro';
const APP_NAME_CN = 'WiFi 诊断专家';
const VERSION = '1.0.0';

/**
 * Public, long-lived IPs for the one-click connectivity check.
 * `required` targets participate in the "all reachable" verdict.
 * Optional international targets are still shown, but do not block a pass.
 */
const PING_TARGETS = [
  {
    id: 'aliyun-dns',
    name: '阿里云公共 DNS',
    vendor: '阿里云',
    host: '223.5.5.5',
    group: 'dns',
    required: true,
    note: '国内解析节点',
  },
  {
    id: 'tencent-dns',
    name: '腾讯云公共 DNS',
    vendor: '腾讯云',
    host: '119.29.29.29',
    group: 'dns',
    required: true,
    note: 'DNSPod 节点',
  },
  {
    id: 'baidu',
    name: '百度',
    vendor: '百度',
    host: '183.2.172.177',
    group: 'domestic',
    required: true,
    note: '百度搜索节点',
  },
  {
    id: 'alibaba',
    name: '阿里云',
    vendor: '阿里巴巴',
    host: '183.60.205.33',
    group: 'domestic',
    required: true,
    note: '阿里云官网节点',
  },
  {
    id: 'tencent',
    name: '腾讯',
    vendor: '腾讯',
    host: '183.60.118.213',
    group: 'domestic',
    required: true,
    note: '腾讯官网节点',
  },
  {
    id: 'jd',
    name: '京东',
    vendor: '京东',
    host: '119.147.159.135',
    group: 'domestic',
    required: true,
    note: '京东商城节点',
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    vendor: '哔哩哔哩',
    host: '14.17.92.72',
    group: 'domestic',
    required: true,
    note: 'B 站华南节点',
  },
  {
    id: 'apple',
    name: '苹果',
    vendor: 'Apple',
    host: '14.215.172.32',
    group: 'domestic',
    required: true,
    note: 'Apple 中国节点',
  },
  {
    id: 'microsoft',
    name: '微软',
    vendor: 'Microsoft',
    host: '184.85.72.208',
    group: 'global',
    required: false,
    note: 'Microsoft 全球节点（可选国际线路）',
  },
  {
    id: 'cloudflare-dns',
    name: 'Cloudflare DNS',
    vendor: 'Cloudflare',
    host: '1.1.1.1',
    group: 'dns',
    required: false,
    note: '全球任播 DNS（可选国际线路）',
  },
  {
    id: 'github',
    name: 'GitHub',
    vendor: 'GitHub',
    host: '20.205.243.166',
    group: 'global',
    required: false,
    note: '国际线路（可能受网络环境影响）',
  },
  {
    id: 'google-dns',
    name: 'Google DNS',
    vendor: 'Google',
    host: '8.8.8.8',
    group: 'global',
    required: false,
    note: '国际线路（可能被阻断）',
  },
  {
    id: 'google',
    name: 'Google',
    vendor: 'Google',
    host: '142.250.190.14',
    group: 'global',
    required: false,
    note: '国际线路（可能被阻断）',
  },
  {
    id: 'cloudflare-web',
    name: 'Cloudflare',
    vendor: 'Cloudflare',
    host: '104.16.124.96',
    group: 'global',
    required: false,
    note: '国际 CDN 节点',
  },
];

const DNS_DOMAINS = [
  { domain: 'www.baidu.com', name: '百度', required: true },
  { domain: 'www.aliyun.com', name: '阿里云', required: true },
  { domain: 'www.qq.com', name: '腾讯', required: true },
  { domain: 'www.microsoft.com', name: '微软', required: false },
  { domain: 'github.com', name: 'GitHub', required: false },
];

const TCP_SERVICES = [
  { host: 'www.baidu.com', port: 443, name: '百度 HTTPS', required: true },
  { host: 'www.taobao.com', port: 443, name: '淘宝 HTTPS', required: true },
  { host: 'www.qq.com', port: 443, name: '腾讯 HTTPS', required: true },
  { host: 'www.microsoft.com', port: 443, name: '微软 HTTPS', required: false },
  { host: 'www.apple.com', port: 443, name: '苹果 HTTPS', required: false },
  { host: 'github.com', port: 443, name: 'GitHub HTTPS', required: false },
];

const HTTP_PROBES = [
  {
    id: 'miui-204',
    url: 'http://connect.rom.miui.com/generate_204',
    name: '小米网络探测',
    expectStatus: 204,
  },
  {
    id: 'msft-connect',
    url: 'http://www.msftconnecttest.com/connecttest.txt',
    name: '微软连接测试',
    expectBody: 'Microsoft Connect Test',
  },
  {
    id: 'baidu-https',
    url: 'https://www.baidu.com/',
    name: '百度 HTTPS',
  },
];

const DNS_RESOLVERS = [
  { name: '阿里云 DNS', address: '223.5.5.5' },
  { name: '腾讯 DNS', address: '119.29.29.29' },
  { name: 'Cloudflare', address: '1.1.1.1' },
];

const REPAIR_ACTIONS = {
  flushDns: {
    id: 'flushDns',
    name: '刷新 DNS 缓存',
    description: '清空本机 DNS 缓存，修复域名解析到旧地址、网站打不开等问题。',
    command: 'Clear-DnsClientCache',
    admin: false,
    risk: 'safe',
    icon: 'dns',
  },
  clearArp: {
    id: 'clearArp',
    name: '重建 ARP 缓存',
    description: '清理局域网地址映射，修复网关 MAC 变化导致的短暂断网。',
    command: 'arp -d *',
    admin: true,
    risk: 'safe',
    icon: 'route',
  },
  renewDhcp: {
    id: 'renewDhcp',
    name: '重新获取 IP 地址',
    description: '释放并重新向路由器申请 DHCP 地址，修复 169.254 开头地址和 IP 冲突。',
    command: 'ipconfig /release & ipconfig /renew',
    admin: true,
    risk: 'caution',
    icon: 'ip',
  },
  restartAdapter: {
    id: 'restartAdapter',
    name: '重启当前网卡',
    description: '禁用再启用当前网络适配器，可修复驱动卡死、网卡状态异常。网络会中断数秒。',
    command: 'Restart-NetAdapter',
    admin: true,
    risk: 'caution',
    icon: 'adapter',
  },
  restartWlan: {
    id: 'restartWlan',
    name: '重启 WLAN 服务',
    description: '重启 Windows 无线自动配置服务，修复搜不到 Wi-Fi、无法连接无线网络。',
    command: 'Restart-Service WlanSvc',
    admin: true,
    risk: 'caution',
    icon: 'wifi',
  },
  startWlan: {
    id: 'startWlan',
    name: '启动 WLAN 服务',
    description: '当前无线服务未运行，启动后才能扫描和连接 Wi-Fi。',
    command: 'Start-Service WlanSvc',
    admin: true,
    risk: 'safe',
    icon: 'wifi',
  },
  resetProxy: {
    id: 'resetProxy',
    name: '关闭系统代理',
    description: '关闭 WinINET 代理并备份原设置，修复代理软件退出后无法上网。',
    command: 'Set-ItemProperty HKCU:\\...',
    admin: false,
    risk: 'caution',
    icon: 'shield',
  },
  setPublicDns: {
    id: 'setPublicDns',
    name: '切换公共 DNS',
    description: '将当前网卡 DNS 改为阿里云 223.5.5.5 与腾讯 119.29.29.29，并保留恢复入口。',
    command: 'Set-DnsClientServerAddress',
    admin: true,
    risk: 'caution',
    icon: 'dns',
  },
  resetDns: {
    id: 'resetDns',
    name: '恢复自动 DNS',
    description: '把当前网卡的 DNS 恢复为路由器 / DHCP 自动下发。',
    command: 'Set-DnsClientServerAddress -ResetServerAddresses',
    admin: true,
    risk: 'caution',
    icon: 'dns',
  },
  resetWinsock: {
    id: 'resetWinsock',
    name: '重置 Winsock',
    description: '修复 LSP 网络协议栈损坏，需重启电脑后完全生效。',
    command: 'netsh winsock reset',
    admin: true,
    risk: 'danger',
    icon: 'reset',
  },
  resetTcpip: {
    id: 'resetTcpip',
    name: '重置 TCP/IP',
    description: '重建 IPv4/IPv6 协议栈，适用于严重网络故障。需重启电脑。',
    command: 'netsh int ip reset',
    admin: true,
    risk: 'danger',
    icon: 'reset',
  },
  resetRouteMetric: {
    id: 'resetRouteMetric',
    name: '恢复自动跃点',
    description: '清除手动设置的网卡优先级，让 Windows 自动选择最快线路。',
    command: 'Set-NetIPInterface -AutomaticMetric Enabled',
    admin: true,
    risk: 'caution',
    icon: 'route',
  },
};

const WIFI_SECURITY_WEAK = ['open', '开放式', 'none', 'wep', '共享'];

const SCORE_LABELS = [
  { min: 90, label: '优秀', tone: 'excellent', summary: '网络状态很健康，可以放心使用。' },
  { min: 75, label: '良好', tone: 'good', summary: '网络整体正常，存在少量可优化项。' },
  { min: 60, label: '一般', tone: 'fair', summary: '可以上网，但部分链路存在风险或不稳定。' },
  { min: 40, label: '较差', tone: 'poor', summary: '网络问题明显，建议按修复建议逐项处理。' },
  { min: 0, label: '严重', tone: 'critical', summary: '网络链路存在严重故障，请优先处理红色问题。' },
];

module.exports = {
  APP_NAME,
  APP_NAME_CN,
  VERSION,
  PING_TARGETS,
  DNS_DOMAINS,
  TCP_SERVICES,
  HTTP_PROBES,
  DNS_RESOLVERS,
  REPAIR_ACTIONS,
  WIFI_SECURITY_WEAK,
  SCORE_LABELS,
};
