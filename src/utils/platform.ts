import { Capacitor } from '@capacitor/core';

export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.theWorldDesktop?.isDesktop);
}

export function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

/**
 * 手机端的 localhost 指的是手机自己，不是跑着 Ollama / 本地推理服务的电脑。
 * 这类地址在 Android 上必然连不通，提前给出可操作的指引，
 * 比让用户看到 "Failed to fetch" 或 ECONNREFUSED 有用得多。
 */
export function detectUnreachableLocalhost(baseUrl: string): string | null {
  if (!isAndroidNative()) return null;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (!LOOPBACK_HOSTS.has(host)) return null;
    return `手机端连不上 ${host}（在手机上它指向手机自身）。请把 Base URL 改成电脑的局域网地址，例如 http://192.168.1.10:11434/v1，并确认手机和电脑在同一个 Wi-Fi 下。`;
  } catch {
    return null;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isSafeHttpUrl(url)) {
    throw new Error('仅支持打开 http:// 或 https:// 协议的外部链接');
  }
  if (window.theWorldDesktop?.openExternal) {
    await window.theWorldDesktop.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'text/plain;charset=utf-8'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
