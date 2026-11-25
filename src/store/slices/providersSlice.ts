import {
  db,
  DEFAULT_SETTINGS,
  loadProvidersDecrypted,
  saveProviderEncrypted,
  saveSettingsEncrypted,
} from '../../db/database';
import {
  deleteMediaBlob,
  hydrateCharactersFromDb,
  hydratePersonaPresetsFromDb,
  hydrateUserPersonasFromDb,
  hydrateVoiceProfilesFromDb,
  preparePersonaPresetForDb,
  prepareVoiceProfileForDb,
} from '../../services/mediaStore';
import type { AppSettings } from '../../types';
import { pickDefaultModelConfig } from '../helpers';
import type { AppSliceCreator, ProvidersSlice } from '../types';

export const createProvidersSlice: AppSliceCreator<ProvidersSlice> = (set, get) => ({
  providers: [],
  settings: DEFAULT_SETTINGS,
  personaPresets: [],
  voiceProfiles: [],

  saveProvider: async (provider) => {
    await saveProviderEncrypted(provider);
    const providers = await loadProvidersDecrypted();
    set({ providers });
  },

  deleteProvider: async (id) => {
    await db.providers.delete(id);
    const providers = await loadProvidersDecrypted();
    const fallback = pickDefaultModelConfig(providers, get().settings.defaultProviderId);
    const fallbackProviderId = providers.some((p) => p.id === get().settings.defaultProviderId)
      ? get().settings.defaultProviderId
      : fallback.providerId;
    await db.sessions
      .where('providerId')
      .equals(id)
      .modify((s) => {
        s.providerId = fallback.providerId;
        s.model = fallback.model;
      });
    const sessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
    const draft = get().draftConfig;
    set({
      providers,
      sessions,
      draftConfig:
        draft.providerId === id
          ? { ...draft, providerId: fallback.providerId, model: fallback.model }
          : draft,
    });
    if (get().settings.defaultProviderId !== fallbackProviderId) {
      await get().updateSettings({ defaultProviderId: fallbackProviderId });
    }
  },

  upsertPersonaPreset: async (preset) => {
    const prepared = await preparePersonaPresetForDb(preset);
    await db.personaPresets.put(prepared);
    const personaPresets = await hydratePersonaPresetsFromDb(
      await db.personaPresets.orderBy('updatedAt').reverse().toArray()
    );
    set({ personaPresets });
  },

  deletePersonaPreset: async (id) => {
    await deleteMediaBlob(`preset_avatar_${id}`);
    await db.transaction('rw', db.personaPresets, db.sessions, async () => {
      await db.personaPresets.delete(id);
      await db.sessions.toCollection().modify((s) => {
        if (s.personaPresetId === id) {
          s.personaPresetId = undefined;
        }
      });
    });
    const [rawPresets, sessions] = await Promise.all([
      db.personaPresets.orderBy('updatedAt').reverse().toArray(),
      db.sessions.orderBy('updatedAt').reverse().toArray(),
    ]);
    const personaPresets = await hydratePersonaPresetsFromDb(rawPresets);
    const draft = get().draftConfig;
    set({
      personaPresets,
      sessions,
      draftConfig:
        draft.personaPresetId === id ? { ...draft, personaPresetId: undefined } : draft,
    });
  },

  upsertVoiceProfile: async (profile) => {
    const prepared = await prepareVoiceProfileForDb(profile);
    await db.voiceProfiles.put(prepared);
    const voiceProfiles = await hydrateVoiceProfilesFromDb(
      await db.voiceProfiles.orderBy('updatedAt').reverse().toArray()
    );
    set({ voiceProfiles });
  },

  deleteVoiceProfile: async (id) => {
    await deleteMediaBlob(`voice_sample_${id}`);
    await db.transaction(
      'rw',
      [db.voiceProfiles, db.characters, db.personaPresets, db.userPersonas],
      async () => {
        await db.voiceProfiles.delete(id);
        await db.characters.toCollection().modify((c) => {
          if (c.voiceProfileId === id) c.voiceProfileId = undefined;
        });
        await db.personaPresets.toCollection().modify((p) => {
          if (p.voiceProfileId === id) p.voiceProfileId = undefined;
        });
        // 「我」也绑音色，删档案时同样要解绑，否则会指向一个不存在的档案
        await db.userPersonas.toCollection().modify((p) => {
          if (p.voiceProfileId === id) p.voiceProfileId = undefined;
        });
      }
    );
    const [rawProfiles, rawChars, rawPresets, rawUserPersonas] = await Promise.all([
      db.voiceProfiles.orderBy('updatedAt').reverse().toArray(),
      db.characters.toArray(),
      db.personaPresets.orderBy('updatedAt').reverse().toArray(),
      db.userPersonas.orderBy('updatedAt').reverse().toArray(),
    ]);
    const [voiceProfiles, characters, personaPresets, userPersonas] = await Promise.all([
      hydrateVoiceProfilesFromDb(rawProfiles),
      hydrateCharactersFromDb(rawChars),
      hydratePersonaPresetsFromDb(rawPresets),
      hydrateUserPersonasFromDb(rawUserPersonas),
    ]);
    set({ voiceProfiles, characters, personaPresets, userPersonas });
    if (get().settings.voice.activeVoiceProfileId === id) {
      await get().updateSettings({
        voice: { ...get().settings.voice, activeVoiceProfileId: undefined },
      });
    }
  },

  updateSettings: async (patch) => {
    const prev = get().settings;
    const next: AppSettings = {
      ...prev,
      ...patch,
      id: 'global' as const,
      imageGen: patch.imageGen ? { ...prev.imageGen, ...patch.imageGen } : prev.imageGen,
      voice: patch.voice ? { ...prev.voice, ...patch.voice } : prev.voice,
    };
    await saveSettingsEncrypted(next);
    set({ settings: next });
  },
});
