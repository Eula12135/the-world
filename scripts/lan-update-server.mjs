import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return String(pkg.version || '0.2.1');
  } catch {
    return '0.2.1';
  }
}

function findExistingFile(candidates) {
  for (const rel of candidates) {
    const abs = path.join(ROOT_DIR, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return abs;
    }
  }
  return null;
}

function findApkPath() {
  return findExistingFile([
    'android/app/build/outputs/apk/release/app-release.apk',
    'android/app/build/outputs/apk/debug/app-debug.apk',
  ]);
}

function findExePath(version) {
  const preferred = findExistingFile([
    `release/The World Setup ${version}.exe`,
    `release/The World ${version}.exe`,
  ]);
  if (preferred) return preferred;

  const releaseDir = path.join(ROOT_DIR, 'release');
  if (!fs.existsSync(releaseDir)) return null;
  const exes = fs
    .readdirSync(releaseDir)
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .sort((a, b) => (a.includes('Setup') ? -1 : b.includes('Setup') ? 1 : a.localeCompare(b)));
  return exes.length > 0 ? path.join(releaseDir, exes[0]) : null;
}

function getLanIpv4Addresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serveDownload(req, res, filePath, contentType, downloadFilename) {
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${downloadFilename}"`,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const pathname = reqUrl.pathname;
  const baseOrigin = `http://${req.headers.host || `127.0.0.1:${PORT}`}`;
  const safeOrigin = escapeHtml(baseOrigin);
  const version = readPackageVersion();
  const safeVersion = escapeHtml(version);
  const apkPath = findApkPath();
  const exePath = findExePath(version);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  if (pathname === '/latest.json') {
    const manifest = {
      version,
      notes: `The World v${version} 局域网同步构建`,
      releaseUrl: `${baseOrigin}/`,
      androidUrl: apkPath ? `${baseOrigin}/the-world.apk` : '',
      windowsUrl: exePath ? `${baseOrigin}/the-world-setup.exe` : '',
    };
    const body = JSON.stringify(manifest, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  if (pathname === '/the-world.apk') {
    if (!apkPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('未找到 APK 构建文件，请先执行 gradlew assembleDebug');
      return;
    }
    serveDownload(
      req,
      res,
      apkPath,
      'application/vnd.android.package-archive',
      `The-World-${version}.apk`
    );
    return;
  }

  if (pathname === '/the-world-setup.exe') {
    if (!exePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('未找到 Windows EXE 安装包，请先执行 electron-builder --win');
      return;
    }
    serveDownload(req, res, exePath, 'application/octet-stream', `The-World-Setup-${version}.exe`);
    return;
  }

  const apkInfo = apkPath ? `✅ Android APK (${(fs.statSync(apkPath).size / 1048576).toFixed(2)} MB)` : '❌ 未构建 APK';
  const exeInfo = exePath ? `✅ Windows EXE (${(fs.statSync(exePath).size / 1048576).toFixed(2)} MB)` : '❌ 未构建 EXE';

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>The World v${safeVersion} 局域网更新服务</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 16px; background: #0f1117; color: #f3f4f6; line-height: 1.6; }
    .card { background: #1b1f2b; border: 1px solid #272c3a; border-radius: 16px; padding: 20px; margin-top: 16px; }
    code { background: #151821; padding: 4px 8px; border-radius: 6px; word-break: break-all; }
    a.btn { display: inline-block; margin: 8px 8px 0 0; padding: 10px 16px; border-radius: 10px; background: #4d6bfe; color: #fff; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <h2>The World v${safeVersion} 局域网分发中心</h2>
  <div class="card">
    <div>把下方地址填进手机端「设置 → 版本与更新检测」，即可局域网一键检查并下载更新：</div>
    <p><code>${safeOrigin}/latest.json</code></p>
    <div>${apkInfo}</div>
    <div>${exeInfo}</div>
    <div>
      ${apkPath ? '<a class="btn" href="/the-world.apk">下载 Android APK</a>' : ''}
      ${exePath ? '<a class="btn" href="/the-world-setup.exe">下载 Windows 安装包</a>' : ''}
    </div>
  </div>
</body>
</html>`;

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(req.method === 'HEAD' ? undefined : html);
});

server.listen(PORT, HOST, () => {
  const version = readPackageVersion();
  const ips = getLanIpv4Addresses();
  console.log(`\nThe World v${version} 局域网更新服务已启动！`);
  console.log(`本机访问: http://127.0.0.1:${PORT}/`);
  if (ips.length > 0) {
    console.log('手机与电脑连接同一 Wi-Fi 后，可在手机「设置 → 更新源」填写以下任一地址：');
    for (const ip of ips) {
      console.log(`  Manifest JSON: http://${ip}:${PORT}/latest.json`);
      console.log(`  浏览器直下页:  http://${ip}:${PORT}/`);
    }
  }
  console.log('');
});
