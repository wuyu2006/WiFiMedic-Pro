'use strict';

const net = require('node:net');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const { performance } = require('node:perf_hooks');
const { run, decodeBuffer } = require('./win');
const { PING_TARGETS, DNS_DOMAINS, TCP_SERVICES, HTTP_PROBES } = require('./constants');

const HOST_RE = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function assertHost(host) {
  const value = String(host || '').trim();
  if (!value) throw new Error('目标地址不能为空');
  if (IPV4_RE.test(value)) {
    const parts = value.split('.').map(Number);
    if (parts.every((p) => p >= 0 && p <= 255)) return value;
    throw new Error(`无效的 IPv4 地址: ${value}`);
  }
  if (value.includes(':')) {
    // IPv6 literal; ping.exe supports it without -4.
    if (/^[0-9a-fA-F:]+$/.test(value)) return value;
  }
  if (!HOST_RE.test(value)) throw new Error(`无效的目标地址: ${value}`);
  return value;
}

function assertSourceIp(ip) {
  if (!ip) return null;
  const value = String(ip).trim();
  if (!IPV4_RE.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? value : null;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parsePingOutput(text, count, durationMs) {
  const source = String(text || '');
  const lines = source.split(/\r?\n/);
  const replyLines = lines.filter(
    (line) =>
      /ttl\s*[=:]/i.test(line) &&
      /(bytes|字节|time|时间|ttl)/i.test(line) &&
      !/expired|过期/i.test(line),
  );
  const latencies = [];
  const replyIps = [];
  for (const line of replyLines) {
    const latency = line.match(/[=<]\s*(\d+(?:\.\d+)?)\s*ms/i);
    if (latency) latencies.push(Number(latency[1]));
    const ip = line.match(/(?:from|来自)\s+([0-9]{1,3}(?:\.[0-9]{1,3}){3})/i);
    if (ip) replyIps.push(ip[1]);
  }
  const replies = replyLines.length;
  const min = latencies.length ? Math.min(...latencies) : null;
  const max = latencies.length ? Math.max(...latencies) : null;
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  let jitter = null;
  if (latencies.length > 1) {
    let sum = 0;
    for (let i = 1; i < latencies.length; i += 1) sum += Math.abs(latencies[i] - latencies[i - 1]);
    jitter = sum / (latencies.length - 1);
  }
  const dnsFail = /could not find host|找不到主机|unknown host|name or service not known|请求找不到主机/i.test(source);
  const bindFail = /bind|invalid source|源地址|The requested address is not valid/i.test(source);
  const unreachable = /destination host unreachable|无法访问目标主机|请求超时|request timed out|传输失败|general failure/i.test(source);
  const timedOut = /timed out|超时|100% loss|100% 丢失/i.test(source);

  let status = 'fail';
  if (replies > 0 && replies >= count) status = 'ok';
  else if (replies > 0) status = 'partial';
  else if (dnsFail) status = 'dns';
  else if (bindFail) status = 'bind';
  else if (timedOut) status = 'timeout';
  else if (unreachable) status = 'unreachable';

  const errorText = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^pinging|^正在 ping/i.test(l))
    .slice(-3)
    .join(' ')
    .slice(0, 280);

  return {
    replies,
    count,
    lossPct: Math.round(((count - replies) / Math.max(count, 1)) * 100),
    success: replies > 0,
    fullSuccess: replies >= count,
    latencies,
    min: round(min),
    max: round(max),
    avg: round(avg),
    jitter: round(jitter),
    resolvedIp: replyIps[0] || null,
    status,
    durationMs: Math.round(durationMs),
    errorText,
  };
}

async function pingHost(hostInput, options = {}) {
  const host = assertHost(hostInput);
  const count = Math.max(1, Math.min(Number(options.count) || 4, 20));
  const timeout = Math.max(200, Math.min(Number(options.timeout) || 1200, 5000));
  const sourceIp = assertSourceIp(options.sourceIp);
  const size = Number.isFinite(Number(options.size)) ? Math.max(1, Math.min(Number(options.size), 65000)) : null;
  const df = Boolean(options.df);
  const family = host.includes(':') ? '6' : '4';
  const args = [`-${family}`, '-n', String(count), '-w', String(timeout)];
  if (sourceIp) args.push('-S', sourceIp);
  if (size) args.push('-l', String(size));
  if (df) args.push('-f');
  args.push(host);

  const started = performance.now();
  const result = await run('ping.exe', args, {
    timeout: count * timeout + 3500,
    maxBuffer: 2 * 1024 * 1024,
  });
  const duration = performance.now() - started;
  const text = decodeBuffer(result.stdout || result.stderr || '');
  const parsed = parsePingOutput(text, count, duration);
  return {
    host,
    ...parsed,
    exitCode: result.code,
    timedOut: result.timedOut,
    error: result.error || null,
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = {
          host: items[index] && (items[index].host || items[index]),
          success: false,
          status: 'error',
          errorText: String(error.message || error),
          replies: 0,
          lossPct: 100,
        };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function pingBatch(targets, options = {}, onResult) {
  const list = (targets || []).map((target) => (typeof target === 'string' ? { id: target, name: target, host: target } : target));
  const results = await mapLimit(list, options.concurrency || 5, async (target) => {
    const result = await pingHost(target.host, options);
    const merged = {
      ...result,
      target,
      id: target.id || target.host,
      name: target.name || target.host,
      vendor: target.vendor || '',
      group: target.group || 'custom',
      required: target.required !== false,
      note: target.note || '',
    };
    if (onResult) onResult(merged);
    return merged;
  });
  return results;
}

function summarizePingResults(results) {
  const total = results.length;
  const reachable = results.filter((r) => r.success).length;
  const required = results.filter((r) => r.required !== false);
  const requiredReachable = required.filter((r) => r.success).length;
  const allReachable = total > 0 && reachable === total;
  const requiredPass = required.length > 0 && requiredReachable === required.length;
  const avg = results.filter((r) => r.avg != null).map((r) => r.avg);
  const losses = results.map((r) => r.lossPct || 0);
  return {
    total,
    reachable,
    failed: total - reachable,
    requiredTotal: required.length,
    requiredReachable,
    allReachable,
    requiredPass,
    pass: requiredPass && required.length > 0,
    avgLatency: avg.length ? round(avg.reduce((a, b) => a + b, 0) / avg.length) : null,
    maxLoss: losses.length ? Math.max(...losses) : 0,
    averageLoss: losses.length ? round(losses.reduce((a, b) => a + b, 0) / losses.length) : 0,
  };
}

async function oneClickConnectivity(snapshot, options = {}) {
  const defaultTargets = PING_TARGETS.filter((target) => target.required !== false);
  const selected = Array.isArray(options.targets) && options.targets.length ? options.targets : defaultTargets;
  const activeAdapter = snapshot && snapshot.active && snapshot.active.adapter;
  const gateway = activeAdapter && activeAdapter.gateway && activeAdapter.gateway[0];
  const targets = [];
  if (gateway) {
    targets.push({
      id: 'gateway',
      name: '默认网关',
      vendor: '路由器',
      host: gateway,
      group: 'gateway',
      required: true,
      note: activeAdapter ? activeAdapter.name : '本地路由器',
    });
  }
  for (const target of selected) {
    targets.push({
      ...target,
      required: target.required !== false,
    });
  }
  const startedAt = new Date().toISOString();
  const results = await pingBatch(
    targets,
    {
      count: Number(options.count) || 4,
      timeout: Number(options.timeout) || 1200,
      concurrency: Number(options.concurrency) || 5,
      sourceIp: options.sourceIp || (activeAdapter ? (activeAdapter.primaryIp && activeAdapter.primaryIp.address) : null),
    },
    options.onResult,
  );
  return {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    gateway: gateway || null,
    adapter: activeAdapter
      ? { name: activeAdapter.name, type: activeAdapter.type, interfaceIndex: activeAdapter.interfaceIndex }
      : null,
    results,
    summary: summarizePingResults(results),
  };
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message || '操作超时')), ms);
    }),
  ]);
}

