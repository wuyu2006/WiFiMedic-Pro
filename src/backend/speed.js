'use strict';

const https = require('node:https');
const { performance } = require('node:perf_hooks');
const { pingHost, round } = require('./ping');

const DOWNLOAD_ENDPOINTS = [
  {
    // Tencent's software CDN is usually much faster than overseas speed-test
    // endpoints from mainland China and serves a large static installer.
    name: '腾讯软件 CDN',
    url: 'https://dldir1.qq.com/weixin/Windows/WeChatSetup.exe',
    host: 'dldir1.qq.com',
  },
  {
    name: 'Cloudflare Speed',
    url: 'https://speed.cloudflare.com/__down?bytes=50000000',
    host: 'speed.cloudflare.com',
  },
  {
    name: 'CacheFly',
    url: 'https://cachefly.cachefly.net/100mb.test',
    host: 'cachefly.cachefly.net',
  },
];

function requestStream(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const request = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'WiFiMedic/1.0 (Windows speed test)',
          Accept: '*/*',
          Connection: 'close',
          ...(options.headers || {}),
        },
        localAddress: options.localAddress || undefined,
        timeout: options.timeout || 15000,
        rejectUnauthorized: true,
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          resolve(requestStream(new URL(response.headers.location, url).toString(), options));
          return;
        }
        resolve({ request, response });
      },
    );
    request.once('timeout', () => {
      request.destroy(new Error('测速连接超时'));
    });
    request.once('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function downloadTest(endpoint, options = {}, onProgress) {
  const started = performance.now();
  let firstByteAt = null;
  let bytes = 0;
  let lastEmit = 0;
  const limitMs = Math.max(3000, Math.min(Number(options.durationMs) || 9000, 20000));
  try {
    const { request, response } = await requestStream(endpoint.url, {
      localAddress: options.localAddress,
      timeout: 12000,
    });
    if (!response.statusCode || response.statusCode >= 400) {
      request.destroy();
      return {
        ok: false,
        endpoint: endpoint.name,
        url: endpoint.url,
        error: `测速节点返回 HTTP ${response.statusCode || '未知'}`,
      };
    }
    return await new Promise((resolve) => {
      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        request.destroy();
        const elapsed = Math.max(1, performance.now() - started);
        const measureElapsed = Math.max(1, performance.now() - (firstByteAt || started));
        const mbps = firstByteAt ? (bytes * 8) / (measureElapsed / 1000) / 1e6 : 0;
        resolve({
          ok: !error && bytes > 0,
          endpoint: endpoint.name,
          url: endpoint.url,
          bytes,
          durationMs: Math.round(elapsed),
          measureMs: Math.round(measureElapsed),
          mbps: round(mbps, 2),
          error: error ? String(error.message || error) : null,
        });
      };
      const timer = setTimeout(() => finish(null), limitMs);
      response.on('data', (chunk) => {
        if (firstByteAt == null) firstByteAt = performance.now();
        bytes += chunk.length;
        const now = performance.now();
        if (onProgress && now - lastEmit > 220) {
          lastEmit = now;
          const elapsed = Math.max(1, now - started);
          const measureElapsed = Math.max(1, now - (firstByteAt || started));
          onProgress({
            phase: 'download',
            bytes,
            mbps: round((bytes * 8) / (measureElapsed / 1000) / 1e6, 2),
            elapsedMs: Math.round(elapsed),
            endpoint: endpoint.name,
          });
        }
        if (bytes >= 80 * 1024 * 1024) finish(null);
      });
      response.on('end', () => finish(null));
      response.on('error', (error) => finish(error));
      request.on('error', (error) => finish(error));
    });
  } catch (error) {
    return {
      ok: false,
      endpoint: endpoint.name,
      url: endpoint.url,
      error: String(error.code || error.message || error),
    };
  }
}

