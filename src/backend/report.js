'use strict';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function formatDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} 秒`;
}

function statusLabel(status) {
  return (
    {
      pass: '通过',
      warn: '注意',
      fail: '异常',
      info: '信息',
      skip: '跳过',
    }[status] || status || '-'
  );
}

function severityLabel(severity) {
  return { critical: '严重', warning: '警告', info: '提示' }[severity] || '提示';
}

function scoreColor(score) {
  if (score >= 90) return '#17d6a5';
  if (score >= 75) return '#63a4ff';
  if (score >= 60) return '#ffc15a';
  if (score >= 40) return '#ff9352';
  return '#ff5f7a';
}

function renderIssues(report) {
  const issues = Array.isArray(report.issues) ? report.issues : [];
  if (!issues.length) {
    return '<div class="empty good">未发现需要处理的问题。</div>';
  }
  return issues
    .map(
      (issue) => `
      <article class="issue ${escapeHtml(issue.severity)}">
        <div class="issue-head">
          <span class="badge ${escapeHtml(issue.severity)}">${escapeHtml(severityLabel(issue.severity))}</span>
          <h3>${escapeHtml(issue.title)}</h3>
        </div>
        <p>${escapeHtml(issue.detail)}</p>
        <div class="fix"><b>建议：</b>${escapeHtml(issue.fix)}</div>
      </article>`,
    )
    .join('');
}

function renderStages(report) {
  const stages = Array.isArray(report.stages) ? report.stages : [];
  return stages
    .map(
      (stage) => `
      <tr>
        <td><span class="dot ${escapeHtml(stage.status)}"></span>${escapeHtml(stage.label)}</td>
        <td><span class="pill ${escapeHtml(stage.status)}">${escapeHtml(statusLabel(stage.status))}</span></td>
        <td>${escapeHtml(stage.summary)}</td>
        <td class="num">${escapeHtml(formatDuration(stage.durationMs))}</td>
      </tr>`,
    )
    .join('');
}

function renderPingTable(report) {
  const stage = (report.stages || []).find((s) => s.id === 'icmp');
  const results = stage && stage.data && Array.isArray(stage.data.results) ? stage.data.results : [];
  if (!results.length) return '<div class="empty">没有 Ping 数据。</div>';
  return `
    <table class="data-table">
      <thead><tr><th>目标</th><th>地址</th><th>结果</th><th>平均延迟</th><th>丢包</th></tr></thead>
      <tbody>
        ${results
          .map(
            (r) => `<tr>
              <td>${escapeHtml(r.name)}<small>${escapeHtml(r.vendor)}</small></td>
              <td class="mono">${escapeHtml(r.host)}</td>
              <td><span class="pill ${r.success ? 'pass' : 'fail'}">${r.success ? '可达' : '不可达'}</span></td>
              <td class="num">${r.avg == null ? '-' : `${r.avg} ms`}</td>
              <td class="num">${r.lossPct == null ? '-' : `${r.lossPct}%`}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}

function renderDnsTable(report) {
  const stage = (report.stages || []).find((s) => s.id === 'dns');
  const data = stage && stage.data;
  if (!data || !Array.isArray(data.system)) return '<div class="empty">没有 DNS 数据。</div>';
  return `
    <table class="data-table">
      <thead><tr><th>域名</th><th>结果</th><th>解析地址</th><th>耗时</th></tr></thead>
      <tbody>
        ${data.system
          .map(
            (d) => `<tr>
              <td>${escapeHtml(d.domain)}</td>
              <td><span class="pill ${d.ok ? 'pass' : 'fail'}">${d.ok ? '成功' : '失败'}</span></td>
              <td class="mono">${escapeHtml((d.addresses || []).slice(0, 3).join(', ') || d.error || '-')}</td>
              <td class="num">${d.latency == null ? '-' : `${d.latency} ms`}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}

function renderWifiTable(report) {
  const stage = (report.stages || []).find((s) => s.id === 'wifi');
  const networks = stage && stage.data && Array.isArray(stage.data.networks) ? stage.data.networks : [];
  if (!networks.length) return '<div class="empty">未扫描到周边 Wi-Fi 网络。</div>';
  return `
    <table class="data-table">
      <thead><tr><th>SSID</th><th>信号</th><th>频段 / 信道</th><th>加密</th><th>BSSID</th></tr></thead>
      <tbody>
        ${networks
          .slice(0, 40)
          .map(
            (n) => `<tr>
              <td>${escapeHtml(n.ssid)}</td>
              <td class="num">${n.signal == null ? '-' : `${n.signal}%`}</td>
              <td>${escapeHtml(n.band || '-')} / ${escapeHtml(n.channel || '-')}</td>
              <td>${escapeHtml(n.security || '-')}</td>
              <td class="mono">${escapeHtml(n.bssid || '-')}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}

function generateTextSummary(report) {
  const lines = [];
  lines.push(`WiFiMedic Pro 网络体检报告`);
  lines.push(`时间：${formatDate(report.finishedAt || report.startedAt)}`);
  lines.push(`评分：${report.score ?? '-'} / 100（${report.verdict ? report.verdict.label : '-'}）`);
  lines.push(`通道：${report.activeAdapter ? `${report.activeAdapter.name}（${report.activeAdapter.kindLabel}）` : '未知'}`);
  lines.push(
    `延迟：${report.stats && report.stats.latency != null ? `${report.stats.latency} ms` : '-'}  丢包：${
      report.stats && report.stats.loss != null ? `${report.stats.loss}%` : '-'
    }`,
  );
  lines.push('');
  const issues = report.issues || [];
  if (issues.length) {
    lines.push('发现的问题：');
    issues.forEach((issue, index) => {
      lines.push(`${index + 1}. [${severityLabel(issue.severity)}] ${issue.title} — ${issue.fix}`);
    });
  } else {
    lines.push('未发现明显问题。');
  }
  lines.push('');
  lines.push('检查阶段：');
  (report.stages || []).forEach((stage) => {
    lines.push(`- ${stage.label}: ${statusLabel(stage.status)} · ${stage.summary}`);
  });
  return lines.join('\r\n');
}

function generateHtmlReport(report) {
  const score = report.score == null ? 0 : report.score;
  const color = scoreColor(score);
  const verdict = report.verdict || {};
  const active = report.activeAdapter || {};
  const stats = report.stats || {};
  const issues = report.issues || [];
  const stages = report.stages || [];
  const system = (report.snapshot && report.snapshot.system) || {};
  const wifi = report.snapshot && report.snapshot.wifi ? report.snapshot.wifi.current : null;
  const scoreDash = Math.max(0, Math.min(100, score)) * 2.513274;
  const created = formatDate(report.finishedAt || report.startedAt);
  const reportJson = JSON.stringify(report).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WiFiMedic Pro 网络体检报告 · ${escapeHtml(created)}</title>
<style>
  :root{--bg:#070b13;--panel:#101827;--panel2:#0c1320;--line:rgba(255,255,255,.09);--text:#e8f0ff;--muted:#8ea0bd;--good:#17d6a5;--warn:#ffc15a;--bad:#ff5f7a;--blue:#63a4ff;--violet:#b28cff}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(circle at 10% 0%,rgba(53,224,194,.12),transparent 34%),radial-gradient(circle at 100% 5%,rgba(91,140,255,.16),transparent 30%),var(--bg);color:var(--text);font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;line-height:1.6}
  .wrap{max-width:1120px;margin:0 auto;padding:48px 28px 64px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:1px solid var(--line);padding-bottom:28px}
  .brand{display:flex;align-items:center;gap:14px;font-weight:700;letter-spacing:.4px}
  .brand-mark{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#35e0c2,#5b8cff 65%,#b56bff);display:grid;place-items:center;color:#06101a;font-size:21px;font-weight:900;box-shadow:0 12px 30px rgba(53,224,194,.25)}
  h1{font-size:29px;line-height:1.25;margin:6px 0 8px;letter-spacing:-.4px}
  .sub{color:var(--muted);font-size:13px}
  .hero{display:grid;grid-template-columns:190px 1fr;gap:28px;align-items:center;margin:34px 0 26px;background:linear-gradient(135deg,rgba(18,28,45,.9),rgba(11,18,30,.75));border:1px solid var(--line);border-radius:22px;padding:28px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
  .ring{width:170px;height:170px;position:relative}
  .ring svg{transform:rotate(-90deg)}
  .ring .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .ring strong{font-size:48px;line-height:1;font-weight:800;letter-spacing:-2px}
  .ring span{font-size:11px;color:var(--muted);margin-top:6px;letter-spacing:2px}
  .hero h2{font-size:26px;margin:0 0 8px}
  .hero p{margin:0;color:var(--muted);max-width:650px}
  .meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
  .meta span{background:rgba(255,255,255,.05);border:1px solid var(--line);padding:7px 11px;border-radius:999px;font-size:12px;color:#c8d6ed}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:28px}
  .kpi{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px}
  .kpi label{display:block;font-size:11px;color:var(--muted);letter-spacing:.6px;margin-bottom:8px}
  .kpi strong{font-size:22px;font-weight:700}
  .kpi small{font-size:11px;color:var(--muted)}
  section{margin:30px 0}
  h2.sec{font-size:18px;margin:0 0 14px;display:flex;align-items:center;gap:10px}
  h2.sec:before{content:"";width:4px;height:18px;border-radius:2px;background:linear-gradient(#35e0c2,#5b8cff)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px}
  .issue{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:14px;padding:16px 18px;margin:10px 0}
  .issue.critical{border-left-color:var(--bad)}
  .issue.info{border-left-color:var(--blue)}
  .issue-head{display:flex;align-items:center;gap:10px}
  .issue h3{font-size:14px;margin:0}
  .issue p{margin:8px 0;color:#c1cfe3;font-size:13px}
  .fix{font-size:12px;color:var(--muted);background:rgba(255,255,255,.035);border-radius:8px;padding:9px 11px}
  .badge,.pill{display:inline-flex;align-items:center;border-radius:999px;font-size:10px;font-weight:700;padding:3px 8px;letter-spacing:.4px}
  .badge.critical,.pill.fail{background:rgba(255,95,122,.14);color:#ff8ba0}
  .badge.warning,.pill.warn{background:rgba(255,193,90,.13);color:#ffd085}
  .badge.info,.pill.info{background:rgba(99,164,255,.13);color:#9cc4ff}
  .pill.pass{background:rgba(23,214,165,.12);color:#69eccf}
  .pill.skip{background:rgba(255,255,255,.07);color:#b5c3d8}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:9px;background:var(--muted)}
  .dot.pass{background:var(--good);box-shadow:0 0 10px rgba(23,214,165,.5)}
  .dot.warn{background:var(--warn)}
  .dot.fail{background:var(--bad)}
  .dot.info{background:var(--blue)}
  .data-table{width:100%;border-collapse:collapse;font-size:12px}
  .data-table th{text-align:left;color:var(--muted);font-weight:500;padding:10px;border-bottom:1px solid var(--line);font-size:11px}
  .data-table td{padding:10px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
  .data-table small{display:block;color:var(--muted);font-size:10px;margin-top:2px}
  .data-table tr:last-child td{border-bottom:none}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .mono{font-family:"Cascadia Code",Consolas,monospace;font-size:11px;color:#a9bdd9;word-break:break-all}
  .empty{color:var(--muted);font-size:13px;padding:18px;text-align:center}
  .empty.good{color:var(--good)}
  .sys{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 18px;font-size:12px;color:#bdcce2}
  .sys b{display:block;color:var(--muted);font-weight:500;font-size:10px;margin-bottom:2px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  details{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-top:10px}
  summary{cursor:pointer;color:#b9c8de;font-size:12px}
  pre{white-space:pre-wrap;word-break:break-word;font-family:Consolas,monospace;font-size:11px;color:#9fb4d0;max-height:420px;overflow:auto;margin:12px 0 0}
  footer{color:var(--muted);font-size:11px;text-align:center;border-top:1px solid var(--line);padding-top:22px;margin-top:44px}
  @media(max-width:800px){.hero{grid-template-columns:1fr}.ring{margin:0 auto}.kpis{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.sys{grid-template-columns:1fr 1fr}}
  @media print{body{background:#fff;color:#162033}.wrap{padding:16px}.panel,.issue,.hero,.kpi{break-inside:avoid;box-shadow:none} .hero{background:#f4f7fb} .data-table td{color:#26364c} .sub,.meta span,.fix,.kpi label{color:#5e708c} h2.sec:before{background:#16a085}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <div class="brand"><div class="brand-mark">W</div><div>WiFiMedic Pro <span style="color:var(--muted);font-weight:400">/ 网络体检报告</span></div></div>
      <h1>${escapeHtml(verdict.label || '网络体检')} · ${escapeHtml(active.name || '当前网络')}</h1>
      <div class="sub">生成时间 ${escapeHtml(created)} · 耗时 ${escapeHtml(formatDuration(report.durationMs))} · 版本 ${escapeHtml(report.version || '1.0.0')}</div>
    </div>
    <div style="text-align:right"><div style="font-size:12px;color:var(--muted)">综合评分</div><div style="font-size:36px;font-weight:800;color:${color}">${escapeHtml(score)}<span style="font-size:14px;color:var(--muted)">/100</span></div></div>
  </div>

  <div class="hero">
    <div class="ring">
      <svg width="170" height="170" viewBox="0 0 170 170">
        <circle cx="85" cy="85" r="70" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="10"/>
        <circle cx="85" cy="85" r="70" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${scoreDash} 439.8" style="filter:drop-shadow(0 0 8px ${color}88)"/>
      </svg>
      <div class="center"><strong style="color:${color}">${escapeHtml(score)}</strong><span>HEALTH SCORE</span></div>
    </div>
    <div>
      <h2>${escapeHtml(verdict.summary || '')}</h2>
      <p>${escapeHtml(verdict.label || '')} · ${escapeHtml(issues.length)} 个发现项，其中 ${escapeHtml(issues.filter((i) => i.severity === 'critical').length)} 个严重问题。检查范围覆盖系统环境、上网通道、IP/DHCP、网关、DNS、厂商 Ping、TCP、HTTP、稳定性、MTU、Wi-Fi 射频、事件日志与路由追踪。</p>
      <div class="meta">
        <span>通道：${escapeHtml(active.kindLabel || '未知')} / ${escapeHtml(active.name || '未知')}</span>
        <span>IP：${escapeHtml(active.primaryIp ? active.primaryIp.address : '-')}</span>
        <span>网关：${escapeHtml(active.gateway && active.gateway[0] ? active.gateway[0] : '-')}</span>
        <span>Wi-Fi：${escapeHtml(wifi ? `${wifi.ssid} · ${wifi.signal ?? '?'}%` : '未连接 / 无无线网卡')}</span>
      </div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><label>平均延迟</label><strong>${stats.latency == null ? '-' : `${escapeHtml(stats.latency)} ms`}</strong><small>外网 ICMP</small></div>
    <div class="kpi"><label>丢包率</label><strong>${stats.loss == null ? '-' : `${escapeHtml(stats.loss)}%`}</strong><small>稳定性采样</small></div>
    <div class="kpi"><label>抖动</label><strong>${stats.jitter == null ? '-' : `${escapeHtml(stats.jitter)} ms`}</strong><small>相邻延迟差</small></div>
    <div class="kpi"><label>必测节点</label><strong>${escapeHtml(stats.requiredPing || '-')}</strong><small>厂商 Ping 连通</small></div>
    <div class="kpi"><label>Wi-Fi 信号</label><strong>${stats.signal == null ? '-' : `${escapeHtml(stats.signal)}%`}</strong><small>${wifi ? escapeHtml(`${wifi.band || ''} ${wifi.channel ? `信道 ${wifi.channel}` : ''}`) : '有线通道'}</small></div>
  </div>

  <section>
    <h2 class="sec">发现与修复建议</h2>
    ${renderIssues(report)}
  </section>

  <section>
    <h2 class="sec">检查阶段</h2>
    <div class="panel" style="padding:8px 16px">
      <table class="data-table">
        <thead><tr><th>检查项</th><th>状态</th><th>摘要</th><th class="num">耗时</th></tr></thead>
        <tbody>${renderStages(report)}</tbody>
      </table>
    </div>
  </section>

  <section>
    <div class="two">
      <div>
        <h2 class="sec">厂商节点 Ping</h2>
        <div class="panel">${renderPingTable(report)}</div>
      </div>
      <div>
        <h2 class="sec">DNS 解析</h2>
        <div class="panel">${renderDnsTable(report)}</div>
      </div>
    </div>
  </section>

  <section>
    <h2 class="sec">周边 Wi-Fi 扫描</h2>
    <div class="panel">${renderWifiTable(report)}</div>
  </section>

  <section>
    <h2 class="sec">系统与环境</h2>
    <div class="panel sys">
      <div><b>主机名</b>${escapeHtml(system.hostname || '-')}</div>
      <div><b>操作系统</b>${escapeHtml(`${system.caption || ''} ${system.build || ''}`)}</div>
      <div><b>CPU</b>${escapeHtml(system.cpu || '-')}</div>
      <div><b>内存</b>${escapeHtml(system.memoryBytes ? `${(system.memoryBytes / 1024 / 1024 / 1024).toFixed(1)} GB` : '-')}</div>
      <div><b>网卡驱动</b>${escapeHtml(active.driverVersion || '-')}</div>
      <div><b>代理</b>${escapeHtml(report.snapshot && report.snapshot.proxy && report.snapshot.proxy.enabled ? `开启 ${report.snapshot.proxy.server || ''}` : '关闭')}</div>
    </div>
  </section>

  <section>
    <h2 class="sec">原始数据</h2>
    <details><summary>展开完整 JSON（可用于二次分析或提交技术支持）</summary><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></details>
  </section>

  <footer>WiFiMedic Pro · 本报告由本机诊断生成，不包含密码等敏感信息 · ${escapeHtml(created)}</footer>
</div>
<script type="application/json" id="wifimedic-report">${reportJson}</script>
</body>
</html>`;
}

module.exports = {
  generateHtmlReport,
  generateTextSummary,
  escapeHtml,
  formatDate,
  formatDuration,
};