async function resolveWithSystem(domain) {
  const started = performance.now();
  let lastError = null;
  // A single transient getaddrinfo failure is common right after a route or DNS
  // change, so retry once before declaring a domain unreachable.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // Use the Windows system resolver (getaddrinfo) rather than c-ares.
      // Some routers / security suites reject direct UDP:53 queries from c-ares
      // while normal applications resolve names through the Windows DNS Client.
      const lookup = await withTimeout(
        dns.promises.lookup(domain, { family: 4, hints: dns.ADDRCONFIG }),
        5000,
        'DNS 查询超时',
      );
      return {
        ok: true,
        addresses: lookup && lookup.address ? [lookup.address] : [],
        latency: round(performance.now() - started),
        error: null,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 220));
    }
  }
  return {
    ok: false,
    addresses: [],
    latency: round(performance.now() - started),
    error: String(lastError && (lastError.code || lastError.message) || lastError || 'DNS 查询失败'),
    attempts: 2,
  };
}

async function resolveWithServer(domain, server) {
  const resolver = new dns.promises.Resolver({ timeout: 3500, tries: 1 });
  resolver.setServers([server]);
  const started = performance.now();
  try {
    const addresses = await withTimeout(resolver.resolve4(domain), 5000, 'DNS 查询超时');
    return {
      ok: true,
      addresses,
      latency: round(performance.now() - started),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      addresses: [],
      latency: round(performance.now() - started),
      error: String(error.code || error.message || error),
    };
  }
}

