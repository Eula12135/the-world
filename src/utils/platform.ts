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
