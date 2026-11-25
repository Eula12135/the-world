import { Capacitor } from '@capacitor/core';
import type { ProviderConfig } from '../types';

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

export function isProviderReady(p: Pick<ProviderConfig, 'enabled' | 'requiresKey' | 'apiKey'>): boolean {
  return Boolean(p.enabled && (!p.requiresKey || p.apiKey.trim().length > 0));
}

export function isImeComposing(e: { nativeEvent?: { isComposing?: boolean }; keyCode?: number }): boolean {
  return Boolean(e.nativeEvent?.isComposing || e.keyCode === 229);
}

export function sanitizeFilename(name: string, fallback = 'export'): string {
  const cleaned = String(name || '')
    .replace(/[/\\:*?"<>|\r\n\t]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || fallback;
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
): Promise<boolean> {
  const safeName = sanitizeFilename(filename);
  if (typeof window !== 'undefined' && window.TheWorldAndroid?.exportTextFile) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('theworld-export', onExport);
        window.clearTimeout(timer);
        resolve(ok);
      };
      const onExport = (ev: Event) => {
        const detail = (ev as CustomEvent<{ ok?: boolean }>).detail;
        done(Boolean(detail?.ok));
      };
      const timer = window.setTimeout(() => done(false), 60_000);
      window.addEventListener('theworld-export', onExport);
      try {
        window.TheWorldAndroid!.exportTextFile!(safeName, content, mimeType);
      } catch {
        done(false);
      }
    });
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Promise.resolve(true);
}

export function downloadBinaryFile(
  filename: string,
  bytes: Uint8Array,
  mimeType = 'application/octet-stream'
): Promise<boolean> {
  const safeName = sanitizeFilename(filename);
  if (typeof window !== 'undefined' && window.TheWorldAndroid?.exportBinaryFile) {
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('theworld-export', onExport);
        window.clearTimeout(timer);
        resolve(ok);
      };
      const onExport = (ev: Event) => {
        const detail = (ev as CustomEvent<{ ok?: boolean }>).detail;
        done(Boolean(detail?.ok));
      };
      const timer = window.setTimeout(() => done(false), 60_000);
      window.addEventListener('theworld-export', onExport);
      try {
        window.TheWorldAndroid!.exportBinaryFile!(safeName, base64, mimeType);
      } catch {
        done(false);
      }
    });
  }

  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Promise.resolve(true);
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
