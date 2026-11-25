#!/usr/bin/env node
/**
 * 发布后校验：确认「用户实际下载到的东西」和「我们以为发出去的东西」是同一个。
 *
 * 起因（0.7.1 事故）：发布出去的 APK 被覆盖成了上一版，manifest 写着 0.7.1、
 * 用户装完还是 0.7.0。检查脚本只看了「有没有上传成功」，没人回读资产本身。
 *
 * 校验项：
 *   1. 远端 latest.json 的 version 是否等于 package.json
 *   2. 两个下载地址是否 200、大小合理、Content-Type 正确
 *   3. 下载 APK 与本地构建产物 SHA256 是否一致
 *   4. 下载 APK 的 versionCode 是否等于按 package.json 推导出来的值
 *
 * GitHub 资产还没建时（刚跑完 release:gitee）只警告不失败，方便串在发布流程里。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const [major, minor, patch] = version.split('.').map((n) => Number(n));
const expectedVersionCode = major * 10000 + minor * 100 + patch;

const RAW = process.env.UPDATE_MANIFEST_URL || 'https://gitee.com/qiutonger/the-world/raw/main/latest.json';
const LOCAL_APK = path.join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}
function warn(label, detail) {
  results.push({ label, ok: true, warn: true, detail });
  console.log(`  ! ${label}${detail ? ` — ${detail}` : ''}`);
}

async function head(url) {
  // GitHub 会 302 到 objects.githubusercontent.com，fetch 默认跟随
  const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
  return {
    status: res.status,
    length: Number(res.headers.get('content-range')?.split('/')[1] || res.headers.get('content-length') || 0),
    type: res.headers.get('content-type') || '',
  };
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function findAapt() {
  const candidates = [];
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  for (const root of [sdk, 'C:/AI/devtools/android-sdk'].filter(Boolean)) {
    const bt = path.join(root, 'build-tools');
    if (!fs.existsSync(bt)) continue;
    for (const v of fs.readdirSync(bt).sort().reverse()) {
      candidates.push(path.join(bt, v, 'aapt2.exe'), path.join(bt, v, 'aapt2'));
    }
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function main() {
  console.log(`\n校验 ${version}（期望 versionCode ${expectedVersionCode}）\n`);

  // 1. 远端清单
  const manifestUrl = `${RAW}${RAW.includes('?') ? '&' : '?'}t=${Date.now()}`;
  // 设了 VERIFY_MANIFEST_FILE 就直接读本地清单，便于离线核对或回归测试
  const manifest = process.env.VERIFY_MANIFEST_FILE
    ? JSON.parse(fs.readFileSync(process.env.VERIFY_MANIFEST_FILE, 'utf8'))
    : await (await fetch(manifestUrl, { cache: 'no-store' })).json();
  check('latest.json version', manifest.version === version, `远端 ${manifest.version} / 本地 ${version}`);

  // 2. 两个下载地址
  for (const [key, expectType] of [
    ['androidUrl', 'application/vnd.android.package-archive'],
    ['windowsUrl', 'application/vnd.microsoft.portable-executable'],
  ]) {
    const url = manifest[key];
    if (!url) {
      check(`${key} 存在`, false, 'manifest 里没有该字段');
      continue;
    }
    try {
      const h = await head(url);
      // 用 Range 探测时 GitHub 会返回 206 Partial Content，同样算可达
      check(`${key} 可达`, h.status === 200 || h.status === 206, `HTTP ${h.status} / ${(h.length / 1048576).toFixed(1)} MB`);
      check(`${key} 类型`, h.type.includes(expectType), h.type || '(空)');
      check(`${key} 体积`, h.length > 1_000_000, `${h.length} bytes`);
    } catch (err) {
      const pending = /404/.test(String(err.message));
      if (pending && key === 'androidUrl') {
        warn(`${key} 尚未就绪`, 'GitHub release 可能还没建，建好后重跑本脚本');
      } else {
        check(`${key} 可达`, false, err.message);
      }
    }
  }

  // 3-4. 回读 APK 本体
  const apkUrl = manifest.androidUrl;
  if (apkUrl) {
    try {
      const buf = await download(apkUrl);
      const remoteHash = sha256(buf);

      if (fs.existsSync(LOCAL_APK)) {
        const localHash = sha256(fs.readFileSync(LOCAL_APK));
        check('APK 与本地构建一致', remoteHash === localHash, `${remoteHash.slice(0, 16)} vs ${localHash.slice(0, 16)}`);
      } else {
        warn('本地 APK 不存在', '跳过哈希比对');
      }

      const aapt = findAapt();
      if (aapt) {
        const tmp = path.join(os.tmpdir(), `verify-${version}.apk`);
        fs.writeFileSync(tmp, buf);
        const badging = execFileSync(aapt, ['dump', 'badging', tmp], { encoding: 'utf8' });
        fs.unlinkSync(tmp);
        const m = badging.match(/versionCode='(\d+)'.*versionName='([^']+)'/);
        if (m) {
          check('APK versionCode', Number(m[1]) === expectedVersionCode, `远端 ${m[1]} / 期望 ${expectedVersionCode}`);
          check('APK versionName', m[2] === version, `远端 ${m[2]} / 期望 ${version}`);
        } else {
          warn('未能解析 versionCode', 'aapt2 输出格式不符');
        }
      } else {
        warn('找不到 aapt2', '跳过 versionCode 校验（设置 ANDROID_HOME 可开启）');
      }
    } catch (err) {
      check('APK 回读', false, err.message);
    }
  }

  const failed = results.filter((r) => !r.ok);
  const warned = results.filter((r) => r.warn);
  console.log(
    `\n${failed.length === 0 ? '通过' : '失败'}：${results.length - failed.length}/${results.length} 项` +
      (warned.length ? `，${warned.length} 项跳过` : '')
  );
  if (failed.length) {
    console.log('\n以下项不通过：');
    for (const f of failed) console.log(`  - ${f.label}（${f.detail}）`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