async function dnsTest(options = {}) {
  const domains = options.domains || DNS_DOMAINS;
  const system = await mapLimit(domains, 3, async (item) => {
    const result = await resolveWithSystem(item.domain);
    return { ...item, ...result };
  });
  const resolverTests = [];
  if (options.includePublic !== false) {
    for (const resolver of [
      { name: '阿里云 DNS', address: '223.5.5.5' },
      { name: 'Cloudflare', address: '1.1.1.1' },
    ]) {
      const result = await resolveWithServer('www.baidu.com', resolver.address);
      resolverTests.push({ ...resolver, domain: 'www.baidu.com', ...result });
    }
  }
  const success = system.filter((d) => d.ok).length;
  return {
    ok: true,
    system,
    publicResolvers: resolverTests,
    summary: {
      total: system.length,
      success,
      failed: system.length - success,
      avgLatency: system.filter((d) => d.ok && d.latency != null).length
        ? round(
            system.filter((d) => d.ok && d.latency != null).reduce((sum, d) => sum + d.latency, 0) /
              system.filter((d) => d.ok && d.latency != null).length,
          )
        : null,
    },
  };
}

function tcpProbe(host, port, options = {}) {
  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const socket = new net.Socket();
    const finish = (data) => {
      if (settled) return;
      settled = true;
      const latency = round(performance.now() - started);
      socket.destroy();
      resolve({ host, port, latency, ...data });
    };
    socket.setTimeout(Math.max(500, Number(options.timeout) || 4000));
    socket.once('connect', () => {
      finish({ ok: true, remoteAddress: socket.remoteAddress, error: null });
    });
    socket.once('timeout', () => finish({ ok: false, remoteAddress: null, error: '连接超时' }));
    socket.once('error', (error) =>
      finish({ ok: false, remoteAddress: null, error: String(error.code || error.message || error) }),
    );
    try {
      socket.connect({
        host,
        port,
        localAddress: options.localAddress || undefined,
        family: 4,
      });
    } catch (error) {
      finish({ ok: false, remoteAddress: null, error: String(error.message || error) });
    }
  });
}

