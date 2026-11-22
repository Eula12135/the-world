import { create } from 'zustand';
import {
  db,
  ensureDatabaseInitialized,
  loadProvidersDecrypted,
  loadSettingsDecrypted,
} from '../db/database';
import { loadWorldChildren, pickDefaultModelConfig } from './helpers';
import { createChatSlice } from './slices/chatSlice';
import { createProvidersSlice } from './slices/providersSlice';
import { createUiSlice } from './slices/uiSlice';
import { createWorldSlice } from './slices/worldSlice';
import type { AppState } from './types';

export type {
  ActiveView,
  ConfirmRequest,
  DraftSessionConfig,
  ModalKind,
  PendingVoiceBindTarget,
  ProvidersModalTab,
  ToastItem,
  VoiceStudioSubTab,
} from './types';

export const useAppStore = create<AppState>((set, get, store) => ({
  ...createUiSlice(set, get, store),
  ...createProvidersSlice(set, get, store),
  ...createChatSlice(set, get, store),
  ...createWorldSlice(set, get, store),

  initialized: false,
  initError: null,

  init: async () => {
    set({ initError: null });
    try {
      await ensureDatabaseInitialized();
      await get().reloadAll();
      set({ initialized: true, initError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '未知初始化错误');
      console.error('[AppInit] failed:', err);
      set({ initialized: false, initError: message });
    }
  },

  reloadAll: async () => {
    const [
      providers,
      sessions,
      worlds,
      resolvedSettings,
      personaPresets,
      voiceProfiles,
      worldData,
    ] = await Promise.all([
      loadProvidersDecrypted(),
      db.sessions.orderBy('updatedAt').reverse().toArray(),
      db.worlds.orderBy('updatedAt').reverse().toArray(),
      loadSettingsDecrypted(),
      db.personaPresets.orderBy('updatedAt').reverse().toArray(),
      db.voiceProfiles.orderBy('updatedAt').reverse().toArray(),
      loadWorldChildren(null),
    ]);

    const currentSessionId = get().activeSessionId;
    const nextSessionId =
      currentSessionId && sessions.some((s) => s.id === currentSessionId)
        ? currentSessionId
        : sessions[0]?.id ?? null;

    const messages = nextSessionId
      ? await db.messages.where('sessionId').equals(nextSessionId).sortBy('createdAt')
      : [];

    const currentWorldId = get().activeWorldId;
    const nextWorldId =
      currentWorldId && worlds.some((w) => w.id === currentWorldId)
        ? currentWorldId
        : worlds[0]?.id ?? null;

    set({
      providers,
      sessions,
      activeSessionId: nextSessionId,
      draftConfig: pickDefaultModelConfig(providers, resolvedSettings.defaultProviderId),
      messages,
      worlds,
      activeWorldId: nextWorldId,
      ...worldData,
      settings: resolvedSettings,
      personaPresets,
      voiceProfiles,
    });
  },
}));
