import { crossPlatformFetchJson } from './llm';
import { isAndroidNative } from '../utils/platform';

// 构建时由 vite.config.ts 的 define 注入 package.json 的 version；脱离构建环境时回退
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.3.4';

export const DEFAULT_UPDATE_SOURCE: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_UPDATE_REPO) ||
  '';

export type UpdateSourceKind = 'github' | 'gitee' | 'manifest' | 'empty';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  downloadUrl: string;
  /** 供「查看更新」打开的网页地址（默认同 releaseUrl），便于展示下载页/更新说明 */
  pageUrl?: string;
  releaseNotes: string;
  sourceKind?: UpdateSourceKind;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export function pickAssetDownloadUrl(
  assets: Array<{ name?: string; browser_download_url?: string }>,
  preferAndroid: boolean
): string {
  // 排除源码归档：Gitee/GitHub 会自动生成 v0.3.8.zip / .tar.gz，
  // 它们不是安装包，被选中会让用户下到一个压缩包源码。
  const valid = assets.filter(
    (a) =>
      a.browser_download_url &&
      a.name &&
      !/\.(zip|tar\.gz|tgz|tar\.bz2)$/i.test(a.name)
  );
  if (preferAndroid) {
    const apk = valid.find((a) => a.name!.toLowerCase().endsWith('.apk'));
    if (apk?.browser_download_url) return apk.browser_download_url;
  } else {
    const exe =
      valid.find((a) => a.name!.toLowerCase().includes('setup') && a.name!.toLowerCase().endsWith('.exe')) ||
      valid.find((a) => a.name!.toLowerCase().endsWith('.exe'));
    if (exe?.browser_download_url) return exe.browser_download_url;
  }
  return '';
}

export function detectUpdateSource(source: string): { kind: UpdateSourceKind; normalized: string } {
  const raw = source.trim();
  if (!raw) {
    return { kind: 'empty', normalized: '' };
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const pathLower = parsed.pathname.toLowerCase();
      if (pathLower.endsWith('.json')) {
        return { kind: 'manifest', normalized: raw };
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parsed.hostname.toLowerCase() === 'gitee.com' && parts.length >= 2 && parts[0] !== 'api') {
        return { kind: 'gitee', normalized: `${parts[0]}/${parts[1].replace(/\.git$/i, '')}` };
      }
      if (parsed.hostname.toLowerCase() === 'github.com' && parts.length >= 2) {
        return { kind: 'github', normalized: `${parts[0]}/${parts[1].replace(/\.git$/i, '')}` };
      }
      return { kind: 'manifest', normalized: raw };
    } catch {
      throw new Error('更新源 URL 格式不正确');
    }
  }

  if (/^gitee:/i.test(raw)) {
    const slug = raw
      .replace(/^gitee:/i, '')
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/i, '');
    if (!/^[^/\s]+\/[^/\s]+$/.test(slug)) {
      throw new Error('Gitee 仓库格式应为 gitee:owner/repo');
    }
    return { kind: 'gitee', normalized: slug };
  }

  const ghSlug = raw
    .replace(/^github:/i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '');
  if (/^[^/\s]+\/[^/\s]+$/.test(ghSlug)) {
    return { kind: 'github', normalized: ghSlug };
  }

  throw new Error(
    '更新源格式不正确，支持：owner/repo（GitHub）、gitee:owner/repo（Gitee）或 http(s)://.../latest.json（清单地址）'
  );
}

function resolveRelativeUrl(candidate: string, baseUrl: string): string {
  const trimmed = candidate.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

export function parseManifestJson(
  rawText: string,
  sourceUrl: string,
  preferAndroid: boolean
): UpdateCheckResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error('更新清单不是有效的 JSON 格式');
  }

  const latestVersion = String(data.version || data.tag_name || APP_VERSION)
    .trim()
    .replace(/^v/i, '');
  const releaseNotes = String(data.notes || data.releaseNotes || data.body || '').slice(0, 800);
  const releaseUrl =
    resolveRelativeUrl(String(data.releaseUrl || data.html_url || sourceUrl), sourceUrl) || sourceUrl;

  const platformCandidate = preferAndroid
    ? String(data.androidUrl || data.apkUrl || data.downloadUrl || '')
    : String(data.windowsUrl || data.exeUrl || data.desktopUrl || data.downloadUrl || '');
  const downloadUrl = resolveRelativeUrl(platformCandidate, sourceUrl) || releaseUrl;
  const pageUrl = resolveRelativeUrl(String(data.pageUrl || data.page_url || ''), sourceUrl) || releaseUrl;

  return {
    hasUpdate: compareSemver(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    releaseUrl,
    downloadUrl,
    pageUrl,
    releaseNotes,
    sourceKind: 'manifest',
  };
}

