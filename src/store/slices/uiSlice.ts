import { stopSpeaking } from '../../services/voiceService';
import { createId } from '../../utils/platform';
import type { AppSliceCreator, UiSlice } from '../types';

export const createUiSlice: AppSliceCreator<UiSlice> = (set, get) => ({
  activeView: 'chat',
  worldStudioMode: 'world',
  pendingCreateStandaloneChar: false,
  activeModal: 'none',
  modalReturnTo: 'none',
  providersModalTab: 'llm',
  voiceStudioSubTab: 'library',
  pendingVoiceBindTarget: null,
  lastCreatedVoiceForTarget: null,
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  updateNotice: null,
  speakingMessageId: null,
  confirmRequest: null,
  toasts: [],
  contextTokens: null,
  swipeOffset: 0,
  composerDraft: '',
  worldPopoverRequest: null,

  setActiveView: (v) => {
    stopSpeaking();
    set({ activeView: v, speakingMessageId: null });
  },
  setWorldStudioMode: (mode) => set({ worldStudioMode: mode }),
  openStandaloneCharacters: (autoCreate = false) =>
    set({
      activeModal: 'none',
      activeView: 'worlds',
      worldStudioMode: 'standalone_characters',
      pendingCreateStandaloneChar: autoCreate,
    }),
  clearPendingCreateStandaloneChar: () => set({ pendingCreateStandaloneChar: false }),
  setActiveModal: (m) =>
    set((s) => ({
      activeModal: m,
      modalReturnTo: m === 'none' ? 'none' : s.activeModal === 'settings' && m !== 'settings' ? 'settings' : 'none',
      pendingVoiceBindTarget: m === 'none' ? null : s.pendingVoiceBindTarget,
    })),
  closeOrStepBackModal: () =>
    set((s) => {
      if (s.modalReturnTo !== 'none' && !s.pendingVoiceBindTarget) {
        return {
          activeModal: s.modalReturnTo,
          modalReturnTo: 'none',
        };
      }
      return {
        activeModal: 'none',
        modalReturnTo: 'none',
        pendingVoiceBindTarget: null,
      };
    }),
  setProvidersModalTab: (tab) => set({ providersModalTab: tab }),

  setContextTokens: (n) => set({ contextTokens: n }),

  setSwipeOffset: (n) => set({ swipeOffset: n }),
  setComposerDraft: (text) => set({ composerDraft: text }),
  requestWorldPopover: (tab) => set({ worldPopoverRequest: tab }),
  clearWorldPopoverRequest: () => set({ worldPopoverRequest: null }),
  setVoiceStudioSubTab: (subTab) => set({ voiceStudioSubTab: subTab }),
  openProvidersModal: (tab, opts) =>
    set((s) => ({
      activeModal: 'providers',
      modalReturnTo: s.activeModal === 'settings' && !opts?.bindTarget ? 'settings' : 'none',
      providersModalTab: tab,
      voiceStudioSubTab: opts?.voiceSubTab ?? (tab === 'voice' ? 'library' : s.voiceStudioSubTab),
      pendingVoiceBindTarget: opts?.bindTarget ?? null,
    })),
  clearPendingVoiceBind: () => set({ pendingVoiceBindTarget: null }),
  completePendingVoiceBind: async (profileId) => {
    const target = get().pendingVoiceBindTarget;
    if (!target) {
      set({ activeModal: 'none', pendingVoiceBindTarget: null });
      return;
    }
    const targetKey =
      target.kind === 'character' ? `character:${target.characterId}` : 'persona';
    if (target.kind === 'character') {
      const existingChar = get().characters.find((c) => c.id === target.characterId);
      if (existingChar) {
        await get().upsertCharacter({
          ...existingChar,
          voiceProfileId: profileId,
          updatedAt: Date.now(),
        });
      }
    }
    set({
      lastCreatedVoiceForTarget: { targetKey, profileId },
      pendingVoiceBindTarget: null,
      activeModal: 'none',
    });
    const label = target.kind === 'character' ? target.characterName || '角色' : '人设';
    get().showToast(`已创建声音并绑定到「${label}」`, 'success');
  },
  clearLastCreatedVoiceForTarget: () => set({ lastCreatedVoiceForTarget: null }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setUpdateNotice: (u) => set({ updateNotice: u }),
  setSpeakingMessageId: (id) => set({ speakingMessageId: id }),

  showToast: (text, tone = 'info') => {
    const id = createId('toast');
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 2400);
  },

  requestConfirm: (req) => set({ confirmRequest: req }),
});