async function tcpTest(options = {}) {
  const services = options.services || TCP_SERVICES;
  const results = await mapLimit(services, 4, async (service) => {
    let resolvedIp = null;
    try {
      const lookup = await withTimeout(dns.promises.lookup(service.host, { family: 4 }), 3500, '解析超时');
      resolvedIp = lookup.address;
    } catch {
      resolvedIp = null;
    }
    const probe = resolvedIp
      ? await tcpProbe(resolvedIp, service.port, { timeout: options.timeout, localAddress: options.localAddress })
      : { ok: false, latency: null, error: 'DNS 解析失败', remoteAddress: null };
    return {
      ...service,
      resolvedIp,
      ...probe,
    };
  });
  const required = results.filter((r) => r.required);
  const summary = {
    total: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    requiredPass: required.length > 0 && required.every((r) => r.ok),
    avgLatency: results.filter((r) => r.ok && r.latency != null).length
      ? round(
          results.filter((r) => r.ok && r.latency != null).reduce((sum, r) => sum + r.latency, 0) /
            results.filter((r) => r.ok && r.latency != null).length,
        )
      : null,
  };
  return { ok: true, results, summary };
}

function httpProbe(url, options = {}, redirects = 0) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, url, error: '无效 URL', statusCode: null, latency: null });
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    const started = performance.now();
    let ttfb = null;
    let settled = false;
    const finish = (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(globalTimer);
      resolve({
        url,
        latency: round(performance.now() - started),
        ttfb: ttfb == null ? null : round(ttfb),
        ...data,
      });
    };
    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        method: 'GET',
        headers: {
          'User-Agent': 'WiFiMedic/1.0 (Windows network diagnostic)',
          Accept: '*/*',
          Connection: 'close',
        },
        localAddress: options.localAddress || undefined,
        rejectUnauthorized: true,
        timeout: Math.max(1000, Number(options.timeout) || 7000),
      },
      (response) => {
        ttfb = performance.now() - started;
        const statusCode = response.statusCode || 0;
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location &&
          redirects < 2
        ) {
          response.resume();
          try {
            const next = new URL(response.headers.location, url).toString();
            clearTimeout(globalTimer);
            httpProbe(next, options, redirects + 1).then(finish);
          } catch (error) {
            finish({ ok: false, error: String(error.message || error), statusCode, headers: response.headers, body: '' });
          }
          return;
        }
        let body = '';
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (body.length < 4096) body += chunk.toString('utf8').slice(0, 4096 - body.length);
        });
        response.on('end', () => {
          const expectedStatus = options.expectStatus;
          const expectedBody = options.expectBody;
          const statusOk = expectedStatus ? statusCode === expectedStatus : statusCode >= 200 && statusCode < 500;
          const bodyOk = expectedBody ? body.includes(expectedBody) : true;
          finish({
            ok: statusOk && bodyOk,
            statusCode,
            statusOk,
            bodyOk,
            headers: response.headers,
            body: body.slice(0, 1200),
            bytes,
            remoteAddress: response.socket ? response.socket.remoteAddress : null,
            error: statusOk && bodyOk ? null : expectedStatus && statusCode !== expectedStatus ? `返回 ${statusCode}，预期 ${expectedStatus}` : '响应内容不符合预期',
          });
        });
        response.on('error', (error) => finish({ ok: false, statusCode, error: String(error.message || error), headers: response.headers, body: '' }));
      },
    );
    const globalTimer = setTimeout(() => {
      request.destroy();
      finish({ ok: false, error: 'HTTP 请求超时', statusCode: null });
    }, Math.max(1500, Number(options.timeout) || 8000));
    request.on('timeout', () => {
      request.destroy();
      finish({ ok: false, error: 'HTTP 请求超时', statusCode: null });
    });
    request.on('error', (error) => {
      clearTimeout(globalTimer);
      finish({
        ok: false,
        error: String(error.code || error.message || error),
        statusCode: null,
      });
    });
    request.end();
  });
}