/** 更新源可以填多个，用空格 / 逗号 / 换行分隔，按顺序尝试，第一个成功的生效。 */
export function splitUpdateSources(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function checkForAppUpdate(
  source: string,
  preferAndroid: boolean = isAndroidNative()
): Promise<UpdateCheckResult> {
  const candidates = splitUpdateSources(source);
  const list = candidates.length > 0 ? candidates : splitUpdateSources(DEFAULT_UPDATE_SOURCE);

  if (list.length === 0) {
    throw new Error(
      '尚未配置更新源，请输入 GitHub 仓库（owner/repo）、gitee:owner/repo 或 latest.json 链接'
    );
  }

  if (list.length === 1) {
    return checkSingleSource(list[0], preferAndroid);
  }

  const errors: string[] = [];
  for (const candidate of list) {
    try {
      const result = await checkSingleSource(candidate, preferAndroid);
      return { ...result, releaseNotes: result.releaseNotes };
    } catch (err) {
      errors.push(`${candidate} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`所有更新源都不可用：\n${errors.join('\n')}`);
}

async function checkSingleSource(
  source: string,
  preferAndroid: boolean
): Promise<UpdateCheckResult> {
  const effective = source.trim() || DEFAULT_UPDATE_SOURCE;
  const detected = detectUpdateSource(effective);

  if (detected.kind === 'empty') {
    throw new Error(
      '尚未配置更新源，请输入 GitHub 仓库（owner/repo）、gitee:owner/repo 或 latest.json 链接'
    );
  }

  if (detected.kind === 'manifest') {
    const resp = await crossPlatformFetchJson({
      url: detected.normalized,
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      throw new Error(`检查更新失败 (HTTP ${resp.status})`);
    }
    return parseManifestJson(resp.text, detected.normalized, preferAndroid);
  }

  const isGitee = detected.kind === 'gitee';
  const apiUrl = isGitee
    ? `https://gitee.com/api/v5/repos/${detected.normalized}/releases/latest`
    : `https://api.github.com/repos/${detected.normalized}/releases/latest`;
  const fallbackReleasePage = isGitee
    ? `https://gitee.com/${detected.normalized}/releases`
    : `https://github.com/${detected.normalized}/releases`;

  const resp = await crossPlatformFetchJson({
    url: apiUrl,
    method: 'GET',
    headers: { Accept: isGitee ? 'application/json' : 'application/vnd.github+json' },
  });

  if (!resp.ok) {
    throw new Error(`检查更新失败 (HTTP ${resp.status})`);
  }

  const data = JSON.parse(resp.text);
  const latestVersion = String(data.tag_name || data.name || APP_VERSION)
    .trim()
    .replace(/^v/i, '');
  const releaseTag = String(data.tag_name || '').trim();
  // Gitee 的 release 接口不返回 html_url，直接用 tag 页面，避免落到「版本列表页」
  const releaseUrl =
    String(data.html_url || '') ||
    (detected.kind === 'gitee' && releaseTag
      ? `https://gitee.com/${detected.normalized}/releases/tag/${encodeURIComponent(releaseTag)}`
      : fallbackReleasePage);
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const downloadUrl = pickAssetDownloadUrl(assets, preferAndroid) || releaseUrl;

  return {
    hasUpdate: compareSemver(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    releaseUrl,
    downloadUrl,
    pageUrl: releaseUrl,
    releaseNotes: String(data.body || '').slice(0, 800),
    sourceKind: detected.kind,
  };
}

export const checkGithubReleaseUpdate = checkForAppUpdate;

export interface ApkUpdateProgress {
  status: 'downloading' | 'permission' | 'installing' | 'error';
  progress: number;
  message?: string;
}

export function canInAppAndroidUpdate(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.TheWorldAndroid?.downloadAndInstallApk === 'function'
  );
}

export function startInAppAndroidUpdate(
  apkUrl: string,
  onProgress: (ev: ApkUpdateProgress) => void
): () => void {
  if (!canInAppAndroidUpdate()) {
    onProgress({
      status: 'error',
      progress: 0,
      message: '当前版本或运行环境不支持 App 内自动更新，请使用外部浏览器下载安装包',
    });
    return () => {};
  }

  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    window.removeEventListener('theworld-apk-update', handler);
  };

  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<ApkUpdateProgress>).detail;
    if (!detail) return;
    onProgress(detail);
    if (detail.status === 'installing' || detail.status === 'error') {
      cleanup();
    }
  };

  window.addEventListener('theworld-apk-update', handler);
  try {
    window.TheWorldAndroid!.downloadAndInstallApk!(apkUrl);
  } catch (err) {
    cleanup();
    onProgress({
      status: 'error',
      progress: 0,
      message: err instanceof Error ? err.message : '启动 App 内更新失败',
    });
  }

  return cleanup;
}
