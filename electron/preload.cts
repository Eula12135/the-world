import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('theWorldDesktop', {
  isDesktop: true,
  platform: process.platform,
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  isEncryptionAvailable: () => ipcRenderer.invoke('crypto:isAvailable'),
  encryptSecret: (plain: string) => ipcRenderer.invoke('crypto:encrypt', plain),
  decryptSecret: (stored: string) => ipcRenderer.invoke('crypto:decrypt', stored),
  fetchJson: (params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => ipcRenderer.invoke('llm:fetchJson', params),
  fetchBinary: (params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => ipcRenderer.invoke('llm:fetchBinary', params),
  uploadMultipart: (params: {
    url: string;
    headers?: Record<string, string>;
    fields: Record<string, string>;
    fileField: string;
    fileName: string;
    fileMime: string;
    fileBase64: string;
  }) => ipcRenderer.invoke('llm:uploadMultipart', params),
  streamStart: (params: {
    reqId: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  }) => ipcRenderer.invoke('llm:streamStart', params),
  streamAbort: (reqId: string) => ipcRenderer.invoke('llm:streamAbort', reqId),
  onStreamEvent: (
    reqId: string,
    handler: (ev: {
      type: 'chunk' | 'done' | 'error';
      data?: string;
      status?: number;
      message?: string;
    }) => void
  ) => {
    const channel = `llm:streamChunk:${reqId}`;
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        type: 'chunk' | 'done' | 'error';
        data?: string;
        status?: number;
        message?: string;
      }
    ) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
});
