import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

let mainWindow: BrowserWindow | null = null;
const activeStreams = new Map<string, { controller: AbortController; senderId: number }>();

const DIST_DIR = path.resolve(__dirname, '..', 'dist');

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function getTrustedDevOrigins(): Set<string> {
  const origins = new Set<string>();
  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    origins.add('http://localhost:5173');
    origins.add('http://127.0.0.1:5173');
    if (process.env.VITE_DEV_SERVER_URL) {
      try {
        origins.add(new URL(process.env.VITE_DEV_SERVER_URL).origin);
      } catch {
        // Ignore invalid dev server URL
      }
    }
  }
  return origins;
}

function isTrustedAppUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'file:') {
      const resolved = path.resolve(fileURLToPath(parsed));
      const base = process.platform === 'win32' ? DIST_DIR.toLowerCase() : DIST_DIR;
      const target = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      const rel = path.relative(base, target);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return getTrustedDevOrigins().has(parsed.origin);
    }
    return false;
  } catch {
    return false;
  }
}

function isTrustedIpcEvent(event: Electron.IpcMainInvokeEvent): boolean {
  const frameUrl = event.senderFrame?.url || event.sender?.getURL() || '';
  return isTrustedAppUrl(frameUrl);
}

function abortStreamsForSender(senderId: number): void {
  for (const [reqId, entry] of activeStreams.entries()) {
    if (entry.senderId === senderId) {
      entry.controller.abort();
      activeStreams.delete(reqId);
    }
  }
}

function safeSend(sender: Electron.WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload);
  }
}

