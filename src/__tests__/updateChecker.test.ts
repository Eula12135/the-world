import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  detectUpdateSource,
  parseManifestJson,
  pickAssetDownloadUrl,
} from '../services/updateChecker';

describe('updateChecker', () => {
  it('compares semantic versions accurately', () => {
    expect(compareSemver('0.2.2', '0.2.1')).toBe(1);
    expect(compareSemver('v1.0.0', '0.9.9')).toBe(1);
    expect(compareSemver('0.2.1', 'v0.2.1')).toBe(0);
    expect(compareSemver('0.1.9', '0.2.1')).toBe(-1);
  });

  it('picks apk for Android and setup exe for Windows', () => {
    const assets = [
      { name: 'The.World-0.2.2.AppImage', browser_download_url: 'https://x/app.AppImage' },
      { name: 'The.World.Setup.0.2.2.exe', browser_download_url: 'https://x/setup.exe' },
      { name: 'app-release.apk', browser_download_url: 'https://x/app.apk' },
    ];
    expect(pickAssetDownloadUrl(assets, true)).toBe('https://x/app.apk');
    expect(pickAssetDownloadUrl(assets, false)).toBe('https://x/setup.exe');
  });

  it('detects GitHub, Gitee, static/LAN manifest, and rejects invalid update sources', () => {
    expect(detectUpdateSource('')).toEqual({ kind: 'empty', normalized: '' });
    expect(detectUpdateSource('alice/the-world')).toEqual({
      kind: 'github',
      normalized: 'alice/the-world',
    });
    expect(detectUpdateSource('https://github.com/alice/the-world/')).toEqual({
      kind: 'github',
      normalized: 'alice/the-world',
    });
    expect(detectUpdateSource('gitee:alice/the-world')).toEqual({
      kind: 'gitee',
      normalized: 'alice/the-world',
    });
    expect(detectUpdateSource('https://gitee.com/alice/the-world.git')).toEqual({
      kind: 'gitee',
      normalized: 'alice/the-world',
    });
    expect(detectUpdateSource('http://192.168.1.10:8787/latest.json')).toEqual({
      kind: 'manifest',
      normalized: 'http://192.168.1.10:8787/latest.json',
    });
    expect(() => detectUpdateSource('invalid-repo-name')).toThrow();
  });

  it('parses static/LAN manifest JSON and resolves relative asset paths per platform', () => {
    const manifest = JSON.stringify({
      version: '0.4.0',
      notes: '修复输入法高度与长篇上限',
      releaseUrl: './index.html',
      androidUrl: './the-world.apk',
      windowsUrl: '/the-world-setup.exe',
    });
    const base = 'http://192.168.1.50:8787/latest.json';

    const androidRes = parseManifestJson(manifest, base, true);
    expect(androidRes.hasUpdate).toBe(true);
    expect(androidRes.latestVersion).toBe('0.4.0');
    expect(androidRes.downloadUrl).toBe('http://192.168.1.50:8787/the-world.apk');
    expect(androidRes.releaseUrl).toBe('http://192.168.1.50:8787/index.html');
    expect(androidRes.sourceKind).toBe('manifest');

    const winRes = parseManifestJson(manifest, base, false);
    expect(winRes.downloadUrl).toBe('http://192.168.1.50:8787/the-world-setup.exe');
  });
});
