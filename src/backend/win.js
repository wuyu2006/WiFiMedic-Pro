'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

const DEFAULT_MAX_BUFFER = 24 * 1024 * 1024;

/**
 * Decode console output. Windows tools can emit UTF-8, GBK, or the legacy OEM
 * code page depending on the host. We try UTF-8 first and fall back to GBK so
 * Chinese adapter names and netsh output survive.
 */
function decodeBuffer(buffer) {
  if (!buffer || buffer.length === 0) return '';
  if (typeof buffer === 'string') return buffer;
  let text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) {
    try {
      text = new TextDecoder('gbk').decode(buffer);
    } catch {
      // Keep the UTF-8 result when the runtime has no GBK decoder.
    }
  }
  return text.replace(/^\uFEFF/, '');
}

function run(file, args, options = {}) {
  const {
    timeout = 15000,
    encoding = 'buffer',
    cwd,
    env,
    maxBuffer = DEFAULT_MAX_BUFFER,
  } = options;

  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd,
        env: { ...process.env, ...env },
        timeout,
        windowsHide: true,
        maxBuffer,
        encoding,
      },
      (error, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? decodeBuffer(stdout) : String(stdout || '');
        const err = Buffer.isBuffer(stderr) ? decodeBuffer(stderr) : String(stderr || '');
        resolve({
          ok: !error,
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          signal: error && error.signal ? error.signal : null,
          stdout: out,
          stderr: err,
          timedOut: Boolean(error && (error.killed || error.signal === 'SIGTERM')),
          error: error ? String(error.message || error) : null,
        });
      },
    );
  });
}

function powerShellArgs(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded,
  ];
}

const PS_PREAMBLE = [
  "$ProgressPreference='SilentlyContinue'",
  "$ErrorActionPreference='SilentlyContinue'",
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  '$OutputEncoding=[System.Text.Encoding]::UTF8',
  '$PSDefaultParameterValues["Out-File:Encoding"]="utf8"',
].join('; ');

async function ps(script, options = {}) {
  const full = `${PS_PREAMBLE}; ${script}`;
  const result = await run('powershell.exe', powerShellArgs(full), {
    timeout: options.timeout || 20000,
    maxBuffer: options.maxBuffer,
  });
  return result;
}

async function psJson(script, options = {}) {
  const result = await ps(script, options);
  const text = (result.stdout || '').trim();
  if (!text) {
    return { ok: false, data: null, error: result.stderr || result.error || 'PowerShell 未返回数据', raw: result };
  }
  try {
    // Strip an accidental CLIXML wrapper or BOM that some hosts prepend.
    const cleaned = text
      .replace(/^#< CLIXML\r?\n?/i, '')
      .replace(/^<Objs[\s\S]*?<\/Objs>\s*/i, '')
      .trim();
    return { ok: true, data: JSON.parse(cleaned), error: null, raw: result };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: `无法解析 PowerShell 输出: ${error.message}`,
      raw: result,
    };
  }
}

async function runCommand(command, args = [], options = {}) {
  return run(command, args, options);
}

async function runNetsh(args, options = {}) {
  const command = `chcp 65001>nul & netsh ${args.join(' ')}`;
  return run('cmd.exe', ['/d', '/s', '/c', command], {
    timeout: options.timeout || 18000,
    maxBuffer: options.maxBuffer,
  });
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function parseVersion(text) {
  return String(text || '').trim();
}

async function isAdmin() {
  const result = await ps(
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    { timeout: 10000 },
  );
  return /^true$/i.test((result.stdout || '').trim());
}

async function getServiceState(name) {
  const res = await psJson(
    `$s=Get-Service -Name '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue; if($s){[pscustomobject]@{name=$s.Name;status=[string]$s.Status;startType=[string]$s.StartType}|ConvertTo-Json -Compress}`,
    { timeout: 10000 },
  );
  return res.ok ? res.data : null;
}

async function startService(name) {
  return ps(
    `$ProgressPreference='SilentlyContinue'; try { Start-Service -Name '${name.replace(/'/g, "''")}' -ErrorAction Stop; (Get-Service -Name '${name.replace(/'/g, "''")}').Status } catch { Write-Error $_.Exception.Message; exit 1 }`,
    { timeout: 20000 },
  );
}

async function elevate(commandArgs) {
  const executable = process.execPath;
  const args = commandArgs || [];
  const quoted = args.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(',');
  const script = `Start-Process -FilePath '${executable.replace(/'/g, "''")}' -ArgumentList @(${quoted}) -Verb RunAs`;
  return ps(script, { timeout: 12000 });
}

module.exports = {
  run,
  ps,
  psJson,
  runCommand,
  runNetsh,
  decodeBuffer,
  normalizeText,
  parseVersion,
  isAdmin,
  getServiceState,
  startService,
  elevate,
  path,
};