function createWindow(): void {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0F1117',
    autoHideMenuBar: true,
    title: 'The World',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const senderId = mainWindow.webContents.id;

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url)) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) {
        shell.openExternal(url).catch(() => {});
      }
    }
  });

  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      abortStreamsForSender(senderId);
    }
  });

  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(path.join(DIST_DIR, 'index.html')).catch(() => {});
    });
  } else {
    mainWindow.loadFile(path.join(DIST_DIR, 'index.html')).catch(() => {});
  }

  mainWindow.on('closed', () => {
    abortStreamsForSender(senderId);
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  for (const entry of activeStreams.values()) {
    entry.controller.abort();
  }
  activeStreams.clear();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('app:openExternal', async (event, url: string) => {
  if (!isTrustedIpcEvent(event)) return false;
  if (!isAllowedExternalUrl(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('crypto:isAvailable', async (event) => {
  if (!isTrustedIpcEvent(event)) return false;
  return safeStorage.isEncryptionAvailable();
});

ipcMain.handle('crypto:encrypt', async (event, plain: string) => {
  if (!isTrustedIpcEvent(event)) {
    throw new Error('Forbidden IPC origin');
  }
  if (!plain || !safeStorage.isEncryptionAvailable()) {
    return plain;
  }
  const buf = safeStorage.encryptString(plain);
  return `enc:${buf.toString('base64')}`;
});

ipcMain.handle('crypto:decrypt', async (event, stored: string) => {
  if (!isTrustedIpcEvent(event)) {
    throw new Error('Forbidden IPC origin');
  }
  if (!stored || !stored.startsWith('enc:')) {
    return stored;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return '';
  }
  try {
    const buf = Buffer.from(stored.slice(4), 'base64');
    return safeStorage.decryptString(buf);
  } catch {
    return '';
  }
});

ipcMain.handle(
  'llm:fetchJson',
  async (
    event,
    params: { url: string; method?: string; headers?: Record<string, string>; body?: string }
  ) => {
    if (!isTrustedIpcEvent(event)) {
      return { ok: false, status: 403, text: 'Forbidden IPC origin' };
    }
    if (!isAllowedExternalUrl(params.url)) {
      return { ok: false, status: 400, text: 'Unsupported URL protocol' };
    }
    try {
      const resp = await fetch(params.url, {
        method: params.method || 'GET',
        headers: params.headers,
        body: params.body,
        signal: AbortSignal.timeout(60_000),
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        text: err instanceof Error ? err.message : 'Network request failed',
      };
    }
  }
);

ipcMain.handle(
  'llm:fetchBinary',
  async (
    event,
    params: { url: string; method?: string; headers?: Record<string, string>; body?: string }
  ) => {
    if (!isTrustedIpcEvent(event)) {
      return {
        ok: false,
        status: 403,
        contentType: '',
        base64: '',
        errorText: 'Forbidden IPC origin',
      };
    }
    if (!isAllowedExternalUrl(params.url)) {
      return {
        ok: false,
        status: 400,
        contentType: '',
        base64: '',
        errorText: 'Unsupported URL protocol',
      };
    }
    try {
      const resp = await fetch(params.url, {
        method: params.method || 'GET',
        headers: params.headers,
        body: params.body,
        signal: AbortSignal.timeout(120_000),
      });
      const contentType = resp.headers.get('content-type') || '';
      const arr = await resp.arrayBuffer();
      const buf = Buffer.from(arr);
      if (!resp.ok) {
        return {
          ok: false,
          status: resp.status,
          contentType,
          base64: '',
          errorText: buf.toString('utf8').slice(0, 800),
        };
      }
      return {
        ok: true,
        status: resp.status,
        contentType,
        base64: buf.toString('base64'),
        errorText: '',
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        contentType: '',
        base64: '',
        errorText: err instanceof Error ? err.message : 'Binary fetch failed',
      };
    }
  }
);

ipcMain.handle(
  'llm:uploadMultipart',
  async (
    event,
    params: {
      url: string;
      headers?: Record<string, string>;
      fields: Record<string, string>;
      fileField: string;
      fileName: string;
      fileMime: string;
      fileBase64: string;
    }
  ) => {
    if (!isTrustedIpcEvent(event)) {
      return { ok: false, status: 403, text: 'Forbidden IPC origin' };
    }
    if (!isAllowedExternalUrl(params.url)) {
      return { ok: false, status: 400, text: 'Unsupported URL protocol' };
    }
    try {
      const form = new FormData();
      for (const [k, v] of Object.entries(params.fields || {})) {
        form.append(k, v);
      }
      const bytes = Buffer.from(params.fileBase64, 'base64');
      const blob = new Blob([bytes], { type: params.fileMime || 'audio/webm' });
      form.append(params.fileField || 'file', blob, params.fileName || 'audio.webm');

      const cleanHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(params.headers || {})) {
        if (k.toLowerCase() !== 'content-type') {
          cleanHeaders[k] = v;
        }
      }

      const resp = await fetch(params.url, {
        method: 'POST',
        headers: cleanHeaders,
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        text: err instanceof Error ? err.message : 'Multipart upload failed',
      };
    }
  }
);

ipcMain.handle(
  'llm:streamStart',
  async (
    event,
    params: { reqId: string; url: string; headers: Record<string, string>; body: string }
  ) => {
    if (!isTrustedIpcEvent(event)) {
      throw new Error('Forbidden IPC origin');
    }
    const channel = `llm:streamChunk:${params.reqId}`;
    if (!isAllowedExternalUrl(params.url)) {
      safeSend(event.sender, channel, { type: 'error', status: 400, message: '不支持的 URL 协议' });
      return;
    }

    const controller = new AbortController();
    activeStreams.set(params.reqId, { controller, senderId: event.sender.id });

    // 首包连接超时（45s）与流式 chunk 空闲超时（90s，兼容推理模型长思考），防止半开连接永久挂起
    const FIRST_BYTE_TIMEOUT_MS = 45_000;
    const IDLE_CHUNK_TIMEOUT_MS = 90_000;
    let timedOutReason = '';
    let watchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timedOutReason = '连接上游模型接口超时（45 秒未响应），请检查网络或切换节点';
      controller.abort();
    }, FIRST_BYTE_TIMEOUT_MS);

    const resetWatchdog = (ms: number, reason: string) => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOutReason = reason;
        controller.abort();
      }, ms);
    };
    const clearWatchdog = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };

    try {
      const resp = await fetch(params.url, {
        method: 'POST',
        headers: params.headers,
        body: params.body,
        signal: controller.signal,
      });

      if (!resp.ok) {
        clearWatchdog();
        const text = await resp.text().catch(() => '');
        let message = `请求失败 (HTTP ${resp.status})`;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.error?.message) message = parsed.error.message;
          else if (parsed?.message) message = parsed.message;
        } catch {
          if (text) message = `${message}: ${text.slice(0, 180)}`;
        }
        safeSend(event.sender, channel, { type: 'error', status: resp.status, message });
        return;
      }

      if (!resp.body) {
        clearWatchdog();
        safeSend(event.sender, channel, { type: 'error', status: 500, message: '响应流为空' });
        return;
      }

      resetWatchdog(IDLE_CHUNK_TIMEOUT_MS, '流式响应中断超时（超过 90 秒无数据返回）');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetWatchdog(IDLE_CHUNK_TIMEOUT_MS, '流式响应中断超时（超过 90 秒无数据返回）');
        if (value) {
          const decoded = decoder.decode(value, { stream: true });
          if (decoded) {
            safeSend(event.sender, channel, { type: 'chunk', data: decoded });
          }
        }
      }
      clearWatchdog();
      const tail = decoder.decode();
      if (tail) {
        safeSend(event.sender, channel, { type: 'chunk', data: tail });
      }
      safeSend(event.sender, channel, { type: 'done' });
    } catch (err) {
      clearWatchdog();
      if (timedOutReason) {
        safeSend(event.sender, channel, {
          type: 'error',
          status: 408,
          message: timedOutReason,
        });
      } else if (!(err instanceof Error && err.name === 'AbortError')) {
        safeSend(event.sender, channel, {
          type: 'error',
          status: 0,
          message: err instanceof Error ? err.message : '网络请求失败',
        });
      }
    } finally {
      clearWatchdog();
      activeStreams.delete(params.reqId);
    }
  }
);

ipcMain.handle('llm:streamAbort', async (event, reqId: string) => {
  if (!isTrustedIpcEvent(event)) {
    throw new Error('Forbidden IPC origin');
  }
  const entry = activeStreams.get(reqId);
  if (entry && entry.senderId === event.sender.id) {
    entry.controller.abort();
    activeStreams.delete(reqId);
  }
});