async function uploadTest(options = {}, onProgress) {
  const size = Math.max(512 * 1024, Math.min(Number(options.uploadBytes) || 3 * 1024 * 1024, 10 * 1024 * 1024));
  const body = Buffer.alloc(size, 0x61);
  const started = performance.now();
  const url = 'https://speed.cloudflare.com/__up';
  let uploaded = 0;
  try {
    const { request, response } = await requestStream(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
      },
      body,
      localAddress: options.localAddress,
      timeout: 15000,
    });
    return await new Promise((resolve) => {
      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const elapsed = Math.max(1, performance.now() - started);
        const mbps = (uploaded * 8) / (elapsed / 1000) / 1e6;
        resolve({
          ok: !error && response.statusCode >= 200 && response.statusCode < 400,
          endpoint: 'Cloudflare Speed',
          bytes: uploaded,
          durationMs: Math.round(elapsed),
          mbps: round(mbps, 2),
          error: error ? String(error.message || error) : response.statusCode >= 400 ? `HTTP ${response.statusCode}` : null,
        });
      };
      const timer = setTimeout(() => finish(null), 12000);
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > 65536) response.destroy();
      });
      response.on('end', () => finish(null));
      response.on('error', (error) => finish(error));
      request.on('error', (error) => finish(error));
      const progress = setInterval(() => {
        if (onProgress) {
          onProgress({
            phase: 'upload',
            bytes: uploaded,
            mbps: round((uploaded * 8) / (Math.max(1, performance.now() - started) / 1000) / 1e6, 2),
            elapsedMs: Math.round(performance.now() - started),
          });
        }
      }, 260);
      request.on('close', () => clearInterval(progress));
      request.on('finish', () => {
        uploaded = size;
      });
    });
  } catch (error) {
    return {
      ok: false,
      endpoint: 'Cloudflare Speed',
      bytes: uploaded,
      error: String(error.code || error.message || error),
    };
  }
}

async function speedTest(options = {}, onProgress) {
  const sourceIp = options.localAddress || undefined;
  const basePing = await pingHost('223.5.5.5', { count: 5, timeout: 1200, sourceIp });
  const bufferbloatSamples = [];
  let stopSampling = false;
  const sampler = (async () => {
    while (!stopSampling) {
      try {
        const sample = await pingHost('223.5.5.5', { count: 1, timeout: 1000, sourceIp });
        if (sample.success && sample.avg != null) bufferbloatSamples.push(sample.avg);
      } catch {
        // A missed sample is fine.
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  })();

  let download = null;
  for (const endpoint of DOWNLOAD_ENDPOINTS) {
    if (onProgress) onProgress({ phase: 'download-connecting', endpoint: endpoint.name, mbps: 0, bytes: 0 });
    download = await downloadTest(endpoint, options, onProgress);
    if (download.ok) break;
  }
  let upload = null;
  if (options.includeUpload !== false) {
    if (onProgress) onProgress({ phase: 'upload-connecting', mbps: 0, bytes: 0 });
    upload = await uploadTest(options, onProgress);
  }
  stopSampling = true;
  await sampler;

  const loadedAvg = bufferbloatSamples.length
    ? bufferbloatSamples.reduce((a, b) => a + b, 0) / bufferbloatSamples.length
    : null;
  const bufferbloat = basePing.avg != null && loadedAvg != null ? Math.max(0, loadedAvg - basePing.avg) : null;
  const bufferbloatGrade =
    bufferbloat == null ? '未知' : bufferbloat < 15 ? '优秀' : bufferbloat < 40 ? '良好' : bufferbloat < 90 ? '偏高' : '严重';
  return {
    ok: Boolean((download && download.ok) || (upload && upload.ok)),
    download,
    upload,
    latency: {
      idle: basePing.avg,
      loaded: round(loadedAvg),
      increase: round(bufferbloat),
      samples: bufferbloatSamples,
      grade: bufferbloatGrade,
    },
    endpoints: DOWNLOAD_ENDPOINTS.map((e) => ({ name: e.name, host: e.host })),
    note: '单线程测速受测速节点、运营商和 Wi-Fi 环境共同影响，结果仅供诊断参考。',
  };
}

module.exports = {
  speedTest,
  downloadTest,
  uploadTest,
  DOWNLOAD_ENDPOINTS,
};
