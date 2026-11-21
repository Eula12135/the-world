#!/usr/bin/env node
/**
 * 发布到 Gitee 并只保留最近 N 个版本（默认 2）。
 *
 * 用法：
 *   $env:GITEE_TOKEN="你的私人令牌"; npm run release:gitee
 *
 * 前置：package.json 的 version 已升好、Windows/Android 产物已构建完成。
 * 令牌只从环境变量读取，不落盘、不写进仓库。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = process.env.GITEE_OWNER || 'qiutonger';
const REPO = process.env.GITEE_REPO || 'the-world';
const KEEP = Number(process.env.GITEE_KEEP || 2);
const API = 'https://gitee.com/api/v5';
const TOKEN = process.env.GITEE_TOKEN;

if (!TOKEN) {
  console.error('缺少环境变量 GITEE_TOKEN（在 https://gitee.com/profile/personal_access_tokens 生成，勾选 projects）');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

async function api(pathname, init = {}) {
  const url = `${API}${pathname}`;
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`${init.method || 'GET'} ${pathname} → HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const candidates = [
    {
      file: path.join(ROOT, 'release', `The World Setup ${version}.exe`),
      name: `The-World-Setup-${version}.exe`,
    },
    {
      file: path.join(ROOT, 'release', `The World Setup ${version}.exe.blockmap`),
      name: `The-World-Setup-${version}.exe.blockmap`,
    },
    {
      file: path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
      name: `The-World-${version}-android.apk`,
    },
  ];

  const targets = candidates.filter((c) => fs.existsSync(c.file));

  // 没有 release APK 时退回 debug 包（仅用于内部测试）
  if (!targets.some((t) => t.name.endsWith('.apk'))) {
    const debugApk = path.join(
      ROOT,
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'debug',
      'app-debug.apk'
    );
    if (fs.existsSync(debugApk)) {
      targets.push({ file: debugApk, name: `The-World-${version}-android.apk` });
      console.warn('警告：使用 debug 签名 APK（正式分发请先 assembleRelease）');
    }
  }

  const missing = candidates.filter((c) => !fs.existsSync(c.file) && c.name.endsWith('.exe'));
  if (missing.length > 0) {
    console.error('缺少构建产物：\n' + missing.map((m) => `  - ${path.relative(ROOT, m.file)}`).join('\n'));
    process.exit(1);
  }

  const installer = fs.statSync(targets.find((t) => t.name.endsWith('.exe')).file);
  const installerMB = installer.size / 1024 / 1024;
  if (installerMB > 100) {
    console.error(`安装包 ${installerMB.toFixed(1)} MB 超过 Gitee 单文件 100MB 上限，无法发布`);
    process.exit(1);
  }
  console.log(`安装包 ${installerMB.toFixed(1)} MB（Gitee 上限 100MB）`);

  const existing = await api(`/repos/${OWNER}/${REPO}/releases`);
  const already = existing.find((r) => r.tag_name === tag);
  if (already) {
    console.log(`Release ${tag} 已存在（id=${already.id}），跳过创建`);
  }

  let release = already;
  if (!release) {
    // 发布说明：优先读 RELEASE_NOTES 环境变量指定的文件，其次 ./release-notes.md
    const notesFile = process.env.RELEASE_NOTES || path.join(ROOT, 'release-notes.md');
    const body = fs.existsSync(notesFile)
      ? fs.readFileSync(notesFile, 'utf8')
      : `自动发布 ${tag}`;
    release = await api(`/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: TOKEN,
        tag_name: tag,
        name: `The World ${tag}`,
        target_commitish: 'main',
        prerelease: false,
        body,
      }),
    });
    console.log(`已创建 Release ${tag}（id=${release.id}）`);
  }

  for (const asset of targets) {
    const stat = fs.statSync(asset.file);
    console.log(`上传 ${asset.name}（${(stat.size / 1024 / 1024).toFixed(1)} MB）…`);
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(asset.file)]), asset.name);
    await api(`/repos/${OWNER}/${REPO}/releases/${release.id}/attach_files?access_token=${TOKEN}`, {
      method: 'POST',
      body: form,
    });
    console.log('  完成');
  }

  // 只保留最近 KEEP 个版本（按创建时间倒序）
  const all = await api(`/repos/${OWNER}/${REPO}/releases`);
  const sorted = [...all].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const toDelete = sorted.slice(KEEP);
  for (const rel of toDelete) {
    console.log(`清理旧版本 ${rel.tag_name}（id=${rel.id}）…`);
    await api(`/repos/${OWNER}/${REPO}/releases/${rel.id}?access_token=${TOKEN}`, { method: 'DELETE' });
  }
  console.log(`保留 ${Math.min(sorted.length, KEEP)} 个版本，删除 ${toDelete.length} 个`);

  // 生成 latest.json（分平台下载地址）
  // 关键：Gitee 用 application/zip 提供 .apk，浏览器会把它当压缩包加 .zip 后缀；
  // GitHub 给的是 application/vnd.android.package-archive，浏览器会正常存成 .apk。
  // 所以 APK 指向 GitHub，Windows 安装包指向 Gitee（快且 .exe 类型正确）。
  const ghOwner = process.env.GITHUB_OWNER || 'Eula12135';
  const ghRepo = process.env.GITHUB_REPO || 'the-world';
  const base = `https://gitee.com/${OWNER}/${REPO}/releases/download/${tag}`;
  const ghBase = `https://github.com/${ghOwner}/${ghRepo}/releases/download/${tag}`;
  const manifest = {
    version,
    name: `The World ${tag}`,
    pageUrl: `https://gitee.com/${OWNER}/${REPO}/releases/tag/${tag}`,
    releaseUrl: `https://gitee.com/${OWNER}/${REPO}/releases/tag/${tag}`,
    windowsUrl: `${base}/The-World-Setup-${version}.exe`,
    androidUrl: `${ghBase}/The-World-${version}-android.apk`,
    notes: `v${version}`,
  };
  fs.writeFileSync(path.join(ROOT, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('\n已生成 latest.json（APK 指向 GitHub，Windows 包指向 Gitee）');
  console.log('请提交并推送 latest.json 到 Gitee，使 raw 地址生效：');
  console.log(`  https://gitee.com/${OWNER}/${REPO}/raw/main/latest.json`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