async function httpTest(options = {}) {
  const probes = options.probes || HTTP_PROBES;
  const results = await mapLimit(probes, 3, async (probe) => {
    const result = await httpProbe(probe.url, {
      expectStatus: probe.expectStatus,
      expectBody: probe.expectBody,
      localAddress: options.localAddress,
      timeout: options.timeout,
    });
    return { ...probe, ...result };
  });
  const reachable = results.filter((r) => r.ok).length;
  return {
    ok: true,
    results,
    summary: {
      total: results.length,
      reachable,
      failed: results.length - reachable,
      pass: reachable >= Math.min(2, results.length),
    },
  };
}

async function measureStability(options = {}) {
  const host = options.host || '223.5.5.5';
  const gateway = options.gateway;
  const count = Math.max(3, Math.min(Number(options.count) || 10, 20));
  const sourceIp = options.sourceIp;
  const targets = [];
  if (gateway) targets.push({ id: 'gateway', name: '网关', host: gateway });
  targets.push({ id: 'internet', name: '互联网', host });
  const results = await Promise.all(
    targets.map(async (target) => {
      const result = await pingHost(target.host, { count, timeout: 1200, sourceIp });
      return { ...target, ...result };
    }),
  );
  return {
    ok: true,
    count,
    results,
    internet: results.find((r) => r.id === 'internet') || null,
    gateway: results.find((r) => r.id === 'gateway') || null,
  };
}

async function mtuTest(options = {}) {
  const host = assertHost(options.host || '223.5.5.5');
  const sourceIp = options.sourceIp;
  const sizes = [1472, 1464, 1452, 1400, 1300, 1200, 1100];
  const tested = [];
  let discovered = null;
  for (const size of sizes) {
    const result = await pingHost(host, {
      count: 2,
      timeout: 1000,
      sourceIp,
      size,
      df: true,
    });
    tested.push({ size, mtu: size + 28, success: result.success, replies: result.replies, status: result.status });
    if (result.success) {
      discovered = size + 28;
      break;
    }
  }
  const unknown = !discovered && tested.every((t) => !t.success);
  return {
    ok: true,
    host,
    mtu: discovered,
    unknown,
    tested,
    note: unknown
      ? '目标可能屏蔽了 ICMP 或禁止分片探测，无法确认 MTU。'
      : discovered
        ? `最大不分片载荷 ${discovered - 28} 字节，估算 MTU 为 ${discovered}。`
        : '所有测试包均失败，建议检查链路。',
  };
}

async function traceRoute(options = {}) {
  const host = assertHost(options.host || '223.5.5.5');
  const maxHops = Math.max(3, Math.min(Number(options.maxHops) || 12, 30));
  const timeoutMs = Math.max(200, Math.min(Number(options.timeout) || 500, 3000));
  const started = performance.now();
  const result = await run(
    'tracert.exe',
    ['-4', '-d', '-h', String(maxHops), '-w', String(timeoutMs), host],
    { timeout: 50000, maxBuffer: 4 * 1024 * 1024 },
  );
  const text = decodeBuffer(result.stdout || result.stderr || '');
  const hops = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) continue;
    const hop = Number(match[1]);
    const rest = match[2];
    const ip = rest.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
    const times = [...rest.matchAll(/(?:<\s*)?(\d+(?:\.\d+)?)\s*(?:ms|毫秒)/gi)].map((m) => Number(m[1]));
    const timedOut = /\*\s+\*\s+\*/i.test(rest) || !ip;
    hops.push({
      hop,
      ip: ip ? ip[1] : null,
      avg: times.length ? round(times.reduce((a, b) => a + b, 0) / times.length) : null,
      times,
      timedOut,
    });
  }
  return {
    ok: result.ok && hops.length > 0,
    host,
    hops,
    durationMs: Math.round(performance.now() - started),
    error: result.ok ? null : result.error || '路由追踪失败',
    raw: text.slice(0, 4000),
  };
}

module.exports = {
  pingHost,
  pingBatch,
  summarizePingResults,
  oneClickConnectivity,
  dnsTest,
  tcpProbe,
  tcpTest,
  httpProbe,
  httpTest,
  measureStability,
  mtuTest,
  traceRoute,
  mapLimit,
  assertHost,
  parsePingOutput,
  round,
};
