import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
const activeStreams = new Map<string, AbortController>();

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(() => {});
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(() => {});
  }

  mainWindow.on('closed', () => {
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
  for (const ctrl of activeStreams.values()) {
    ctrl.abort();
  }
  activeStreams.clear();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('app:openExternal', async (_event, url: string) => {
  if (!isAllowedExternalUrl(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('crypto:isAvailable', async () => {
  return safeStorage.isEncryptionAvailable();
});

ipcMain.handle('crypto:encrypt', async (_event, plain: string) => {
  if (!plain || !safeStorage.isEncryptionAvailable()) {
    return plain;
  }
  const buf = safeStorage.encryptString(plain);
  return `enc:${buf.toString('base64')}`;
});

ipcMain.handle('crypto:decrypt', async (_event, stored: string) => {
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
    _event,
    params: { url: string; method?: string; headers?: Record<string, string>; body?: string }
  ) => {
    if (!isAllowedExternalUrl(params.url)) {
      return { ok: false, status: 400, text: 'Unsupported URL protocol' };
    }
    const resp = await fetch(params.url, {
      method: params.method || 'GET',
      headers: params.headers,
      body: params.body,
    });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text };
  }
);

ipcMain.handle(
  'llm:fetchBinary',
  async (
    _event,
    params: { url: string; method?: string; headers?: Record<string, string>; body?: string }
  ) => {
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
    _event,
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
    const channel = `llm:streamChunk:${params.reqId}`;
    if (!isAllowedExternalUrl(params.url)) {
      event.sender.send(channel, { type: 'error', status: 400, message: '不支持的 URL 协议' });
      return;
    }

    const controller = new AbortController();
    activeStreams.set(params.reqId, controller);

    try {
      const resp = await fetch(params.url, {
        method: 'POST',
        headers: params.headers,
        body: params.body,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let message = `请求失败 (HTTP ${resp.status})`;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.error?.message) message = parsed.error.message;
          else if (parsed?.message) message = parsed.message;
        } catch {
          if (text) message = `${message}: ${text.slice(0, 180)}`;
        }
        event.sender.send(channel, { type: 'error', status: resp.status, message });
        return;
      }

      if (!resp.body) {
        event.sender.send(channel, { type: 'error', status: 500, message: '响应流为空' });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          event.sender.send(channel, {
            type: 'chunk',
            data: decoder.decode(value, { stream: true }),
          });
        }
      }
      event.sender.send(channel, { type: 'done' });
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        event.sender.send(channel, {
          type: 'error',
          status: 0,
          message: err instanceof Error ? err.message : '网络请求失败',
        });
      }
    } finally {
      activeStreams.delete(params.reqId);
    }
  }
);

ipcMain.handle('llm:streamAbort', async (_event, reqId: string) => {
  const ctrl = activeStreams.get(reqId);
  if (ctrl) {
    ctrl.abort();
    activeStreams.delete(reqId);
  }
});
